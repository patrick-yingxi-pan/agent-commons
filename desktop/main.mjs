import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, Menu, dialog, ipcMain, safeStorage, session, shell, utilityProcess } from 'electron'
import credentialChannels from './credential-channels.cjs'
import contextChannels from './context-channels.cjs'
import dataChannels from './data-channels.cjs'
import { createNativeContextPicker } from './contextPicker.mjs'
import { createCredentialBackendClient } from './credentialProtocol.mjs'
import { createDataBackendClient } from './dataProtocol.mjs'
import { offerStartupRecovery, revealRecoveryDirectory } from './startupRecovery.mjs'
import {
  CREDENTIAL_VAULT_FILE,
  openCredentialVault,
  secureStorageAvailable,
} from './credentialVault.mjs'
import {
  backendListenMarker,
  desktopBackendEnvironment,
  exactLoopbackOrigin,
  findAvailableLoopbackPort,
  isAllowedExternalUrl,
  isTrustedAppUrl,
  loopbackOrigin,
  permissionAllowed,
} from './runtime.mjs'

const APP_ID = 'com.agentcommons.desktop'
const DEV_RENDERER_URL = process.env.AGENT_COMMONS_DEV_URL
const DEVELOPMENT = Boolean(DEV_RENDERER_URL)
const START_TIMEOUT_MS = 20_000
const STOP_TIMEOUT_MS = 7_000

let mainWindow = null
let backend = null
let backendReady = false
let credentialVault = null
let credentialBackend = null
let dataBackend = null
let quitting = false
let quitAfterBackend = false
let rendererUrl = null
let trustedOrigin = null
const contextPicker = createNativeContextPicker({
  showOpenDialog: (owner, options) => dialog.showOpenDialog(owner, options),
})

app.enableSandbox()
if (!app.isPackaged) app.setPath('userData', join(app.getPath('appData'), 'Agent Commons Development'))

const ownsInstance = app.requestSingleInstanceLock()
if (!ownsInstance) {
  app.quit()
} else {
  app.on('second-instance', () => focusMainWindow())
  app.whenReady().then(startDesktop).catch(failStartup)
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

async function startDesktop() {
  app.setAppUserModelId(APP_ID)
  installApplicationMenu()
  credentialVault = await openDesktopCredentialVault()
  let providerCredentials = {}
  if (credentialVault) {
    try {
      providerCredentials = await credentialVault.environment()
    } catch (error) {
      console.error('[desktop] stored credentials could not be decrypted; the vault is disabled for this run.', error)
      credentialVault = null
    }
  }

  const preferredPort = DEVELOPMENT ? Number(process.env.AGENT_COMMONS_BACKEND_PORT) : 0
  const port = Number.isInteger(preferredPort) && preferredPort > 0 ? preferredPort : await findAvailableLoopbackPort()
  const backendOrigin = loopbackOrigin(port)
  trustedOrigin = DEVELOPMENT ? exactLoopbackOrigin(DEV_RENDERER_URL) : backendOrigin
  rendererUrl = DEVELOPMENT ? trustedOrigin : backendOrigin

  configureSessionPermissions(trustedOrigin)
  await launchBackend({ port, backendOrigin, rendererOrigin: trustedOrigin, providerCredentials })
  await waitForReady(`${backendOrigin}/api/v1/readyz`, trustedOrigin, START_TIMEOUT_MS)
  if (DEVELOPMENT) await waitForReady(rendererUrl, trustedOrigin, START_TIMEOUT_MS, false)
  await ensureRecoveryBackup()

  backendReady = true
  if (credentialVault) installCredentialIpc()
  installContextIpc()
  installDataIpc()
  await createMainWindow(rendererUrl, trustedOrigin)
  console.log(`[desktop] ready ${rendererUrl} · ${credentialVault ? 'secure credentials' : 'environment-only credentials'}`)
}

async function openDesktopCredentialVault() {
  try {
    const encryptionAvailable = safeStorage.isEncryptionAvailable()
    const linuxBackend = process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : undefined
    if (!secureStorageAvailable({ encryptionAvailable, linuxBackend })) {
      console.warn('[desktop] secure credential storage is unavailable; use a PROVIDER_* launch environment variable.')
      return null
    }
    return await openCredentialVault({
      filePath: join(app.getPath('userData'), CREDENTIAL_VAULT_FILE),
      encrypt: (secret) => safeStorage.encryptString(secret),
      decrypt: (ciphertext) => safeStorage.decryptString(ciphertext),
    })
  } catch (error) {
    console.error('[desktop] secure credential storage could not be opened.', error)
    return null
  }
}

function installApplicationMenu() {
  const template = []
  if (process.platform === 'darwin') template.push({ role: 'appMenu' })
  template.push({ role: 'editMenu' }, { role: 'windowMenu' })
  if (DEVELOPMENT) template.push({ role: 'viewMenu' })
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function configureSessionPermissions(origin) {
  const allowed = (permission, requestingUrl) => permissionAllowed(permission, requestingUrl, origin)
  session.defaultSession.setPermissionCheckHandler((_contents, permission, requestingOrigin, details) =>
    allowed(permission, details?.requestingUrl ?? requestingOrigin),
  )
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback, details) =>
    callback(allowed(permission, details?.requestingUrl ?? '')),
  )
  session.defaultSession.setDevicePermissionHandler?.(() => false)
}

