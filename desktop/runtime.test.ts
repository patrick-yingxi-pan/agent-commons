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
import dataChannels from './data-channels.cjs'

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
    "additionalArguments: credentialVault ? ['--agent-commons-secure-credentials'] : []",
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

  const preload = readFileSync(new URL('./preload.cjs', import.meta.url), 'utf8')
  assert.match(preload, /contextBridge\.exposeInMainWorld\('agentCommonsDesktop'/)
  assert.doesNotMatch(preload, /sendSync|agentCommonsDesktop[^]*ipcRenderer\s*[,}]/, 'the renderer never receives raw IPC authority')
  for (const verb of ['provision', 'bind', 'discard', 'removeProvider']) assert.match(preload, new RegExp(`${verb}:`))
  for (const channel of Object.values(credentialChannels)) assert.ok(preload.includes(channel), `preload must invoke ${channel}`)
  for (const verb of ['createBackup', 'getRecoveryStatus', 'revealBackups', 'restoreBackup']) assert.match(preload, new RegExp(`${verb}:`))
  for (const channel of Object.values(dataChannels)) assert.ok(preload.includes(channel), `preload must invoke ${channel}`)
  for (const verb of ['pickFiles', 'pickFolder']) assert.match(preload, new RegExp(`${verb}:`))
  for (const channel of Object.values(contextChannels)) assert.ok(preload.includes(channel), `preload must invoke ${channel}`)

  const packager = readFileSync(new URL('./packager.config.mjs', import.meta.url), 'utf8')
  assert.match(packager, /asar:\s*true/)
  assert.match(packager, /prune:\s*false/)
  assert.match(packager, /com\.agentcommons\.desktop/)
  assert.equal(packagerConfig.executableName, 'Agent Commons')
  assert.match(packagerConfig.icon, /desktop\/assets\/icon$/)
  assert.equal(packagerConfig.extendInfo.NSAppTransportSecurity.NSAllowsArbitraryLoads, false)
  assert.equal(ignoreFromPackage('/node_modules/@anthropic-ai/sdk/client.mjs'), false)
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
  assert.equal(ignoreFromPackage('/desktop/smoke.mjs'), true)
  assert.equal(ignoreFromPackage('/desktop/restoreWorker.mjs'), false)
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
  assert.match(smoke, /getByPlaceholder\('Paste API key'/)
  assert.match(smoke, /Connect a model to begin/)
  assert.match(smoke, /first-run model handoff/)
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
  assert.equal(pkg.scripts['desktop:verify'], 'npm run desktop:package && npm run desktop:smoke')
  assert.equal(pkg.scripts['desktop:release:mac'], 'node desktop/release.mjs')
  assert.equal(pkg.scripts['desktop:release:mac:finalize'], 'node desktop/release-set.mjs')
  assert.match(pkg.scripts.test, /desktop\/\*\*\/\*\.test\.ts/)

  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  assert.match(html, /Content-Security-Policy/)
  assert.match(html, /object-src 'none'/)
  assert.doesNotMatch(html, /unsafe-eval/)
})
