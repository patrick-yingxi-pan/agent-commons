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

  const preload = readFileSync(new URL('./preload.cjs', import.meta.url), 'utf8')
  assert.match(preload, /contextBridge\.exposeInMainWorld\('agentCommonsDesktop'/)
  assert.doesNotMatch(preload, /sendSync|agentCommonsDesktop[^]*ipcRenderer\s*[,}]/, 'the renderer never receives raw IPC authority')
  for (const verb of ['provision', 'bind', 'discard', 'removeProvider']) assert.match(preload, new RegExp(`${verb}:`))
  for (const channel of Object.values(credentialChannels)) assert.ok(preload.includes(channel), `preload must invoke ${channel}`)
  for (const verb of ['createBackup', 'getRecoveryStatus', 'revealBackups', 'restoreBackup']) assert.match(preload, new RegExp(`${verb}:`))
  for (const channel of Object.values(dataChannels)) assert.ok(preload.includes(channel), `preload must invoke ${channel}`)
  for (const verb of ['pickFiles', 'pickFolder']) assert.match(preload, new RegExp(`${verb}:`))
  for (const channel of Object.values(contextChannels)) assert.ok(preload.includes(channel), `preload must invoke ${channel}`)
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
  const initialization = entrypoint.indexOf('await initializeMcpRuntime(store.mcpCredentialBindings())')
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
  assert.equal(ignoreFromPackage('/desktop/smoke.mjs'), true)
  assert.equal(ignoreFromPackage('/desktop/smokePaths.mjs'), true)
  assert.equal(ignoreFromPackage('/desktop/mcpCredentialSmoke.mjs'), true)
  assert.equal(ignoreFromPackage('/desktop/mcpSchemaSmoke.mjs'), true)
  assert.equal(ignoreFromPackage('/desktop/attachmentSmoke.mjs'), true)
  assert.equal(ignoreFromPackage('/desktop/attachmentSmokeFixture.mjs'), true)
  assert.equal(ignoreFromPackage('/desktop/artifactSheetImportSmoke.mjs'), true)
  assert.equal(ignoreFromPackage('/desktop/restoreWorker.mjs'), false)
  assert.equal(ignoreFromPackage('/desktop/authRoot.mjs'), false)
  assert.equal(ignoreFromPackage('/desktop/userDataDirectory.mjs'), false)
  assert.equal(ignoreFromPackage('/desktop/profileAcl.mjs'), false)
  assert.equal(ignoreFromPackage('/desktop/profileAdmissionSmoke.mjs'), true)
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
  assert.equal(pkg.scripts['desktop:verify'], 'npm run desktop:package && npm run desktop:smoke')
  assert.equal(pkg.scripts['desktop:release:mac'], 'node desktop/release.mjs')
  assert.equal(pkg.scripts['desktop:release:mac:finalize'], 'node desktop/release-set.mjs')
  assert.match(pkg.scripts.test, /desktop\/\*\*\/\*\.test\.ts/)

  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  assert.match(html, /Content-Security-Policy/)
  assert.match(html, /object-src 'none'/)
  assert.doesNotMatch(html, /unsafe-eval/)
})
