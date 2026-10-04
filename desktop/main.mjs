import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app, autoUpdater, BrowserWindow, Menu, dialog, ipcMain, safeStorage, session, shell, utilityProcess } from 'electron'
import credentialChannels from './credential-channels.cjs'
import contextChannels from './context-channels.cjs'
import dataChannels from './data-channels.cjs'
import { AUTH_ROOT_FILE, DesktopAuthRootError, loadDesktopAuthSecret } from './authRoot.mjs'
import { DesktopUserDataError, ensureDesktopUserDataDirectory } from './userDataDirectory.mjs'
import { desktopProfileAclInspector } from './profileAcl.mjs'
import { createNativeContextPicker } from './contextPicker.mjs'
import { runBackendRecovery } from './backendRecovery.mjs'
import { createCredentialBackendClient } from './credentialProtocol.mjs'
import { createMcpCredentialHost } from './mcpCredentialProtocol.mjs'
import { createMcpCredentialLifecycle } from './mcpCredentialLifecycle.mjs'
import { createDataBackendClient, desktopRecoveryStatus } from './dataProtocol.mjs'
import { runManagedRestoreLifecycle } from './restoreLifecycle.mjs'
import { createDesktopUpdateController, desktopUpdateMenuLabel } from './updateController.mjs'
import { loadDesktopUpdateConfiguration } from './updateConfiguration.mjs'
import { relaunchAfterUpdateCleanup, runManagedUpdateLifecycle, stageNativeUpdate } from './updateLifecycle.mjs'
import { confirmManagedRestore, pickManagedBackup, waitForRestoreWorker } from './restoreProtocol.mjs'
import { runRendererRecovery } from './rendererRecovery.mjs'
import { offerStartupRecovery, revealRecoveryDirectory } from './startupRecovery.mjs'
import {
  CREDENTIAL_VAULT_FILE,
  openCredentialVault,
  secureStorageAvailable,
} from './credentialVault.mjs'
import { MCP_CREDENTIAL_FILE, openMcpCredentialVault } from './mcpCredentialVault.mjs'
import {
  backendListenMarker,
  desktopBackendEnvironment,
  desktopRestoreEnvironment,
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
const MCP_CREDENTIAL_CAPABILITY = 'mcp-provision-v1'
const mcpCredentialChannels = Object.freeze({ provision: 'agent-commons:mcp-credentials:provision' })

let mainWindow = null
let ownsInstance = false
let backend = null
let backendReady = false
let desktopReady = false
let credentialVault = null
let credentialBackend = null
let mcpCredentialVault = null
let mcpCredentialBackend = null
let mcpCredentialLifecycle = null
let dataBackend = null
let quitting = false
let quitAfterBackend = false
let restoreInProgress = false
let updateInProgress = false
let desktopUpdater = null
let backendRecoveryInProgress = false
let rendererRecoveryInProgress = false
let automaticRecovery = desktopRecoveryStatus()
let rendererUrl = null
let trustedOrigin = null
const contextPicker = createNativeContextPicker({
  showOpenDialog: (owner, options) => dialog.showOpenDialog(owner, options),
})

app.enableSandbox()
if (!app.isPackaged) app.setPath('userData', join(app.getPath('appData'), 'Agent Commons Development'))

try {
  // No await before admission: even the instance lock can write into userData.
  ensureDesktopUserDataDirectory(app.getPath('userData'), {
    protectedPaths: [app.getPath('appData')],
    inspectAcl: desktopProfileAclInspector({ packaged: app.isPackaged, resourcesPath: process.resourcesPath }),
  })
  ownsInstance = app.requestSingleInstanceLock()
  if (!ownsInstance) {
    app.quit()
  } else {
    app.on('second-instance', () => focusMainWindow())
    app.whenReady().then(startDesktop).catch(failStartup)
  }
} catch (error) {
  void failStartup(error)
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
  const authSecret = await loadDesktopAuthSecret({
    filePath: join(app.getPath('userData'), AUTH_ROOT_FILE),
    storage: safeStorage,
  })
  credentialVault = await openDesktopCredentialVault()
  mcpCredentialVault = await openMcpCredentialVaultForDesktop()
  mcpCredentialLifecycle = mcpCredentialVault ? createMcpCredentialLifecycle(mcpCredentialVault) : null
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
  const backendHandle = await launchBackend({ port, backendOrigin, rendererOrigin: trustedOrigin, providerCredentials, authSecret })
  const backendFailure = () => backendHandle.exitError
  await waitForReady(`${backendOrigin}/api/v1/readyz`, trustedOrigin, START_TIMEOUT_MS, true, backendFailure)
  if (DEVELOPMENT) await waitForReady(rendererUrl, trustedOrigin, START_TIMEOUT_MS, false, backendFailure)
  await ensureRecoveryBackup()
  assertCurrentBackend(backendHandle)

  backendReady = true
  if (credentialVault) installCredentialIpc()
  if (mcpCredentialVault) installMcpCredentialIpc()
  installContextIpc()
  installDataIpc()
  await createMainWindow(rendererUrl, trustedOrigin)
  assertCurrentBackend(backendHandle)
  desktopReady = true
  await initializeDesktopUpdater()
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

async function openMcpCredentialVaultForDesktop() {
  try {
    const encryptionAvailable = safeStorage.isEncryptionAvailable()
    const linuxBackend = process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : undefined
    if (!secureStorageAvailable({ encryptionAvailable, linuxBackend })) {
      console.warn('[desktop] secure MCP credential storage is unavailable.')
      return null
    }
    return await openMcpCredentialVault({
      filePath: join(app.getPath('userData'), MCP_CREDENTIAL_FILE),
      encrypt: (secret) => safeStorage.encryptString(secret),
      decrypt: (ciphertext) => safeStorage.decryptString(ciphertext),
    })
  } catch (error) {
    console.error('[desktop] secure MCP credential storage could not be opened.', error)
    return null
  }
}

function installApplicationMenu() {
  const template = []
  if (process.platform === 'darwin') template.push({
    label: 'Agent Commons',
    submenu: [
      { role: 'about' },
      {
        id: 'check-for-updates',
        label: desktopUpdateMenuLabel(desktopUpdater?.state ?? { phase: 'unconfigured' }),
        enabled: Boolean(desktopUpdater) && desktopReady && !quitting &&
          !['checking', 'downloading', 'installing'].includes(desktopUpdater?.state.phase),
        click: () => {
          focusMainWindow()
          void desktopUpdater.action().catch(error => console.error('[desktop] update action failed.', error))
        },
      },
      { type: 'separator' }, { role: 'services' }, { type: 'separator' },
      { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
      { type: 'separator' }, { role: 'quit' },
    ],
  })
  template.push({ role: 'editMenu' }, { role: 'windowMenu' })
  if (DEVELOPMENT) template.push({ role: 'viewMenu' })
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function canOfferUpdate() {
  return desktopReady && backendReady && !quitting && !restoreInProgress && !updateInProgress &&
    !backendRecoveryInProgress && !rendererRecoveryInProgress && mainWindow && !mainWindow.isDestroyed()
}

async function updateMessage(options, signal) {
  if (!canOfferUpdate() || signal?.aborted) return { response: 0 }
  return dialog.showMessageBox(mainWindow, { title: 'Agent Commons Updates', type: 'info',
    buttons: ['OK'], defaultId: 0, cancelId: 0, ...options, signal })
}

async function initializeDesktopUpdater() {
  let configuration = null
  try {
    configuration = await loadDesktopUpdateConfiguration({
      packaged: app.isPackaged, development: DEVELOPMENT, platform: process.platform,
      architecture: process.arch, currentVersion: app.getVersion(), resourcesPath: process.resourcesPath,
    })
  } catch (error) { console.warn('[desktop] invalid bundled update configuration; updates disabled.', error) }
  autoUpdater.on('error', error => console.error('[desktop] native update failed.', error))
  desktopUpdater = createDesktopUpdateController({
    configuration,
    confirmDownload: async (update, signal) => {
      if (!canOfferUpdate() || !mainWindow.isFocused()) return false
      const result = await updateMessage({
        message: `Agent Commons ${update.version} is available`,
        detail: `Download the ${Math.ceil(update.bytes / 1024 ** 2)} MB update? You can keep working while it downloads. Installation and restart require a separate confirmation.`,
        buttons: ['Later', 'Download Update'],
      }, signal)
      return result.response === 1 && canOfferUpdate()
    },
    confirmInstall: async (update, signal) => {
      if (!canOfferUpdate() || !mainWindow.isFocused()) return false
      const result = await updateMessage({
        type: 'warning',
        message: `Install Agent Commons ${update.version} and restart?`,
        detail: 'Finish any active work and save unsent drafts first. A safety backup of saved local data will be made before the app closes. Once installation begins, this approved update may also finish on the next launch.',
        buttons: ['Later', 'Install and Restart'],
      }, signal)
      return result.response === 1 && canOfferUpdate()
    },
    inform: (kind, signal) => updateMessage(kind === 'unconfigured' ? {
      message: 'Updates are not configured for this build',
      detail: 'Development builds do not check a public update service. Signed direct-download releases include their verified update location.',
    } : kind === 'current' ? {
      message: 'Agent Commons is up to date', detail: `You’re using version ${app.getVersion()}.`,
    } : {
      type: 'warning', message: 'Couldn’t check or prepare the update',
      detail: 'The update was not started. Your current app and saved local data are unchanged. Try again from the Agent Commons menu.',
    }, signal),
    install: installApprovedDesktopUpdate,
    onState: state => {
      installApplicationMenu()
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setProgressBar(['downloading', 'installing'].includes(state.phase) ? 2 : -1)
      }
    },
    onError: error => console.warn('[desktop] update check or preparation failed.', error),
  })
  installApplicationMenu()
  desktopUpdater.start()
}

async function installApprovedDesktopUpdate({ update, archive }) {
  if (!canOfferUpdate()) throw new Error('The app is not ready to install an update.')
  updateInProgress = true
  mainWindow.setEnabled(false)
  let shutdownStarted = false
  try {
    return await runManagedUpdateLifecycle({
      createSafetyBackup: () => dataBackend.createBackup(),
      stopBackend: async () => {
        quitting = true
        shutdownStarted = true
        await stopBackend({ requireExit: true })
      },
      stageUpdate: () => stageNativeUpdate({ updater: autoUpdater, archivePath: archive.archivePath, update }),
      discardDownload: () => archive.dispose(),
      installAndRestart: () => {
        quitAfterBackend = true
        autoUpdater.quitAndInstall()
      },
      reportShutdownFailure: async ({ error, safetyBackup }) => {
        console.error('[desktop] update failed after shutdown began.', error)
        try { await archive.dispose() }
        catch (cleanupError) { console.warn('[desktop] temporary update cleanup failed.', cleanupError) }
        dialog.showErrorBox('Couldn’t finish the update',
          `Agent Commons will restart. Your saved data and safety copy ${safetyBackup.fileName} remain on this device. If the approved update was already staged, it may complete on launch.`)
      },
      restart: relaunchDesktop,
    })
  } finally {
    if (!shutdownStarted) {
      updateInProgress = false
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setEnabled(true)
    }
  }
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

async function launchBackend({ port, backendOrigin, rendererOrigin, providerCredentials, authSecret }) {
  const entry = join(app.getAppPath(), 'scripts', 'start.mjs')
  if (!existsSync(entry)) throw new Error(`The desktop backend entry is missing: ${entry}`)

  const child = utilityProcess.fork(entry, ['desktop'], {
    cwd: app.getPath('userData'),
    env: desktopBackendEnvironment({
      baseEnv: process.env,
      port,
      rendererOrigin,
      userDataPath: app.getPath('userData'),
      authSecret,
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
  mcpCredentialBackend = createMcpCredentialHost(child, {
    resolve: async (reference, binding) => {
      if (!mcpCredentialVault) throw new Error('The MCP credential vault is unavailable.')
      return mcpCredentialVault.read(reference, binding)
    },
    onSynchronizeBindings: bindings => mcpCredentialLifecycle ? mcpCredentialLifecycle.synchronize(bindings) : false,
  })

  const handle = { child, exitError: null }
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
      const detail = stderrTail.length ? `\n\n${stderrTail.join('\n')}` : ''
      const exitError = new Error(`The local backend exited unexpectedly (code ${code ?? 'unknown'}).${detail}`)
      handle.exitError = exitError
      credentialBackend?.close()
      credentialBackend = null
      mcpCredentialBackend?.close()
      mcpCredentialBackend = null
      dataBackend?.close()
      dataBackend = null
      backend = null
      if (!settled) {
        finish(exitError)
        return
      }
      backendReady = false
      if (!desktopReady || quitting || backendRecoveryInProgress) return
      desktopReady = false
      void desktopUpdater?.dispose().catch(error => console.warn('[desktop] temporary update cleanup failed.', error))
      backendRecoveryInProgress = true
      void runBackendRecovery({
        showMessageBox: (options) => mainWindow && !mainWindow.isDestroyed()
          ? dialog.showMessageBox(mainWindow, options)
          : dialog.showMessageBox(options),
        restart: relaunchDesktop,
        reportRestartFailure: (error) => {
          console.error('[desktop] restart after backend loss failed.', error)
          dialog.showErrorBox(
            'Couldn’t restart Agent Commons',
            'Agent Commons could not restart. Your saved local data remains on this device; the app will quit.',
          )
        },
        quit: () => app.quit(),
      }).catch((error) => {
        console.error('[desktop] backend recovery failed.', error)
        if (!quitting) app.quit()
      }).finally(() => {
        backendRecoveryInProgress = false
      })
    })
  })
  return handle
}

function assertCurrentBackend(handle) {
  if (handle.exitError) throw handle.exitError
  if (backend !== handle.child) throw new Error('The local backend stopped before Agent Commons became ready.')
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
  automaticRecovery = desktopRecoveryStatus()
  if (!dataBackend) return
  try {
    const backup = await dataBackend.ensureRecoveryBackup()
    automaticRecovery = desktopRecoveryStatus(backup)
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

function assertTrustedMcpCredentialCaller(event) {
  assertTrustedDesktopCaller(event, 'MCP credential access is not available from this page.')
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

function installMcpCredentialIpc() {
  ipcMain.handle(mcpCredentialChannels.provision, async (event, binding, secret, capability) => {
    assertTrustedMcpCredentialCaller(event)
    if (capability !== MCP_CREDENTIAL_CAPABILITY || !mcpCredentialLifecycle) {
      throw new Error('MCP credential storage is unavailable.')
    }
    try {
      return await mcpCredentialLifecycle.provision(binding, secret)
    } catch {
      console.error(`[desktop] ${mcpCredentialChannels.provision} failed.`)
      throw new Error('The MCP credential could not be stored securely on this device.')
    }
  })
}

function installDataIpc() {
  ipcMain.handle(dataChannels.getRecoveryStatus, (event) => {
    assertTrustedDataCaller(event)
    return automaticRecovery
  })
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
  ipcMain.handle(dataChannels.restoreBackup, async (event) => {
    assertTrustedDataCaller(event)
    try {
      return await restoreFromManagedBackup()
    } catch (error) {
      console.error('[desktop] backup restore could not begin.', error)
      throw new Error('The backup could not be restored. Your current app data was not changed.')
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

async function waitForReady(url, origin, timeoutMs, requireReadyPayload = true, failure = () => null) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    const fatal = failure()
    if (fatal) throw fatal
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
  const fatal = failure()
  if (fatal) throw fatal
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
      additionalArguments: [
        ...(credentialVault ? ['--agent-commons-secure-credentials'] : []),
        ...(mcpCredentialVault ? ['--agent-commons-mcp-credentials'] : []),
      ],
    },
  })
  mainWindow = win
  let initialLoadComplete = false

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
    if (!initialLoadComplete || quitting || rendererRecoveryInProgress || win.isDestroyed() || mainWindow !== win) return
    console.error(`[desktop] renderer exited: ${details.reason}`)
    const currentUrl = win.webContents.getURL()
    const recoveryUrl = isTrustedAppUrl(currentUrl, origin) ? currentUrl : url
    rendererRecoveryInProgress = true
    void runRendererRecovery({
      showMessageBox: (options) => dialog.showMessageBox(win, options),
      reopen: async () => {
        if (quitting || !backendReady || win.isDestroyed() || mainWindow !== win) {
          throw new Error('The desktop window is no longer recoverable.')
        }
        await win.loadURL(recoveryUrl)
        win.show()
        win.focus()
      },
      reportReopenFailure: (error) => {
        console.error('[desktop] renderer could not be reopened.', error)
        dialog.showErrorBox(
          'Couldn’t reopen Agent Commons',
          'The window could not be reopened. Your saved local data remains on this device. Agent Commons will quit.',
        )
      },
      quit: () => app.quit(),
    }).catch((error) => {
      console.error('[desktop] renderer recovery failed.', error)
      if (!quitting) app.quit()
    }).finally(() => {
      rendererRecoveryInProgress = false
    })
  })
  win.once('ready-to-show', () => win.show())
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  await win.loadURL(url)
  initialLoadComplete = true
}

async function failStartup(error) {
  if (error instanceof DesktopUserDataError) {
    console.error('[desktop] profile admission refused; no application data opened.')
    dialog.showErrorBox('Couldn’t protect Agent Commons data', error.message)
    app.exit(1)
    return
  }
  if (error instanceof DesktopAuthRootError) {
    dialog.showErrorBox('Couldn’t unlock Agent Commons', error.message)
    app.quit()
    return
  }
  console.error(error)
  try {
    const action = await offerStartupRecovery({
      showMessageBox: (options) => dialog.showMessageBox(options),
      userDataPath: app.getPath('userData'),
      openPath: (directory) => shell.openPath(directory),
    })
    if (action === 'restore') {
      try {
        await restoreFromManagedBackup({ startup: true })
        return
      } catch (restoreError) {
        console.error('[desktop] startup backup restore could not begin.', restoreError)
        dialog.showErrorBox(
          'Couldn’t restore backup',
          'The selected backup was not restored. Your managed backups remain available.',
        )
      }
    }
  } catch (recoveryError) {
    console.error('[desktop] startup recovery folder could not be shown.', recoveryError)
    dialog.showErrorBox('Couldn’t open Agent Commons', 'The app could not start, and its backup folder could not be opened.')
  }
  app.quit()
}

async function stopBackend({ requireExit = false } = {}) {
  const child = backend
  if (!child) return true
  const exited = await new Promise((resolve) => {
    let settled = false
    const finish = (didExit) => {
      if (settled) return
      settled = true
      resolve(didExit)
    }
    child.once('exit', () => finish(true))
    child.kill()
    setTimeout(() => finish(false), STOP_TIMEOUT_MS)
  })
  if (!exited) {
    if (requireExit) throw new Error('The local backend did not stop; the requested operation was refused.')
    return false
  }
  backend = null
  credentialBackend?.close()
  credentialBackend = null
  mcpCredentialBackend?.close()
  mcpCredentialBackend = null
  dataBackend?.close()
  dataBackend = null
  backendReady = false
  return true
}

async function runRestoreWorker(snapshotName) {
  const entry = join(app.getAppPath(), 'desktop', 'restoreWorker.mjs')
  if (!existsSync(entry)) throw new Error('The desktop restore worker is missing.')
  const child = utilityProcess.fork(entry, [snapshotName], {
    cwd: app.getPath('userData'),
    env: desktopRestoreEnvironment(app.getPath('userData')),
    serviceName: 'Agent Commons Restore',
    stdio: 'pipe',
  })
  await waitForRestoreWorker(child, snapshotName)
}

function relaunchDesktop(exitCode = 0) {
  return relaunchAfterUpdateCleanup({
    disposeUpdates: () => updateInProgress ? Promise.resolve() : desktopUpdater?.dispose(),
    onCleanupError: error => console.warn('[desktop] temporary update cleanup failed before relaunch.', error),
    relaunch: () => app.relaunch(), exit: code => app.exit(code), exitCode,
  })
}

async function restoreFromManagedBackup({ startup = false } = {}) {
  if (updateInProgress) throw new Error('An update is already in progress.')
  if (restoreInProgress) throw new Error('A restore is already in progress.')
  restoreInProgress = true
  let shutdownStarted = false
  try {
    const selection = await pickManagedBackup({
      owner: mainWindow,
      userDataPath: app.getPath('userData'),
      showOpenDialog: (owner, options) => owner
        ? dialog.showOpenDialog(owner, options)
        : dialog.showOpenDialog(options),
    })
    if (selection.status === 'cancelled') return { status: 'cancelled' }
    const confirmed = await confirmManagedRestore({
      owner: mainWindow,
      fileName: selection.fileName,
      startup,
      showMessageBox: (owner, options) => owner
        ? dialog.showMessageBox(owner, options)
        : dialog.showMessageBox(options),
    })
    if (!confirmed) return { status: 'cancelled' }
    return await runManagedRestoreLifecycle({
      startup,
      createSafetyBackup: async () => {
        if (!dataBackend) throw new Error('The local data service is unavailable.')
        const backup = await dataBackend.createBackup()
        console.log(`[desktop] pre-restore safety backup ${backup.fileName}`)
        return backup
      },
      stopBackend: async () => {
        quitting = true
        shutdownStarted = true
        await stopBackend({ requireExit: true })
      },
      restoreSnapshot: async () => {
        await runRestoreWorker(selection.snapshotName)
        console.log(`[desktop] restored ${selection.fileName}; restarting`)
      },
      reportShutdownFailure: ({ error, safetyBackup }) => {
        console.error('[desktop] restore failed after shutdown began.', error)
        dialog.showErrorBox(
          'Couldn’t restore backup',
          safetyBackup
            ? `The restore failed. Your pre-restore safety copy ${safetyBackup.fileName} remains in Backups. Agent Commons will restart.`
            : 'The restore failed. Your managed backups remain unchanged. Agent Commons will restart.',
        )
      },
      restart: relaunchDesktop,
    })
  } finally {
    if (!shutdownStarted) restoreInProgress = false
  }
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
  if (quitAfterBackend || (!backend && !desktopUpdater)) return
  event.preventDefault()
  if (updateInProgress) return
  if (quitting) return
  quitting = true
  void Promise.resolve().then(() => desktopUpdater?.dispose())
    .catch(error => console.warn('[desktop] temporary update cleanup failed.', error))
    .then(() => stopBackend()).finally(() => {
    quitAfterBackend = true
    app.quit()
  })
})