async function launchBackend({ port, backendOrigin, rendererOrigin, providerCredentials }) {
  const entry = join(app.getAppPath(), 'scripts', 'start.mjs')
  if (!existsSync(entry)) throw new Error(`The desktop backend entry is missing: ${entry}`)

  const child = utilityProcess.fork(entry, ['desktop'], {
    cwd: app.getPath('userData'),
    env: desktopBackendEnvironment({
      baseEnv: process.env,
      port,
      rendererOrigin,
      userDataPath: app.getPath('userData'),
      authSecret: randomBytes(32).toString('base64url'),
      providerCredentials,
    }),
    serviceName: 'Agent Commons Backend',
    stdio: 'pipe',
  })
  backend = child
  dataBackend = createDataBackendClient(child)
  if (credentialVault) {
    credentialBackend = createCredentialBackendClient(child, {
      onBindings: (bindings) => void reconcileCredentialBindings(bindings),
    })
  }

  const marker = backendListenMarker(backendOrigin)
  const stderrTail = []
  await new Promise((resolve, reject) => {
    let settled = false
    const timeout = setTimeout(() => finish(new Error('The local backend did not start in time.')), START_TIMEOUT_MS)
    const finish = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      error ? reject(error) : resolve()
    }
    pipeLines(child.stdout, (line) => {
      console.log(`[backend] ${line}`)
      if (line.includes(marker)) finish()
    })
    pipeLines(child.stderr, (line) => {
      console.error(`[backend] ${line}`)
      stderrTail.push(line)
      if (stderrTail.length > 12) stderrTail.shift()
    })
    child.once('exit', (code) => {
      credentialBackend?.close()
      credentialBackend = null
      dataBackend?.close()
      dataBackend = null
      backend = null
      if (!settled) {
        const detail = stderrTail.length ? `\n\n${stderrTail.join('\n')}` : ''
        finish(new Error(`The local backend exited during startup (code ${code ?? 'unknown'}).${detail}`))
        return
      }
      if (quitting) return
      backendReady = false
      dialog.showErrorBox(
        'Agent Commons stopped',
        'The local service stopped unexpectedly. Your data remains on this device; reopen Agent Commons to recover.',
      )
      app.quit()
    })
  })
}

async function reconcileCredentialBindings(bindings) {
  if (!credentialVault || !credentialBackend) return
  try {
    const removed = await credentialVault.reconcile(bindings)
    await Promise.allSettled(removed.map((reference) => credentialBackend?.delete(reference)))
  } catch (error) {
    console.error('[desktop] credential reconciliation failed.', error)
  }
}

