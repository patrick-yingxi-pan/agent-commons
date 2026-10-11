import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { app, autoUpdater, BrowserWindow, Menu, dialog, ipcMain, safeStorage, session, shell, utilityProcess } from 'electron'
import credentialChannels from './credential-channels.cjs'
import contextChannels from './context-channels.cjs'
import localFolderChannels from './local-folder-channels.cjs'
import localGitChannels from './local-git-channels.cjs'
import imageOcrChannels from './image-ocr-channels.cjs'
import pdfOcrChannels from './pdf-ocr-channels.cjs'
import dataChannels from './data-channels.cjs'
import { AUTH_ROOT_FILE, DesktopAuthRootError, loadDesktopAuthSecret } from './authRoot.mjs'
import { DesktopUserDataError, ensureDesktopUserDataDirectory } from './userDataDirectory.mjs'
import { desktopProfileAclInspector } from './profileAcl.mjs'
import { createNativeContextPicker } from './contextPicker.mjs'
import { createLocalConnectionHost, localConnectionReply } from './localConnectionHost.mjs'
import { LocalConnectionError, LOCAL_CONNECTION_FILE, LOCAL_GIT_CONNECTION_FILE, openLocalConnectionStore } from './localConnectionStore.mjs'
import { createLocalGitReader, isLocalGitRoot } from './localGitReader.mjs'
import { readLocalGitReview } from './localGitReview.mjs'
import { bundledGitDirectory, verifyBundledGitDirectory } from './bundledGit.mjs'
import { gitFileExecutable } from './gitFileRead.mjs'
import { createImageOcrHost } from './imageOcrHost.mjs'
import { imageOcrExecutable } from './imageOcr.mjs'
import { createPdfOcrHost } from './pdfOcrHost.mjs'
import { pdfOcrExecutable } from './pdfOcr.mjs'
import { runBackendRecovery } from './backendRecovery.mjs'
import { createCredentialBackendClient } from './credentialProtocol.mjs'
import { createMcpCredentialHost } from './mcpCredentialProtocol.mjs'
import { createMcpCredentialLifecycle } from './mcpCredentialLifecycle.mjs'
import { createMcpOAuthCredentialHost } from './mcpOAuthCredentialProtocol.mjs'
import { createDesktopMcpOAuthRuntime, mcpOAuthChannels, mcpOAuthReply } from './mcpOAuthRuntime.mjs'
import { MCP_STDIO_GRANT_FILE, openMcpStdioGrantVault } from './mcpStdioGrantVault.mjs'
import { createMcpStdioSupervisor } from './mcpStdioSupervisor.mjs'
import { mcpStdioReviewLiteral } from './mcpStdioLaunch.mjs'
import { createMcpStdioLaunchAuthority } from './mcpStdioLaunchAuthority.mjs'
import { createMcpStdioLifecycle } from './mcpStdioLifecycle.mjs'
import { createMcpStdioHost } from './mcpStdioProtocol.mjs'
import { createMcpStdioSource } from './mcpStdioSource.mjs'
import { createMcpStdioSetup, mcpStdioChannels, mcpStdioReply } from './mcpStdioSetup.mjs'
import { waitForMcpStdioShutdown } from './mcpStdioShutdown.mjs'
import { createDataBackendClient, desktopRecoveryStatus } from './dataProtocol.mjs'
import { runManagedRestoreLifecycle } from './restoreLifecycle.mjs'
import { createDesktopUpdateController, desktopUpdateMenuLabel } from './updateController.mjs'
import { loadDesktopUpdateConfiguration } from './updateConfiguration.mjs'
import { relaunchAfterUpdateCleanup, runManagedUpdateLifecycle, stageNativeUpdate } from './updateLifecycle.mjs'
import { confirmManagedRestore, pickManagedBackup, waitForRestoreWorker } from './restoreProtocol.mjs'
import { runRendererRecovery } from './rendererRecovery.mjs'
import { offerStartupRecovery, revealRecoveryDirectory, runStartupRecovery } from './startupRecovery.mjs'
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
let mcpOAuthRuntime = null
let mcpOAuthBackend = null
let mcpOAuthSourceGeneration = 0
let mcpStdioVault = null
let mcpStdioSupervisor = null
let mcpStdioLifecycle = null
let mcpStdioSetup = null
let mcpStdioBackend = null
let dataBackend = null
let localFolderStore = null
let localFolderHost = null
let localGitStore = null
let localGitHost = null
let imageOcrHost = null
let pdfOcrHost = null
let localFolderCookieGeneration = 0
let quitting = false
let quitAfterBackend = false
let restoreInProgress = false

