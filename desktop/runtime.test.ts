import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  backendListenMarker,
  desktopBackendEnvironment,
  desktopRestoreEnvironment,
  exactLoopbackOrigin,
  isAllowedExternalUrl,
  isTrustedAppUrl,
  loopbackOrigin,
  permissionAllowed,
} from './runtime.mjs'
import packagerConfig, { ignoreFromPackage } from './packager.config.mjs'
import { packagedExecutable } from './smoke.mjs'
import credentialChannels from './credential-channels.cjs'
import contextChannels from './context-channels.cjs'
import localFolderChannels from './local-folder-channels.cjs'
import localGitChannels from './local-git-channels.cjs'
import imageOcrChannels from './image-ocr-channels.cjs'
import dataChannels from './data-channels.cjs'

function assertInOrder(source, parts, message) {
  let previous = -1
  for (const part of parts) {
    const position = source.indexOf(part)
    assert.ok(position > previous, `${message}: ${part}`)
    previous = position
  }
}

function assertImageOcrWiring(main, preload) {
  for (const channel of Object.values(imageOcrChannels)) assert.ok(preload.includes(channel))
  assert.match(preload, /process\.platform === 'darwin' \? \{ imageOcr: Object\.freeze/)
  assert.match(main, /assertTrustedDesktopCaller\(event, 'Text recognition[^]*event\.senderFrame !== event\.sender\.mainFrame/)
  assert.match(main, /function installImageOcrIpc\(\) \{\s*if \(process\.platform !== 'darwin'\) return/)
  assert.match(main, /imageOcrExecutable\(\{ packaged: app\.isPackaged, resourcesPath: process\.resourcesPath/)
  assert.match(main, /assertCaller: assertTrustedOcrCaller/)
  assert.match(main, /ipcMain\.handle\(imageOcrChannels\.recognize/)
  assert.match(main, /ipcMain\.handle\(imageOcrChannels\.cancel/)
  assert.match(main, /'did-start-navigation'[^]*if \(isMainFrame\) imageOcrHost\?\.cancelSender/)
  assert.match(main, /'render-process-gone'[^]*imageOcrHost\?\.cancelSender/)
  assert.match(main, /win\.on\('closed', \(\) => \{\s*imageOcrHost\?\.cancelSender/)
  assert.match(main, /function beginShutdown\(\)[^]*imageOcrHost\?\.dispose\(\)/)
  assertInOrder(main, ['installImageOcrIpc()', 'await createMainWindow(rendererUrl'], 'OCR bridge installation precedes the renderer')
}

test('image OCR is main-frame-only, explicit and disposed with its native window/process lifetime', () => {
  const main = readFileSync(new URL('./main.mjs', import.meta.url), 'utf8')
  const preload = readFileSync(new URL('./preload.cjs', import.meta.url), 'utf8')
  assertImageOcrWiring(main, preload)
  const mutated = main.replaceAll('assertCaller: assertTrustedOcrCaller', 'assertCaller: () => {}')
  assert.notEqual(mutated, main)
  assert.throws(() => assertImageOcrWiring(mutated, preload), assert.AssertionError)
})

function assertDesktopUpdaterWiring(main, preload) {
  assert.match(main, /import \{[^}]*autoUpdater[^}]*\} from 'electron'/,
    'native Electron main process owns the updater')
  assert.doesNotMatch(preload, /autoUpdater|checkForUpdates|quitAndInstall|updateController|update-feed|updates:/i,
    'the preload exposes no update authority to the renderer')

  const admission = main.slice(main.indexOf('ownsInstance = app.requestSingleInstanceLock()'), main.indexOf('function focusMainWindow()'))
  assert.match(admission, /if \(!ownsInstance\) \{\s*app\.quit\(\)\s*\} else \{[^]*app\.whenReady\(\)\.then\(startDesktop\)/,
    'only the lock owner starts ready-driven product work')
  const activate = main.slice(main.indexOf("app.on('activate'"), main.indexOf("app.on('window-all-closed'"))
  assert.match(activate, /if \(!ownsInstance\) return/,
    'activation cannot create a window from a non-owning instance')

  const startup = main.slice(main.indexOf('async function startDesktop()'), main.indexOf('async function openDesktopCredentialVault()'))
  assertInOrder(startup, ['await createMainWindow(', 'desktopReady = true', 'await initializeDesktopUpdater()'],
    'update controller initializes only after ready window startup')

  const menu = main.slice(main.indexOf('function installApplicationMenu()'), main.indexOf('function canOfferUpdate()'))
  assert.match(menu, /id: 'check-for-updates'/)
  assert.match(menu, /desktopUpdater\.action\(\)/,
    'the native menu dispatches the host-owned update action')
  const updater = main.slice(main.indexOf('async function initializeDesktopUpdater()'), main.indexOf('async function installApprovedDesktopUpdate'))
  assert.match(updater, /buttons: \['Later', 'Download Update'\]/)
  assert.match(updater, /buttons: \['Later', 'Install and Restart'\]/)
  const nativeDialog = main.slice(main.indexOf('async function updateMessage('), main.indexOf('async function initializeDesktopUpdater()'))
  assert.match(nativeDialog, /defaultId: 0, cancelId: 0/,
    'both consent dialogs default and cancel to Later')
  assert.match(updater, /result\.response === 1 && canOfferUpdate\(\)/,
    'consent is accepted only from the affirmative button while still eligible')

  const install = main.slice(main.indexOf('async function installApprovedDesktopUpdate'), main.indexOf('function configureSessionPermissions'))
  assertInOrder(install, [
    'createSafetyBackup: () => dataBackend.createBackup()',
    'stopBackend: async () =>',
    'await stopBackend({ requireExit: true })',
    'stageUpdate: () => stageNativeUpdate(',
    'discardDownload: () => archive.dispose()',
    'autoUpdater.quitAndInstall()',
  ], 'approved update lifecycle preserves backup, strict shutdown, staging, cleanup, and install order')

  const relaunch = main.slice(main.indexOf('function relaunchDesktop('), main.indexOf('async function restoreFromManagedBackup'))
  assert.match(relaunch, /relaunchAfterUpdateCleanup\(/)
  assert.match(relaunch, /disposeUpdates: \(\) => updateInProgress \? Promise\.resolve\(\) : desktopUpdater\?\.dispose\(\)/,
    'restore and recovery relaunch drain update work without awaiting the active install')
  assert.match(main, /restart: relaunchDesktop/,
    'managed recovery lifecycles share the cleanup-aware relaunch helper')

  const beforeQuit = main.slice(main.indexOf("app.on('before-quit'"))
  assertInOrder(beforeQuit, ['desktopUpdater?.dispose()', 'stopBackend()', 'quitAfterBackend = true', 'app.quit()'],
    'ordinary quit disposes updater resources before stopping backend and exiting')
}
test('native updater authority and lifecycle are wired only through the desktop host', () => {
  const main = readFileSync(new URL('./main.mjs', import.meta.url), 'utf8')
  const preload = readFileSync(new URL('./preload.cjs', import.meta.url), 'utf8')
  assertDesktopUpdaterWiring(main, preload)

  // Exercise the source lock against a realistic unsafe consent-order mutation.
  const unsafeMain = main.replace("buttons: ['Later', 'Download Update']", "buttons: ['Download Update', 'Later']")
  assert.notEqual(unsafeMain, main, 'the mutation fixture must change the reviewed native dialog')
  assert.throws(() => assertDesktopUpdaterWiring(unsafeMain, preload), assert.AssertionError,
    'the wiring lock rejects making Download Update the default action')
})

test('desktop origins are exact IPv4 loopback origins, not user-controlled URLs', () => {
  assert.equal(loopbackOrigin(49152), 'http://127.0.0.1:49152')
  assert.equal(exactLoopbackOrigin('http://127.0.0.1:5173'), 'http://127.0.0.1:5173')
  for (const bad of [
    'http://localhost:5173',
    'https://127.0.0.1:5173',
    'http://127.0.0.1:5173/path',
    'http://127.0.0.1:5173/',
    'http://user@127.0.0.1:5173',
  ]) {
    assert.throws(() => exactLoopbackOrigin(bad), /exact http:\/\/127\.0\.0\.1/)
  }
  assert.throws(() => loopbackOrigin(0), /integer from 1 to 65535/)
})

test('navigation stays on the selected app origin and external opening is HTTPS-only', () => {
  const origin = 'http://127.0.0.1:49152'
  assert.equal(isTrustedAppUrl(`${origin}/projects/p-1?tab=work`, origin), true)
  assert.equal(isTrustedAppUrl('http://127.0.0.1:49153/projects/p-1', origin), false)
  assert.equal(isTrustedAppUrl('http://user:secret@127.0.0.1:49152/projects/p-1', origin), false)
  assert.equal(isTrustedAppUrl('https://example.com', origin), false)

  assert.equal(isAllowedExternalUrl('https://docs.example/path?q=1'), true)
  assert.equal(isAllowedExternalUrl('https://user:secret@docs.example/path'), false)
  for (const bad of ['http://docs.example', 'file:///etc/passwd', 'mailto:hello@example.com', 'javascript:alert(1)']) {
    assert.equal(isAllowedExternalUrl(bad), false, bad)
  }
})

test('the only renderer permission is sanitized clipboard write from the trusted origin', () => {
  const origin = 'http://127.0.0.1:49152'
  assert.equal(permissionAllowed('clipboard-sanitized-write', `${origin}/contexts`, origin), true)
  assert.equal(permissionAllowed('clipboard-read', `${origin}/contexts`, origin), false)
  assert.equal(permissionAllowed('media', `${origin}/contexts`, origin), false)
  assert.equal(permissionAllowed('clipboard-sanitized-write', 'https://evil.example', origin), false)
})

test('the shell pins backend identity, CORS, and durable paths under OS user data', () => {
  const env = desktopBackendEnvironment({
    baseEnv: { PATH: '/bin', PORT: '9999', DATABASE_PATH: '/tmp/wrong.db', UNSET: undefined },
    providerCredentials: {
      [`PROVIDER_DESKTOP_${'A'.repeat(32)}`]: 'device-key',
      PROVIDER_BAD: 'must-not-cross',
      [`PROVIDER_DESKTOP_${'B'.repeat(32)}`]: '',
    },
    port: 49152,
    rendererOrigin: 'http://127.0.0.1:5173',
    userDataPath: '/device/Agent Commons',
    authSecret: 'process-secret',
  })
  assert.equal(env.PATH, '/bin')
  assert.equal('UNSET' in env, false)
  assert.equal(env.PORT, '49152')
  assert.equal(env.CORS_ORIGIN, 'http://127.0.0.1:5173')
  assert.equal(env.AUTH_SECRET, 'process-secret')
  assert.equal(env.DATABASE_PATH, join('/device/Agent Commons', 'store.db'))
  assert.equal(env.SNAPSHOT_DIR, join('/device/Agent Commons', 'snapshots'))
  assert.equal(env.AGENT_COMMONS_BACKEND_ORIGIN, 'http://127.0.0.1:49152')
  assert.equal(env[`PROVIDER_DESKTOP_${'A'.repeat(32)}`], 'device-key')
  assert.equal(env.PROVIDER_BAD, undefined)
  assert.equal(env[`PROVIDER_DESKTOP_${'B'.repeat(32)}`], undefined)
  assert.equal(backendListenMarker(env.AGENT_COMMONS_BACKEND_ORIGIN), '[mock-backend] http://127.0.0.1:49152/api/v1')
})

test('the one-shot restore worker receives persistence coordinates and no ambient authority', () => {
  assert.deepEqual(desktopRestoreEnvironment('/device/Agent Commons'), {
    PERSIST_BACKEND: 'sqlite',
    DATABASE_PATH: join('/device/Agent Commons', 'store.db'),
    SNAPSHOT_DIR: join('/device/Agent Commons', 'snapshots'),
  })
})

test('profile admission is synchronous before instance lock and ready; failure cannot offer restore', () => {
  const main = readFileSync(new URL('./main.mjs', import.meta.url), 'utf8')
  const admission = main.indexOf("ensureDesktopUserDataDirectory(app.getPath('userData'),")
  const lock = main.indexOf('app.requestSingleInstanceLock()')
  const ready = main.indexOf('app.whenReady().then(startDesktop)')
  assert.ok(admission >= 0 && lock > admission && ready > lock)
  const bootstrap = main.slice(main.indexOf('app.enableSandbox()'), ready)
  assert.doesNotMatch(bootstrap.replaceAll(/\/\/[^\n]*/g, ''), /\bawait\b/)
  assert.match(bootstrap, /protectedPaths: \[app.getPath\('appData'\)\]/)
  assert.match(bootstrap, /inspectAcl: desktopProfileAclInspector\(\{ packaged: app.isPackaged, resourcesPath: process.resourcesPath \}\)/)
  const guard = readFileSync(new URL('./userDataDirectory.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(guard, /async function|\bawait\b|chmod/)
  const start = main.indexOf('async function startDesktop()')
  const end = main.indexOf('async function openDesktopCredentialVault()')
  assert.ok(start >= 0 && end > start)
  const startup = main.slice(start, end)
  for (const boundary of ['await loadDesktopAuthSecret(', 'await openDesktopCredentialVault()', 'await openMcpCredentialVaultForDesktop()', 'await launchBackend(']) {
    assert.ok(startup.includes(boundary), boundary)
  }
  const failureStart = main.indexOf('async function failStartup(error)')
  const failureEnd = main.indexOf('if (error instanceof DesktopAuthRootError)', failureStart)
  assert.ok(failureStart >= 0 && failureEnd > failureStart)
  const failure = main.slice(failureStart, failureEnd)
  assert.match(failure, /if \(error instanceof DesktopUserDataError\) \{[\s\S]*dialog.showErrorBox\('Couldn’t protect Agent Commons data', error.message\)\s*app.exit\(1\)\s*return\s*\}/)
  assert.doesNotMatch(failure, /offerStartupRecovery|restoreFromManagedBackup|openPath/)
})

test('Electron owns a sandboxed utility-process lifecycle and Packager ships an ASAR runtime', () => {
  const main = readFileSync(new URL('./main.mjs', import.meta.url), 'utf8')
  for (const contract of [
    'app.enableSandbox()',
    'app.requestSingleInstanceLock()',
    'utilityProcess.fork(',
    'nodeIntegration: false',
    'contextIsolation: true',
    'sandbox: true',
    "preload: join(app.getAppPath(), 'desktop', 'preload.cjs')",
    'additionalArguments: [',
    "--agent-commons-mcp-credentials",
    'createMcpCredentialHost(',
    'createMcpCredentialLifecycle(',
    'mcpCredentialLifecycle.synchronize(',
    'mcpCredentialLifecycle.provision(',
    'installMcpCredentialIpc()',
    'assertTrustedCredentialCaller(event)',
    'assertTrustedDataCaller(event)',
    'assertTrustedContextCaller(event)',
    'installContextIpc()',
    'installDataIpc()',
    'ensureRecoveryBackup()',
    'automaticRecovery = desktopRecoveryStatus(backup)',
    'runBackendRecovery({',
    'const backendFailure = () => backendHandle.exitError',
    'assertCurrentBackend(backendHandle)',
    'restart: relaunchDesktop',
    'Your saved local data remains on this device; the app will quit.',
    'runRendererRecovery({',
    'const recoveryUrl = isTrustedAppUrl(currentUrl, origin) ? currentUrl : url',
    'await win.loadURL(recoveryUrl)',
    'Your saved local data remains on this device',
    'offerStartupRecovery({',
    'revealRecoveryDirectory({',
    'runManagedRestoreLifecycle({',
    'stopBackend({ requireExit: true })',
    'runRestoreWorker(selection.snapshotName)',
    'event.senderFrame?.url',
    "setWindowOpenHandler",
    'setPermissionRequestHandler',
    'setPermissionCheckHandler',
    'child.kill()',
    '[desktop] ready',
  ]) {
    assert.ok(main.includes(contract), `desktop main must contain ${contract}`)
  }
  const rendererRecovery = main.slice(
    main.indexOf("win.webContents.on('render-process-gone'"),
    main.indexOf("win.once('ready-to-show'"),
  )
  assert.match(rendererRecovery, /rendererRecoveryInProgress/)
  assert.match(rendererRecovery, /!initialLoadComplete/)
  assert.match(rendererRecovery, /!backendReady/)
  assert.match(rendererRecovery, /\.finally\(\(\) => \{\s*rendererRecoveryInProgress = false/)
  assert.doesNotMatch(rendererRecovery, /launchBackend|app\.relaunch/, 'renderer recovery preserves the healthy backend')
  const backendRecovery = main.slice(
    main.indexOf("child.once('exit'"),
    main.indexOf('function assertCurrentBackend'),
  )
  assert.match(backendRecovery, /if \(!desktopReady \|\| quitting \|\| backendRecoveryInProgress\) return/)
  assert.match(backendRecovery, /handle\.exitError = exitError/)
  assert.match(backendRecovery, /credentialBackend\?\.close\(\)[\s\S]*dataBackend\?\.close\(\)[\s\S]*backend = null/)
  assert.match(backendRecovery, /desktopReady = false/)
  assert.match(backendRecovery, /restart: relaunchDesktop/)
  assert.match(backendRecovery, /\.finally\(\(\) => \{\s*backendRecoveryInProgress = false/)
  assert.doesNotMatch(backendRecovery, /launchBackend\(/, 'backend loss gets a clean whole-app boundary')
  assert.equal(
    main.match(/assertCurrentBackend\(backendHandle\)/g)?.length,
    2,
    'startup proves the same backend after readiness/backup and again after the first window load',
  )
  const startup = main.slice(main.indexOf('async function startDesktop'), main.indexOf('async function openDesktopCredentialVault'))
  assert.match(startup, /waitForReady\([^;]+START_TIMEOUT_MS, true, backendFailure\)/)
  assert.match(startup, /if \(DEVELOPMENT\) await waitForReady\([^;]+START_TIMEOUT_MS, false, backendFailure\)/)
  assert.match(startup, /await createMainWindow\(rendererUrl, trustedOrigin\)\s*assertCurrentBackend\(backendHandle\)\s*desktopReady = true/)
  assert.match(startup, /const authSecret = await loadDesktopAuthSecret\(/)
  assert.ok(startup.indexOf('await loadDesktopAuthSecret(') < startup.indexOf('await launchBackend('), 'the durable root precedes backend launch')
  assert.match(startup, /filePath: join\(app.getPath\('userData'\), AUTH_ROOT_FILE\)/)
  assert.match(startup, /storage: safeStorage/)
  assert.match(startup, /launchBackend\(\{[^}]*authSecret \}\)/)
  const launch = main.slice(main.indexOf('async function launchBackend'), main.indexOf('function assertCurrentBackend'))
  assert.match(launch, /authSecret,/)
  assert.doesNotMatch(launch, /randomBytes/, 'backend restarts must not silently invalidate credentials')
  const startupFailure = main.slice(main.indexOf('async function failStartup'), main.indexOf('async function stopBackend'))
  assert.match(startupFailure, /error instanceof DesktopAuthRootError[^]*app.quit\(\)[^]*return[^]*offerStartupRecovery/,
    'a keychain problem must not invite an unrelated database restore')
  assert.match(startupFailure, /await runStartupRecovery\(\{/,
    'startup recovery must own cancellation as well as confirmed restore')
  assert.match(startupFailure, /offerRecovery: \(\) => offerStartupRecovery\(\{/)
  assert.match(startupFailure, /restoreBackup: \(\) => restoreFromManagedBackup\(\{ startup: true \}\)/)
  assert.match(startupFailure, /quit: \(\) => app.quit\(\)/,
    'cancelled startup restore must not leave a windowless process alive')

  const preload = readFileSync(new URL('./preload.cjs', import.meta.url), 'utf8')
  assert.match(preload, /contextBridge\.exposeInMainWorld\('agentCommonsDesktop'/)
  assert.doesNotMatch(preload, /sendSync|agentCommonsDesktop[^]*ipcRenderer\s*[,}]/, 'the renderer never receives raw IPC authority')
  for (const verb of ['provision', 'bind', 'discard', 'removeProvider']) assert.match(preload, new RegExp(`${verb}:`))
  for (const channel of Object.values(credentialChannels)) assert.ok(preload.includes(channel), `preload must invoke ${channel}`)
  for (const verb of ['createBackup', 'getRecoveryStatus', 'revealBackups', 'restoreBackup']) assert.match(preload, new RegExp(`${verb}:`))
  for (const channel of Object.values(dataChannels)) assert.ok(preload.includes(channel), `preload must invoke ${channel}`)
  for (const verb of ['pickFiles', 'pickFolder']) assert.match(preload, new RegExp(`${verb}:`))
  for (const channel of Object.values(contextChannels)) assert.ok(preload.includes(channel), `preload must invoke ${channel}`)
  for (const verb of ['list', 'connect', 'snapshot', 'snapshotTree', 'files', 'file', 'disconnect']) assert.match(preload, new RegExp(`${verb}:`))
  for (const channel of Object.values(localFolderChannels)) assert.ok(preload.includes(channel), `preload must invoke ${channel}`)
  for (const channel of Object.values(localGitChannels)) assert.ok(preload.includes(channel), `macOS preload must invoke ${channel}`)
  const contextBridge = preload.slice(preload.indexOf('context: Object.freeze('), preload.indexOf('data: Object.freeze('))
  const localFolderBridge = contextBridge.slice(contextBridge.indexOf('localFolders: Object.freeze('))
  assert.ok(contextBridge.includes('localFolders: Object.freeze('), 'native local connections stay under the context capability')
  assert.doesNotMatch(localFolderBridge, /owner|path|ipcRenderer\.(send|on)/i,
    'the renderer can select a connection id but cannot claim a tenant or filesystem path')
  assert.match(localFolderBridge, /\.\.\.\(process\.platform === 'darwin' \? \{\s*files: \(id, source\) => invokeLocalFolder\(localFolderChannels\.files, id, source\),\s*file: \(id, selection, source\) => invokeLocalFolder\(localFolderChannels\.file, id, selection, source\)/,
    'selective folder browse methods are fixed-channel and macOS-only')
  assert.match(contextBridge, /\.\.\.\(process\.platform === 'darwin' \? \{ localGit: Object\.freeze\(/,
    'the Git access bridge exists only on macOS')
  const localGitBridge = contextBridge.slice(contextBridge.indexOf('localGit: Object.freeze('))
  assert.match(localGitBridge, /list: \(source\) => invokeLocalFolder\(localGitChannels\.list, source\)/)
  assert.match(localGitBridge, /review: \(id, source\) => invokeLocalFolder\(localGitChannels\.review, id, source\)/)
  assert.match(localGitBridge, /fileComparison: \(id, request, source\) => invokeLocalFolder\(localGitChannels\.fileComparison, id, request, source\)/)
  assert.match(localGitBridge, /cancelFileComparison: \(id, request, source\) => invokeLocalFolder\(localGitChannels\.cancelFileComparison, id, request, source\)/)
  assert.match(localGitBridge, /files: \(id, source\) => invokeLocalFolder\(localGitChannels\.files, id, source\)/)
  assert.match(localGitBridge, /file: \(id, selection, source\) => invokeLocalFolder\(localGitChannels\.file, id, selection, source\)/)
  assert.match(localGitBridge, /untrackedFiles: \(id, request, source\) => invokeLocalFolder\(localGitChannels\.untrackedFiles, id, request, source\)/)
  assert.match(localGitBridge, /untrackedFile: \(id, request, source\) => invokeLocalFolder\(localGitChannels\.untrackedFile, id, request, source\)/)
  assert.match(localGitBridge, /cancelUntrackedRead: \(id, request, source\) => invokeLocalFolder\(localGitChannels\.cancelUntrackedRead, id, request, source\)/)
  assert.doesNotMatch(localGitBridge, /owner|path|ipcRenderer\.(send|on)/i,
    'the renderer can select a Git connection id but cannot claim an owner or repository path')
  assert.match(main, /installLocalFolderIpc\(\)/)
  assert.match(main, /assertTrustedDesktopCaller\(event, 'Local folder access is not available from this page\.'\)/)
  assert.match(main, /session\.defaultSession\.cookies\.get\(\{ url: trustedOrigin \}\)/)
  assert.match(main, /redirect: 'error'/)
  assert.match(main, /generation !== localFolderCookieGeneration/)
  assert.match(main, /review: \(root, \{ signal \}\) => readLocalGitReview\(root, \{ gitExecutable, fileExecutable, signal \}\)/,
    'the native Git store runs only the explicit, pinned-tool review reader')
  assert.match(main, /fileComparison: \(root, selection, \{ signal \}\) => readLocalGitFileComparison\(root, selection, \{ gitExecutable, fileExecutable, signal \}\)/,
    'the native Git store runs only the selected-file comparison reader')
  assert.match(main, /function beginShutdown\(\) \{[^}]*quitting = true[^}]*localFolderStore\?\.shutdown\(\)/)
  assert.equal((main.match(/quitting = true/g) ?? []).length, 1, 'quitting is a one-way transition owned by beginShutdown')
  assert.equal((main.match(/^\s+beginShutdown\(\)$/gm) ?? []).length, 4, 'update, restore, and both before-quit paths cancel local work')
  const packagedSmokeSource = readFileSync(new URL('./smoke.mjs', import.meta.url), 'utf8')
  assert.ok(packagedSmokeSource.includes("'localFolders,localGit,pickFiles,pickFolder'"), 'macOS packaged smoke locks the exact context bridge surface')
  assert.ok(packagedSmokeSource.includes("'connect,disconnect,file,files,list,snapshot,snapshotTree'"), 'macOS packaged smoke locks all seven local-folder methods')
  assert.ok(packagedSmokeSource.includes("typeof window.agentCommonsDesktop?.context?.localFolders?.snapshotTree === 'function'"),
    'packaged smoke requires the explicit recursive folder method')
  assert.ok(packagedSmokeSource.includes("typeof window.agentCommonsDesktop?.context?.localGit?.review === 'function'"),
    'packaged smoke requires the explicit Git review method')
  for (const method of ['untrackedFiles', 'untrackedFile', 'cancelUntrackedRead']) {
    assert.ok(packagedSmokeSource.includes(`typeof window.agentCommonsDesktop?.context?.localGit?.${method} === 'function'`),
      `packaged smoke requires the explicit ${method} method`)
  }
  assert.ok(packagedSmokeSource.includes("Object.keys(window.agentCommonsDesktop.context.localGit).sort().join(',') === 'cancelFileComparison,cancelUntrackedRead,connect,disconnect,file,fileComparison,files,list,review,snapshot,untrackedFile,untrackedFiles'"),
    'packaged smoke locks the distinct Git browse and cancellation methods without widening the folder bridge')
  assert.match(preload, /mcpCredentials = Object.freeze\(/)
  assert.match(preload, /mcp-provision-v1/)
  assert.match(preload, /mcp-credentials:provision/)
  const mcpBridge = preload.slice(preload.indexOf('mcpCredentials = Object.freeze('))
  assert.match(mcpBridge, /provision:/)
  assert.doesNotMatch(mcpBridge, /read:|list:|discard:|resolve:/, 'the renderer receives no MCP read/list/raw/discard authority')

  const startupScript = readFileSync(new URL('../scripts/start.mjs', import.meta.url), 'utf8')
  assert.match(startupScript, /installMcpCredentialRuntime\(\)/)
  assert.match(startupScript, /configureMcpRuntime\(/)
  assert.match(startupScript, /allowLoopback: false/)
  const serverImport = startupScript.indexOf("await import('../server/index.ts')")
  assert.ok(serverImport > startupScript.indexOf('deviceBearerAvailable: false'), 'server import follows the inert MCP runtime configuration')
  assert.equal(
    startupScript.indexOf('await mcpCredentialRuntime.synchronizeBindings('),
    -1,
    'MCP synchronization waits for server/index after durable rehydration',
  )
  assert.doesNotMatch(startupScript, /process\.env\[[^\]]*MCP|process\.env\.MCP/, 'MCP secrets never enter environment setup')
  const entrypoint = readFileSync(new URL('../server/index.ts', import.meta.url), 'utf8')
  const initialization = entrypoint.indexOf('await initializeMcpRuntime(store.mcpCredentialBindings(), store.mcpStdioBindings())')
  assert.ok(initialization > entrypoint.indexOf('store.initPersistence()'), 'credential reconciliation follows durable state loading')
  assert.ok(initialization < entrypoint.indexOf('const server = createServer('), 'HTTP admission waits for the credential acknowledgement')

  const packager = readFileSync(new URL('./packager.config.mjs', import.meta.url), 'utf8')
  assert.match(packager, /asar:\s*true/)
  assert.match(packager, /prune:\s*false/)
  assert.match(packager, /com\.agentcommons\.desktop/)
  assert.equal(packagerConfig.executableName, 'Agent Commons')
  assert.match(packagerConfig.icon, /desktop\/assets\/icon$/)
  assert.equal(packagerConfig.extendInfo.NSAppTransportSecurity.NSAllowsArbitraryLoads, false)
  assert.equal(ignoreFromPackage('/node_modules/@anthropic-ai/sdk/client.mjs'), false)
  assert.equal(ignoreFromPackage('/node_modules/@zip.js'), false)
  assert.equal(ignoreFromPackage('/node_modules/@zip.js/zip.js/lib/zip-core-custom.js'), false)
  for (const module of ['ajv', 'fast-deep-equal', 'fast-uri', 'json-schema-traverse', 'require-from-string']) {
    assert.equal(ignoreFromPackage(`/node_modules/${module}/package.json`), false, `${module} is in the isolated schema worker's closure`)
  }
  assert.equal(ignoreFromPackage('/server/mcpSchemaWorker.mjs'), false)
  assert.equal(ignoreFromPackage('/node_modules/saxes/package.json'), true)
  assert.equal(ignoreFromPackage('/node_modules/json-schema-to-ts/package.json'), false)
  assert.equal(ignoreFromPackage('/node_modules/react/package.json'), true)
  assert.equal(ignoreFromPackage('/node_modules/.vite/deps/react.js'), true)
  assert.equal(ignoreFromPackage('/scripts'), false)
  assert.equal(ignoreFromPackage('/scripts/start.mjs'), false)
  assert.equal(ignoreFromPackage('/scripts/dev.mjs'), true)
  assert.equal(ignoreFromPackage('/desktop/assets'), true)
  assert.equal(ignoreFromPackage('/desktop/assets/icon.icns'), true)
  assert.equal(ignoreFromPackage('/desktop/entitlements.mac.plist'), true)
  assert.equal(ignoreFromPackage('/desktop/release-plan.mjs'), true)
  assert.equal(ignoreFromPackage('/desktop/release-publish.mjs'), true)
  assert.equal(ignoreFromPackage('/desktop/release-set.mjs'), true)
  assert.equal(ignoreFromPackage('/desktop/release.mjs'), true)
  assert.equal(ignoreFromPackage('/desktop/updateFeed.mjs'), true)
  assert.equal(ignoreFromPackage('/desktop/updateMenuSmoke.mjs'), true)
  for (const module of ['updateMetadata', 'updateArchive', 'updateConfiguration', 'updateController', 'updateLifecycle']) {
    assert.equal(ignoreFromPackage(`/desktop/${module}.mjs`), false)
  }
  assert.equal(ignoreFromPackage('/desktop/smoke.mjs'), true)
  assert.equal(ignoreFromPackage('/desktop/smokePaths.mjs'), true)
  assert.equal(ignoreFromPackage('/desktop/mcpCredentialSmoke.mjs'), true)
  assert.equal(ignoreFromPackage('/desktop/mcpSchemaSmoke.mjs'), true)
  assert.equal(ignoreFromPackage('/desktop/attachmentSmoke.mjs'), true)
  assert.equal(ignoreFromPackage('/desktop/attachmentSmokeFixture.mjs'), true)
  assert.equal(ignoreFromPackage('/desktop/contributionReviewSmoke.mjs'), true)
  assert.equal(ignoreFromPackage('/desktop/contributionReviewSmokeFixture.mjs'), true)
  assert.equal(ignoreFromPackage('/desktop/artifactSheetImportSmoke.mjs'), true)
  assert.equal(ignoreFromPackage('/desktop/restoreWorker.mjs'), false)
  assert.equal(ignoreFromPackage('/desktop/authRoot.mjs'), false)
  assert.equal(ignoreFromPackage('/desktop/userDataDirectory.mjs'), false)
  assert.equal(ignoreFromPackage('/desktop/profileAcl.mjs'), false)
  assert.equal(ignoreFromPackage('/desktop/profileAdmissionSmoke.mjs'), true)
  assert.equal(ignoreFromPackage('/desktop/startupSmokeInspector.mjs'), true)
  assert.equal(ignoreFromPackage('/desktop/nativeRecovery.mjs'), false)
  assert.equal(ignoreFromPackage('/desktop/backendRecovery.mjs'), false)
  assert.equal(ignoreFromPackage('/desktop/rendererRecovery.mjs'), false)
  assert.equal(ignoreFromPackage('/src/App.tsx'), true)

  assert.equal(
    packagedExecutable('/repo', 'darwin', 'arm64'),
    join('/repo', 'out', 'Agent Commons-darwin-arm64', 'Agent Commons.app', 'Contents', 'MacOS', 'Agent Commons'),
  )
  assert.equal(packagedExecutable('/repo', 'win32', 'x64'), join('/repo', 'out', 'Agent Commons-win32-x64', 'Agent Commons.exe'))

  const smoke = readFileSync(new URL('./smoke.mjs', import.meta.url), 'utf8')
  assert.ok(smoke.includes('await smokePackagedProfileAdmission({ executable })'))
  assert.ok(
    smoke.replaceAll(/\s+/g, ' ').includes('await smokePackagedRestore({ executable })'),
    'ordinary packaged smoke awaits the independent restore acceptance phase',
  )
  assert.equal(ignoreFromPackage('/desktop/restoreSmoke.mjs'), true)
  const restoreSmoke = readFileSync(new URL('./restoreSmoke.mjs', import.meta.url), 'utf8')
  const startupInspector = readFileSync(new URL('./startupSmokeInspector.mjs', import.meta.url), 'utf8')
  assert.match(restoreSmoke, /installStartupFixture\(await waitForInspectorUrl\(run\), expression\)/)
  const damagedStartupLauncher = restoreSmoke.slice(
    restoreSmoke.indexOf('async function launchDamagedStartup'),
    restoreSmoke.indexOf('async function post('),
  )
  assert.ok(damagedStartupLauncher.indexOf("run.child.once('close'") < damagedStartupLauncher.indexOf('installStartupFixture('),
    'the damaged-startup smoke subscribes to process completion before releasing the inspector pause')
  assert.ok(damagedStartupLauncher.indexOf('inspector.close()') < damagedStartupLauncher.indexOf('return { ...run, userDataPath, closed }'),
    'the startup fixture disconnects the inspector before the app reaches its exit boundary')
  assert.match(restoreSmoke, /Promise\.race\(\[run\.closed, timeout\]\)/)
  assert.doesNotMatch(restoreSmoke, /startupDialogFixtureSource|NODE_OPTIONS/)
  assert.match(startupInspector, /Debugger\.paused/)
  assert.match(startupInspector, /Break on start/)
  assert.match(smoke, /getByPlaceholder\('Paste API key'/)
  assert.match(smoke, /Connect a model to begin/)
  assert.match(smoke, /first-run model handoff/)
  assert.match(smoke, /viewer-preferences\/model/,
    'packaged first-run setup must verify its personal model preference through the shipped API')
  assert.match(smoke, /origin === firstOrigin/,
    'the packaged relaunch must exercise preference recovery on a different loopback origin')
  assert.match(smoke, /retiredOrigin\.listen\(Number\(new URL\(firstOrigin\)\.port\), '127\.0\.0\.1', resolve\)/,
    'a test-only listener prevents legal ephemeral-port reuse from making the restart gate flaky')
  assert.match(smoke, /finally\s*\{\s*await new Promise\(\(resolve\) => retiredOrigin\.close\(resolve\)\)/,
    'the test-owned old-origin reservation is released even when relaunch fails')
  assert.match(smoke, /JSON\.stringify\(reopenedPreference\) !== JSON\.stringify\(configuredPreference\)/,
    'packaged acceptance compares the exact personal preference across relaunch')
  assert.match(smoke, /The packaged relaunch lost its configured provider on a fresh draft/,
    'packaged acceptance proves a fresh composer uses the durable provider, not only a saved Session binding')
  assert.match(smoke, /getByRole\('button', \{ name: 'Remove provider'/,
    'packaged cleanup must cross the product confirmation/controller path')
  assert.match(smoke, /agentCommonsDesktop\.data\.createBackup/)
  assert.match(smoke, /agentCommonsDesktop\.data\.getRecoveryStatus/)
  assert.match(smoke, /agentCommonsDesktop\?\.data\?\.restoreBackup/)
  assert.match(smoke, /agentCommonsDesktop\?\.context\?\.pickFiles/)
  assert.match(smoke, /native context picker/)
  assert.match(smoke, /snapshots/)
  assert.match(smoke, /recovery-/)
  assert.match(smoke, /vault\.includes\(smokeSecret\)/)
  assert.match(smoke, /assert\.deepEqual\(storedUsage\(userDataPath, identity\.tenant\.id\), recordedUsage/,
    'packaged acceptance proves exact real-turn usage survives relaunch')
  for (const contract of [
    "'idempotency-key': definition.key",
    "kind: 'doc'",
    "kind: 'sheet'",
    "kind: 'slide'",
    'Same-name direct artifact keys did not remain distinct.',
    'A changed-payload Retry did not recover the exact direct Artifact.',
    'Direct Artifact creation did not expose each exact canonical body.',
    'The packaged relaunch changed a direct Artifact body.',
    'The packaged relaunch could not recover the exact keyed direct Artifact.',
  ]) {
    assert.match(smoke, new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      `packaged smoke must prove intrinsic keyed Artifact creation: ${contract}`)
  }
  assert.match(smoke, /await smokePackagedAttachments\(\{ executable \}\)/,
    'the ordinary executable and freshly extracted release both run attachment acceptance')
  assert.match(smoke, /await smokePackagedMcpCredentials\(\{ executable \}\)/,
    'the ordinary executable and freshly extracted release both prove real OS-backed MCP credential reconciliation')
  assert.match(smoke, /await smokePackagedMcpSchema\(\{ executable \}\)/,
    'the ordinary executable and freshly extracted release both prove the isolated schema worker loads from ASAR')
  assert.ok(smoke.includes('await smokePackagedContributionReview({ executable, launch: launchPackagedDesktop, close: closePackagedDesktop })'),
    'ordinary smoke and extracted release smoke await real review interruption/relaunch acceptance')
  const reviewSmoke = readFileSync(new URL('./contributionReviewSmoke.mjs', import.meta.url), 'utf8')
  for (const evidence of [
    'new DatabaseSync', '{ readOnly: true }',
    'the actual packaged wire contains only the frozen changeset',
    'the real interrupted request left a durable pending receipt',
    'startup recovery itself is durable',
    'same-key Retry returns durable history after restart',
    'mount, restart and exact Retry cannot dispatch again',
    'the real managed backup preserves every exact private receipt',
  ]) assert.ok(reviewSmoke.includes(evidence), `packaged review acceptance must prove ${evidence}`)
  assert.doesNotMatch(reviewSmoke, /_electron|use-mock-keychain|saveState\(|store\.runContribution/,
    'review acceptance uses ordinary packaged launches and never injects a store or OS-storage fixture')

  const schemaSmoke = readFileSync(new URL('./mcpSchemaSmoke.mjs', import.meta.url), 'utf8')
  for (const contract of [
    'utilityProcess.fork',
    "join(await app.evaluate(({ app }) => app.getAppPath()), 'server', 'mcpSchema.ts')",
    'utilityProcess.fork(input.driverPath, [input.modulePath]',
    "code: 'invalid_value'",
    "code: 'cancelled'",
    "code: 'unavailable'",
    "code: 'limit'",
  ]) assert.ok(schemaSmoke.includes(contract), `packaged schema smoke must contain ${contract}`)
  assert.doesNotMatch(schemaSmoke, /await import\('node:path'\)/,
    'Playwright main-process evaluation has no dynamic-import callback; compute the shipped path in the host')

  const attachmentSmoke = readFileSync(new URL('./attachmentSmoke.mjs', import.meta.url), 'utf8')
  for (const contract of [
    "artifact: { name, kind: 'sheet', meta: 'Sheet', body }",
    "format=xlsx",
    "Edit sheet",
    "Save changes",
    "authorized structured body read succeeds after owner edit",
    "export revision matches the authorized edited body",
    "Download XLSX",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "<f(?:\\s|>)",
    "exact renamed .xlsx download",
    "artifact: { name, kind: 'slide', meta: 'Slides', body }",
    "format=pptx",
    "Edit slides",
    "Slide 1 title",
    "authorized slide body read succeeds after owner edit",
    "PPTX revision matches the authorized edited body",
    "Download PowerPoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "ppt/slides/slide1.xml",
    "vbaProject|externalLink",
    "exact renamed .pptx download",
    "Retained original download failed",
    "exact original filename and source bytes survive the initial attachment",
    "relaunch retains exact original filename and source bytes after source files are absent",
    "reattached model image blocks remain normalized after the source-free relaunch",
    "Download original",
    "packaged Download original completes with the source filename",
    "downloaded original file contains the exact selected source bytes",
    "initial-original-native-image.svg",
    "relaunched-original-native-image.svg",
  ]) {
    assert.match(attachmentSmoke, new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      `packaged attachment smoke must prove Office export contract: ${contract}`)
  }

  const packaging = readFileSync(new URL('./package.mjs', import.meta.url), 'utf8')
  assert.match(packaging, /electronChecksums/)
  assert.match(packaging, /checksums:\s*electronChecksums/)
  assert.match(packaging, /electronZipDir:\s*dirname\(zipPath\)/)
  assert.match(packaging, /artifacts\.some\(\(artifact\)\s*=>\s*!existsSync\(artifact\)\)/)
  assert.match(packaging, /verifyPackagedDesktopIcon/)

  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.main, 'desktop/main.mjs')
  assert.equal(pkg.scripts.start, 'electron .')
  assert.equal(pkg.scripts['desktop:package'], 'node desktop/package.mjs')
  assert.equal(pkg.scripts['desktop:smoke'], 'node desktop/smoke.mjs')
  assert.equal(pkg.scripts['desktop:smoke:mcp-effects'], 'node desktop/contributionMcpSmoke.mjs')
  assert.equal(pkg.scripts['desktop:smoke:routine-mcp'], 'node desktop/routineMcpSmoke.mjs')
  assert.equal(pkg.scripts['desktop:smoke:routine-local'], 'node desktop/routineMcpLocalSmoke.mjs')
  assert.equal(pkg.scripts['desktop:smoke:commission-mcp'], 'node desktop/commissionMcpSmoke.mjs')
  assert.equal(pkg.scripts['desktop:smoke:oauth'], 'node desktop/mcpOAuthSmoke.mjs')
  assert.equal(pkg.scripts['desktop:smoke:mcp-input'], 'node desktop/mcpOAuthSmoke.mjs --forms')
  assert.equal(pkg.scripts['desktop:smoke:stdio'], 'node desktop/mcpStdioSmoke.mjs')
  assert.equal(pkg.scripts['desktop:smoke:agent-requests'], 'node desktop/agentRequestSmoke.mjs')
  assert.equal(pkg.scripts['desktop:verify'], 'npm run desktop:package && npm run desktop:smoke && npm run desktop:smoke:mcp-effects && npm run desktop:smoke:routine-mcp && npm run desktop:smoke:routine-local && npm run desktop:smoke:commission-mcp && npm run desktop:smoke:commission-local-mcp && npm run desktop:smoke:oauth && npm run desktop:smoke:mcp-input && npm run desktop:smoke:stdio && npm run desktop:smoke:agent-requests')
  assert.equal(pkg.scripts['desktop:release:mac'], 'node desktop/release.mjs')
  assert.equal(pkg.scripts['desktop:release:mac:finalize'], 'node desktop/release-set.mjs')
  assert.match(pkg.scripts.test, /desktop\/\*\*\/\*\.test\.ts/)

  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  assert.match(html, /Content-Security-Policy/)
  assert.match(html, /object-src 'none'/)
  assert.doesNotMatch(html, /unsafe-eval/)
})

test('packaged delegated judgment smoke locks rendered authority and crash recovery evidence', () => {
  const smoke = readFileSync(new URL('./smoke.mjs', import.meta.url), 'utf8')
  const driver = readFileSync(new URL('./contributionReviewSmoke.mjs', import.meta.url), 'utf8')
  assert.ok(smoke.includes('await smokePackagedContributionReview({ executable, launch: launchPackagedDesktop, close: closePackagedDesktop })'),
    'ordinary and extracted-release smoke must await delegated judgment acceptance')
  assert.equal(ignoreFromPackage('/desktop/contributionReviewSmoke.mjs'), true)
  assert.equal(ignoreFromPackage('/desktop/contributionReviewSmokeFixture.mjs'), true)

  assertInOrder(driver, [
    "stage = 'delegated-draft'",
    "data-delegated-judgment-status=\"draft\"",
    "stage = 'delegated-pending-before-quit'",
    "judgmentSaved().contribution.judgmentAttempts.at(-1).status).toBe('pending')",
    "stage = 'delegated-relaunch-uncertain'",
    "data-delegated-judgment-status=\"uncertain\"",
    "const judgmentReplay = await request(page, `${judgmentPath}/delegated/${grant.id}`, interruptedJudgment.body, interruptedJudgment.key)",
    "stage = 'delegated-explicit-decide'",
    "assert.equal(promotedGrant.revision, 1)",
    "data-delegated-judgment-status=\"decided\"",
    "stage = 'delegated-read-only-envelope'",
    "assert.deepEqual(envelopeFinal.contribution.envelope.lines, proposed.envelope.lines, 'approval never fulfills the read envelope')",
    "stage = 'managed-backup'",
    "managed backup retains exact private judgment receipts",
  ], 'packaged delegated judgment smoke must preserve the reviewed acceptance sequence')
  assert.match(driver, /const judgmentOldOrigin = origin\s*await close\(run\)/,
    'the actual pending judgment is interrupted by closing the ordinary packaged process')

  for (const evidence of [
    "assert.equal((await request(page, '/me')).user.id, identity.user.id)",
    "assert.equal(fixture.requests.length, 6, 'judgment restart and exact replay never redispatch')",
    "assert.equal(decidedJudgment.status, 'landed', 'Decide applies the permitted non-effectful landing')",
    "assert.equal(envelopeFinal.contribution.envelope.approvedVersion, proposed.envelope.version)",
    'assertSpend(envelopeFinal, 6)',
    'portable.contributions.find(candidate => candidate.id === accepted.contribution.id).judgmentAttempts',
  ]) assert.ok(driver.includes(evidence), `packaged delegated judgment smoke must prove ${evidence}`)
  assert.doesNotMatch(driver, /_electron|use-mock-keychain|saveState\(|store\.runDelegatedModelJudgment/,
    'packaged delegated judgment uses ordinary launches, the shipped API, and no injected store')
})

test('packaged Discussion Context smoke is excluded from the shipped app', () => {
  assert.equal(ignoreFromPackage('/desktop/discussionContextSmoke.mjs'), true)
})

test('ordinary packaged smoke awaits Discussion Context acceptance with the shared launch lifecycle', () => {
  const smoke = readFileSync(new URL('./smoke.mjs', import.meta.url), 'utf8')
  assert.ok(
    smoke.includes('await smokePackagedDiscussionContext({ executable, launch: launchPackagedDesktop, close: closePackagedDesktop })'),
    'ordinary and extracted-release smoke must await packaged Discussion Context acceptance',
  )
})