async function ensureRecoveryBackup() {
  if (!dataBackend) return
  try {
    const backup = await dataBackend.ensureRecoveryBackup()
    console.log(`[desktop] recovery ready ${backup.fileName}`)
  } catch (error) {
    // Recovery copies are defense in depth. A backup-volume problem is loud in
    // diagnostics but does not make an otherwise healthy acknowledged store
    // unavailable or strand the user outside the app.
    console.error('[desktop] automatic recovery backup failed.', error)
  }
}

function assertTrustedCredentialCaller(event) {
  assertTrustedDesktopCaller(event, 'Credential access is not available from this page.')
}

function assertTrustedDataCaller(event) {
  assertTrustedDesktopCaller(event, 'Desktop data controls are not available from this page.')
}

function assertTrustedContextCaller(event) {
  assertTrustedDesktopCaller(event, 'Desktop context selection is not available from this page.')
}

function assertTrustedDesktopCaller(event, message) {
  const callerUrl = event.senderFrame?.url
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents || !callerUrl || !isTrustedAppUrl(callerUrl, trustedOrigin)) {
    throw new Error(message)
  }
}

function installCredentialIpc() {
  const handle = (channel, operation) => {
    ipcMain.handle(channel, async (event, ...args) => {
      assertTrustedCredentialCaller(event)
      if (!credentialVault || !credentialBackend) throw new Error('Secure credential storage is unavailable.')
      try {
        return await operation(...args)
      } catch {
        // Credential failures are diagnosable by channel and the generic UI
        // refusal; never trust an OS/runtime error not to echo sensitive input.
        console.error(`[desktop] ${channel} failed.`)
        throw new Error('The credential could not be stored securely on this device.')
      }
    })
  }

  handle(credentialChannels.provision, async (secret) => {
    let reference
    try {
      reference = await credentialVault.provision(secret)
      await credentialBackend.set(reference, secret)
      return reference
    } catch (error) {
      if (reference) {
        await credentialVault.discard(reference).catch(() => {})
        await credentialBackend.delete(reference).catch(() => {})
      }
      throw error
    }
  })
  handle(credentialChannels.bind, async (reference, providerId) => {
    const retired = await credentialVault.bind(reference, providerId)
    // The acknowledged provider config can reference only the newly bound key.
    // Remove superseded values from the utility environment after the atomic
    // vault swap; a transient delete failure cannot reactivate an unreferenced
    // value and process exit clears it.
    await Promise.allSettled(retired.map((candidate) => credentialBackend.delete(candidate)))
  })
  handle(credentialChannels.discard, async (reference) => {
    await credentialVault.discard(reference)
    await credentialBackend.delete(reference)
  })
  handle(credentialChannels.removeProvider, async (providerId) => {
    const references = await credentialVault.removeProvider(providerId)
    await Promise.all(references.map((reference) => credentialBackend.delete(reference)))
  })
}

function installDataIpc() {
  ipcMain.handle(dataChannels.createBackup, async (event) => {
    assertTrustedDataCaller(event)
    if (!dataBackend) throw new Error('The local data service is unavailable.')
    try {
      return await dataBackend.createBackup()
    } catch (error) {
      console.error('[desktop] backup creation failed.', error)
      throw new Error('The backup could not be created. Your app data was not changed.')
    }
  })
  ipcMain.handle(dataChannels.revealBackups, async (event) => {
    assertTrustedDataCaller(event)
    try {
      await revealRecoveryDirectory({
        userDataPath: app.getPath('userData'),
        openPath: (directory) => shell.openPath(directory),
      })
    } catch (error) {
      console.error('[desktop] backup folder could not be shown.', error)
      throw new Error('The backup folder could not be opened.')
    }
  })
}