function beginShutdown() {
  // This is a one-way lifecycle transition: queued native work is refused and
  // in-flight local-folder captures are aborted before backend/window teardown.
  quitting = true
  localFolderStore?.shutdown()
  localGitStore?.shutdown()
  imageOcrHost?.dispose()
  pdfOcrHost?.dispose()
  mcpOAuthRuntime?.close()
  mcpOAuthBackend?.close()
  closeMcpStdio()
}
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
  try {
    localFolderStore = await openLocalConnectionStore({
      filePath: join(app.getPath('userData'), LOCAL_CONNECTION_FILE),
      storage: safeStorage,
    })
  } catch {
    console.warn('[desktop] remembered local-folder storage is unavailable for this run.')
  }
  if (process.platform === 'darwin') {
    try {
      const gitExecutable = await verifyBundledGitDirectory(bundledGitDirectory({ packaged: app.isPackaged, resourcesPath: process.resourcesPath }))
      const fileExecutable = gitFileExecutable({ packaged: app.isPackaged, resourcesPath: process.resourcesPath })
      const reader = createLocalGitReader({ gitExecutable, fileExecutable })
      localGitStore = await openLocalConnectionStore({
        filePath: join(app.getPath('userData'), LOCAL_GIT_CONNECTION_FILE), storage: safeStorage,
        connectionKind: 'git', validateRoot: isLocalGitRoot,
        inspectRoot: reader.inspectLocalGitRoot, capture: reader.readLocalGitSnapshot,
        review: (root, { signal }) => readLocalGitReview(root, { gitExecutable, fileExecutable, signal }),
      })
    } catch { console.warn('[desktop] local Git access is unavailable for this run.') }
  }
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

  session.defaultSession.cookies.on('changed', (_event, cookie) => {
    if (cookie?.name === 'uw_session') {
      localFolderCookieGeneration += 1
      resetMcpOAuthFlows()
    }
  })

  if (mcpCredentialVault) mcpOAuthRuntime = createDesktopMcpOAuthRuntime({
    vault: mcpCredentialVault,
    readSession: readMcpOAuthSession,
    isSessionCurrent: isMcpOAuthSessionCurrent,
    assertCaller: event => {
      assertTrustedMcpCredentialCaller(event)
      if (event.senderFrame !== event.sender.mainFrame) throw new Error('MCP sign-in requires the main frame.')
    },
    openBrowser: url => shell.openExternal(url),
  })
  if (process.platform === 'darwin') {
    try {
      mcpStdioVault = await openMcpStdioGrantVault({ filePath: join(app.getPath('userData'), MCP_STDIO_GRANT_FILE), storage: safeStorage })
      mcpStdioSupervisor = createMcpStdioSupervisor()
      const authority = createMcpStdioLaunchAuthority({ vault: mcpStdioVault, supervisor: mcpStdioSupervisor,
        confirmLaunch: confirmMcpStdioLaunch })
      mcpStdioLifecycle = createMcpStdioLifecycle({ vault: mcpStdioVault, authority })
      mcpStdioSetup = createMcpStdioSetup({ lifecycle: mcpStdioLifecycle,
        source: createMcpStdioSource({ readSession: readMcpOAuthSession, isSessionCurrent: isMcpOAuthSessionCurrent }),
        assertCaller: assertTrustedMcpStdioCaller })
    } catch {
      closeMcpStdio()
      mcpStdioLifecycle = null
      mcpStdioSetup = null
      console.warn('[desktop] local MCP process custody is unavailable for this run.')
    }
  }

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
  if (mcpOAuthRuntime) installMcpOAuthIpc()
  if (mcpStdioSetup) installMcpStdioIpc()
  installContextIpc()
  installLocalFolderIpc()
  installLocalGitIpc()
  installImageOcrIpc()
  installPdfOcrIpc()
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
        beginShutdown()
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
      mcpOAuthAvailable: Boolean(mcpOAuthRuntime),
      mcpStdioAvailable: Boolean(mcpStdioLifecycle),
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
  if (mcpOAuthRuntime) mcpOAuthBackend = createMcpOAuthCredentialHost(child, {
    resolve: (reference, binding, options) => mcpOAuthRuntime.resolveCredential(reference, binding, options),
  })
  if (mcpStdioLifecycle) mcpStdioBackend = createMcpStdioHost(child, {
    open: (reference, binding, options) => mcpStdioLifecycle.open(reference, binding, options),
    isCurrent: (reference, binding, purpose) => mcpStdioLifecycle.isCurrent(reference, binding, purpose),
    synchronize: async bindings => ({ available: await mcpStdioLifecycle.synchronize(bindings) }),
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
      mcpOAuthBackend?.close()
      mcpOAuthBackend = null
      mcpOAuthRuntime?.close()
      closeMcpStdio()
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

function assertTrustedOcrCaller(event) {
  assertTrustedDesktopCaller(event, 'Text recognition is not available from this page.')
  if (event.senderFrame !== event.sender.mainFrame) throw new Error('Text recognition is not available from this page.')
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

function resetMcpOAuthFlows() {
  mcpOAuthSourceGeneration += 1
  mcpOAuthRuntime?.resetFlows()
  mcpStdioSetup?.resetFlows()
}

function isMcpOAuthSessionCurrent(stamp) {
  return !quitting && backendReady && Boolean(mainWindow && !mainWindow.isDestroyed()) &&
    stamp === `native-oauth:${mcpOAuthSourceGeneration}`
}

async function readMcpOAuthSession() {
  const stamp = `native-oauth:${mcpOAuthSourceGeneration}`
  if (!isMcpOAuthSessionCurrent(stamp)) throw new Error('MCP sign-in is unavailable.')
  const cookies = await session.defaultSession.cookies.get({ url: trustedOrigin, name: 'uw_session' })
  if (!isMcpOAuthSessionCurrent(stamp) || cookies.length !== 1 || !cookies[0].value) {
    throw new Error('MCP sign-in is unavailable.')
  }
  return { origin: trustedOrigin, cookie: `uw_session=${cookies[0].value}`, stamp }
}

function installMcpOAuthIpc() {
  for (const [method, channel] of Object.entries(mcpOAuthChannels)) {
    ipcMain.handle(channel, (event, request) => mcpOAuthReply(() => mcpOAuthRuntime.host[method](event, request)))
  }
}

function assertTrustedMcpStdioCaller(event) {
  assertTrustedMcpCredentialCaller(event)
  if (event.senderFrame !== event.sender.mainFrame || !mcpStdioLifecycle) {
    throw new Error('Local MCP setup requires the trusted main frame.')
  }
}

async function confirmMcpStdioLaunch({ binding, launch }, { signal }) {
  if (signal.aborted || quitting || !mainWindow || mainWindow.isDestroyed()) return false
  // Render the exact configuration as escaped data. Control and bidi characters
  // cannot disguise paths/arguments; nothing here is emitted to logs or HTTP.
  const literal = mcpStdioReviewLiteral
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'warning', buttons: ['Cancel', 'Allow local server'], defaultId: 0, cancelId: 0, noLink: true,
    message: 'Allow this local MCP server to run?',
    detail: 'This is executable code, not a sandbox. It can access files, credentials and the network with your macOS account’s permissions, including during inspection. Only allow software you trust.\n\n' +
      'Agent Commons uses no shell and passes only the environment listed below. The saved configuration belongs to this person and connection. Each tool call still needs separate review; Routines and Contributions cannot use it.\n\n' +
      `Person: ${literal(binding.ownerUserId)}\nConnection: ${literal(binding.connectionId)}\n\n${literal(launch)}`,
  })
  return !signal.aborted && !quitting && result.response === 1
}

function installMcpStdioIpc() {
  for (const [method, channel] of Object.entries(mcpStdioChannels)) {
    ipcMain.handle(channel, (event, request) => mcpStdioReply(() => mcpStdioSetup[method](event, request)))
  }
}

function closeMcpStdio() {
  mcpStdioSetup?.close()
  mcpStdioBackend?.close()
  mcpStdioLifecycle?.close()
  const closing = mcpStdioSupervisor?.dispose()
  mcpStdioVault?.close()
  return closing
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

async function readBoundedJson(response, maxBytes = 8192) {
  if (!response.ok || !response.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new Error('identity unavailable')
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error('identity too large')
  const reader = response.body?.getReader()
  if (!reader) throw new Error('identity unavailable')
  const chunks = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > maxBytes) {
        await reader.cancel().catch(() => {})
        throw new Error('identity too large')
      }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
}

async function resolveLocalFolderSource() {
  if (!trustedOrigin || !backendReady || quitting) throw new LocalConnectionError()
  const generation = localFolderCookieGeneration
  const cookies = await session.defaultSession.cookies.get({ url: trustedOrigin })
  const sessionCookie = cookies.find((cookie) => cookie.name === 'uw_session')
  const cookieFingerprint = createHash('sha256').update(sessionCookie?.value ?? '').digest('hex')
  const response = await fetch(`${trustedOrigin}/api/v1/me`, {
    headers: {
      Accept: 'application/json',
      Origin: trustedOrigin,
      ...(sessionCookie ? { Cookie: `uw_session=${sessionCookie.value}` } : {}),
    },
    redirect: 'error',
    signal: AbortSignal.timeout(3000),
  })
  const identity = await readBoundedJson(response)
  if (generation !== localFolderCookieGeneration) throw new LocalConnectionError()
  return { identity, cookieGeneration: generation, cookieFingerprint }
}

function installLocalFolderIpc() {
  if (localFolderStore) {
    localFolderHost = createLocalConnectionHost({
      store: localFolderStore,
      assertCaller: (event) => assertTrustedDesktopCaller(event, 'Local folder access is not available from this page.'),
      resolveSource: resolveLocalFolderSource,
      showFolderDialog: async () => dialog.showOpenDialog(mainWindow, { title: 'Connect folder', properties: ['openDirectory'] }),
      isClosing: () => quitting || !backendReady || !mainWindow || mainWindow.isDestroyed(),
    })
  }
  for (const [name, method] of Object.entries(localFolderChannels)) {
    ipcMain.handle(method, async (event, ...args) => {
      const reply = await localConnectionReply(async () => {
        if (!localFolderHost) throw new LocalConnectionError()
        return await localFolderHost[name](event, ...args)
      })
      if (!reply.ok) console.warn(`[desktop] ${method} failed.`)
      return reply
    })
  }
}

function installLocalGitIpc() {
  if (process.platform !== 'darwin') return
  if (localGitStore) localGitHost = createLocalConnectionHost({
    store: localGitStore, connectionKind: 'git',
    assertCaller: (event) => assertTrustedDesktopCaller(event, 'Git access is not available from this page.'),
    resolveSource: resolveLocalFolderSource,
    showFolderDialog: async () => dialog.showOpenDialog(mainWindow, { title: 'Connect repository', properties: ['openDirectory'] }),
    isClosing: () => quitting || !backendReady || !mainWindow || mainWindow.isDestroyed(),
  })
  for (const [name, channel] of Object.entries(localGitChannels)) ipcMain.handle(channel, async (event, ...args) => {
    const reply = await localConnectionReply(async () => {
      if (!localGitHost) throw new LocalConnectionError()
      return localGitHost[name](event, ...args)
    })
    if (!reply.ok) console.warn(`[desktop] ${channel} failed.`)
    return reply
  })
}

function installImageOcrIpc() {
  if (process.platform !== 'darwin') return
  imageOcrHost = createImageOcrHost({
    targetPlatform: process.platform,
    executable: imageOcrExecutable({ packaged: app.isPackaged, resourcesPath: process.resourcesPath, targetPlatform: process.platform }),
    assertCaller: assertTrustedOcrCaller,
    isClosing: () => quitting || !backendReady || !mainWindow || mainWindow.isDestroyed(),
  })
  ipcMain.handle(imageOcrChannels.recognize, (event, ...args) => imageOcrHost?.recognize(event, ...args) ?? { status: 'unavailable' })
  ipcMain.handle(imageOcrChannels.cancel, (event, ...args) => imageOcrHost?.cancel(event, ...args) ?? false)
}

function installPdfOcrIpc() {
  if (process.platform !== 'darwin') return
  pdfOcrHost = createPdfOcrHost({
    targetPlatform: process.platform,
    executable: pdfOcrExecutable({ packaged: app.isPackaged, resourcesPath: process.resourcesPath, targetPlatform: process.platform }),
    assertCaller: assertTrustedOcrCaller,
    isClosing: () => quitting || !backendReady || !mainWindow || mainWindow.isDestroyed(),
  })
  ipcMain.handle(pdfOcrChannels.recognize, (event, ...args) => pdfOcrHost?.recognize(event, ...args) ?? { status: 'unavailable' })
  ipcMain.handle(pdfOcrChannels.cancel, (event, ...args) => pdfOcrHost?.cancel(event, ...args) ?? false)
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
        ...(mcpOAuthRuntime ? ['--agent-commons-mcp-oauth=true'] : []),
        ...(mcpStdioSetup ? ['--agent-commons-mcp-stdio=true'] : []),
      ],
    },
  })
  mainWindow = win
  const contents = win.webContents
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
  win.webContents.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => {
    if (isMainFrame) imageOcrHost?.cancelSender(contents)
    if (isMainFrame) pdfOcrHost?.cancelSender(contents)
    if (isMainFrame && !_inPlace) resetMcpOAuthFlows()
  })
  win.webContents.setWindowOpenHandler(({ url: candidate }) => {
    if (isTrustedAppUrl(candidate, origin)) void win.loadURL(candidate)
    else leaveApp(candidate)
    return { action: 'deny' }
  })
  win.webContents.on('render-process-gone', (_event, details) => {
    resetMcpOAuthFlows()
    imageOcrHost?.cancelSender(contents)
    pdfOcrHost?.cancelSender(contents)
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
    imageOcrHost?.cancelSender(contents)
    pdfOcrHost?.cancelSender(contents)
    resetMcpOAuthFlows()
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
  await runStartupRecovery({
    offerRecovery: () => offerStartupRecovery({
      showMessageBox: (options) => dialog.showMessageBox(options),
      userDataPath: app.getPath('userData'),
      openPath: (directory) => shell.openPath(directory),
    }),
    restoreBackup: () => restoreFromManagedBackup({ startup: true }),
    reportFailure: ({ phase, error: recoveryError }) => {
      if (phase === 'restore') {
        console.error('[desktop] startup backup restore could not begin.', recoveryError)
        dialog.showErrorBox(
          'Couldn’t restore backup',
          'The selected backup was not restored. Your managed backups remain available.',
        )
      } else {
        console.error('[desktop] startup recovery folder could not be shown.', recoveryError)
        dialog.showErrorBox('Couldn’t open Agent Commons', 'The app could not start, and its backup folder could not be opened.')
      }
    },
    quit: () => app.quit(),
  })
}

async function stopBackend({ requireExit = false } = {}) {
  const nativeStopped = await waitForMcpStdioShutdown(closeMcpStdio)
  if (!nativeStopped) {
    if (requireExit) throw new Error('Local MCP process cleanup is unconfirmed; the requested operation was refused.')
    console.warn('[desktop] local MCP process cleanup could not be confirmed before shutdown.')
  }
  const child = backend
  if (!child) return nativeStopped
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
  mcpOAuthBackend?.close()
  mcpOAuthBackend = null
  mcpOAuthRuntime?.close()
  closeMcpStdio()
  dataBackend?.close()
  dataBackend = null
  backendReady = false
  return nativeStopped
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
        beginShutdown()
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
  if (quitAfterBackend || (!backend && !desktopUpdater)) {
    beginShutdown()
    return
  }
  event.preventDefault()
  if (updateInProgress) return
  if (quitting) return
  beginShutdown()
  void Promise.resolve().then(() => desktopUpdater?.dispose())
    .catch(error => console.warn('[desktop] temporary update cleanup failed.', error))
    .then(() => stopBackend()).finally(() => {
    quitAfterBackend = true
    app.quit()
  })
})