function installContextIpc() {
  ipcMain.handle(contextChannels.pickFiles, async (event, accept) => {
    assertTrustedContextCaller(event)
    return contextPicker.pickFiles(mainWindow, accept)
  })
  ipcMain.handle(contextChannels.pickFolder, async (event) => {
    assertTrustedContextCaller(event)
    return contextPicker.pickFolder(mainWindow)
  })
}

function pipeLines(stream, onLine) {
  if (!stream) return
  let pending = ''
  stream.setEncoding('utf8')
  stream.on('data', (chunk) => {
    pending += chunk
    const lines = pending.split(/\r?\n/)
    pending = lines.pop() ?? ''
    for (const line of lines) if (line) onLine(line)
  })
  stream.on('end', () => {
    if (pending) onLine(pending)
  })
}

async function waitForReady(url, origin, timeoutMs, requireReadyPayload = true) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { headers: { Origin: origin }, redirect: 'error' })
      if (response.ok) {
        if (!requireReadyPayload) return
        const body = await response.json()
        if (body?.status === 'ready') return
        lastError = new Error(`Local backend reported ${body?.status ?? 'an unknown state'}.`)
      } else {
        lastError = new Error(`Readiness probe returned HTTP ${response.status}.`)
      }
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Agent Commons could not become ready. ${lastError instanceof Error ? lastError.message : ''}`.trim())
}

async function createMainWindow(url, origin) {
  const win = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 320,
    minHeight: 360,
    show: false,
    backgroundColor: '#fbf9f9',
    title: 'Agent Commons',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      devTools: DEVELOPMENT,
      preload: join(app.getAppPath(), 'desktop', 'preload.cjs'),
      additionalArguments: credentialVault ? ['--agent-commons-secure-credentials'] : [],
    },
  })
  mainWindow = win

  const leaveApp = (candidate) => {
    if (isAllowedExternalUrl(candidate)) void shell.openExternal(candidate)
  }
  const guardNavigation = (event, candidate) => {
    if (isTrustedAppUrl(candidate, origin)) return
    event.preventDefault()
    leaveApp(candidate)
  }
  win.webContents.on('will-navigate', guardNavigation)
  win.webContents.on('will-redirect', guardNavigation)
  win.webContents.setWindowOpenHandler(({ url: candidate }) => {
    if (isTrustedAppUrl(candidate, origin)) void win.loadURL(candidate)
    else leaveApp(candidate)
    return { action: 'deny' }
  })
  win.webContents.on('render-process-gone', (_event, details) => {
    if (quitting) return
    console.error(`[desktop] renderer exited: ${details.reason}`)
  })
  win.once('ready-to-show', () => win.show())
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  await win.loadURL(url)
}

async function failStartup(error) {
  console.error(error)
  try {
    await offerStartupRecovery({
      showMessageBox: (options) => dialog.showMessageBox(options),
      userDataPath: app.getPath('userData'),
      openPath: (directory) => shell.openPath(directory),
    })
  } catch (recoveryError) {
    console.error('[desktop] startup recovery folder could not be shown.', recoveryError)
    dialog.showErrorBox('Couldn’t open Agent Commons', 'The app could not start, and its backup folder could not be opened.')
  }
  app.quit()
}

async function stopBackend() {
  const child = backend
  if (!child) return
  await new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      resolve()
    }
    child.once('exit', finish)
    child.kill()
    setTimeout(finish, STOP_TIMEOUT_MS)
  })
  backend = null
  credentialBackend?.close()
  credentialBackend = null
  dataBackend?.close()
  dataBackend = null
  backendReady = false
}

app.on('activate', () => {
  if (!ownsInstance) return
  if (mainWindow) focusMainWindow()
  else if (rendererUrl && trustedOrigin && backendReady) void createMainWindow(rendererUrl, trustedOrigin).catch(failStartup)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', (event) => {
  if (quitAfterBackend || !backend) return
  event.preventDefault()
  if (quitting) return
  quitting = true
  void stopBackend().finally(() => {
    quitAfterBackend = true
    app.quit()
  })
})
