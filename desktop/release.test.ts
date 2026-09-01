import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  archiveCreateCommand,
  archiveExtractCommand,
  checksumLine,
  directDownloadReleasePlan,
  releaseBundleIdentityProbes,
  releaseReceiptJson,
  releaseVerificationCommands,
  validateReleaseBundleIdentity,
} from './release-plan.mjs'
import { publishImmutableRelease } from './release-publish.mjs'

const root = '/repo'
const manifest = { version: '0.1.0', productName: 'Agent Commons' }
const validEnv = {
  APPLE_SIGNING_IDENTITY: 'Developer ID Application: Agent Commons (ABCDE12345)',
  APPLE_NOTARY_KEYCHAIN_PROFILE: 'agent-commons-notary',
}

test('direct download release fails before packaging without every macOS release prerequisite', () => {
  assert.throws(
    () => directDownloadReleasePlan({ root, manifest, env: validEnv, platform: 'linux', arch: 'x64' }),
    /must run on macOS/,
  )
  assert.throws(
    () => directDownloadReleasePlan({ root, manifest, env: validEnv, platform: 'darwin', arch: 'universal' }),
    /arm64 or x64/,
  )
  assert.throws(
    () => directDownloadReleasePlan({ root, manifest: { ...manifest, version: '../next' }, env: validEnv, platform: 'darwin', arch: 'arm64' }),
    /safe semantic package version/,
  )
  assert.throws(
    () => directDownloadReleasePlan({ root, manifest, env: {}, platform: 'darwin', arch: 'arm64' }),
    /APPLE_SIGNING_IDENTITY/,
  )
  assert.throws(
    () => directDownloadReleasePlan({ root, manifest, env: { APPLE_SIGNING_IDENTITY: '-' }, platform: 'darwin', arch: 'arm64' }),
    /Developer ID Application identity/,
  )
  assert.throws(
    () => directDownloadReleasePlan({
      root,
      manifest,
      env: { APPLE_SIGNING_IDENTITY: validEnv.APPLE_SIGNING_IDENTITY },
      platform: 'darwin',
      arch: 'arm64',
    }),
    /APPLE_NOTARY_KEYCHAIN_PROFILE/,
  )
})

test('direct download release pins signing, Keychain notarization, and architecture-specific outputs', () => {
  const plan = directDownloadReleasePlan({
    root,
    manifest,
    env: { ...validEnv, APPLE_KEYCHAIN: '/build/release.keychain-db' },
    platform: 'darwin',
    arch: 'arm64',
  })
  assert.equal(plan.targetPlatform, 'darwin')
  assert.equal(plan.targetArch, 'arm64')
  assert.equal(plan.packageDirectory, '/repo/out/Agent Commons-darwin-arm64')
  assert.equal(plan.appPath, '/repo/out/Agent Commons-darwin-arm64/Agent Commons.app')
  assert.equal(plan.archiveName, 'Agent-Commons-0.1.0-macos-arm64.zip')
  assert.equal(plan.archivePath, '/repo/release/Agent-Commons-0.1.0-macos-arm64.zip')
  assert.equal(plan.checksumPath, `${plan.archivePath}.sha256`)
  assert.equal(plan.receiptName, 'Agent-Commons-0.1.0-macos-arm64.release.json')
  assert.equal(plan.receiptPath, '/repo/release/Agent-Commons-0.1.0-macos-arm64.release.json')
  assert.deepEqual(plan.bundleIdentity, {
    bundleIdentifier: 'com.agentcommons.desktop',
    displayName: 'Agent Commons',
    executableName: 'Agent Commons',
    shortVersion: '0.1.0',
    bundleVersion: '0.1.0',
    binaryArchitectures: ['arm64'],
  })
  assert.deepEqual(plan.packagerOptions.osxNotarize, {
    keychainProfile: 'agent-commons-notary',
    keychain: '/build/release.keychain-db',
  })
  assert.equal(plan.packagerOptions.osxSign.identity, validEnv.APPLE_SIGNING_IDENTITY)
  assert.equal(plan.packagerOptions.osxSign.continueOnError, false)
  assert.equal(plan.packagerOptions.osxSign.identityValidation, true)
  assert.equal(plan.packagerOptions.osxSign.hardenedRuntime, true)
  assert.equal(plan.packagerOptions.osxSign.strictVerify, true)
  assert.equal(plan.packagerOptions.osxSign.preAutoEntitlements, false)
  assert.equal(plan.packagerOptions.osxSign.preEmbedProvisioningProfile, false)

  const mainOptions = plan.packagerOptions.osxSign.optionsForFile(plan.appPath)
  assert.equal(mainOptions.entitlements, '/repo/desktop/entitlements.mac.plist')
  assert.equal(
    plan.packagerOptions.osxSign.optionsForFile(`${plan.appPath}/Contents/Frameworks/Agent Commons Helper.app`).entitlements,
    '/repo/desktop/entitlements.mac.plist',
  )
  assert.equal(plan.packagerOptions.osxSign.optionsForFile(`${plan.appPath}/Contents/Frameworks/Agent Commons Helper (Plugin).app`), null)
})

test('release identity is read from the app and its executable, not inferred for the receipt', () => {
  const appPath = '/tmp/download/Agent Commons.app'
  const executablePath = `${appPath}/Contents/MacOS/Agent Commons`
  assert.deepEqual(releaseBundleIdentityProbes(appPath, executablePath), [
    { field: 'bundleIdentifier', command: '/usr/bin/plutil', args: ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', `${appPath}/Contents/Info.plist`] },
    { field: 'displayName', command: '/usr/bin/plutil', args: ['-extract', 'CFBundleDisplayName', 'raw', '-o', '-', `${appPath}/Contents/Info.plist`] },
    { field: 'executableName', command: '/usr/bin/plutil', args: ['-extract', 'CFBundleExecutable', 'raw', '-o', '-', `${appPath}/Contents/Info.plist`] },
    { field: 'shortVersion', command: '/usr/bin/plutil', args: ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', `${appPath}/Contents/Info.plist`] },
    { field: 'bundleVersion', command: '/usr/bin/plutil', args: ['-extract', 'CFBundleVersion', 'raw', '-o', '-', `${appPath}/Contents/Info.plist`] },
    { field: 'binaryArchitectures', command: '/usr/bin/lipo', args: ['-archs', executablePath] },
  ])

  const expected = directDownloadReleasePlan({ root, manifest, env: validEnv, platform: 'darwin', arch: 'arm64' }).bundleIdentity
  const actual = {
    bundleIdentifier: 'com.agentcommons.desktop\n',
    displayName: 'Agent Commons\n',
    executableName: 'Agent Commons\n',
    shortVersion: '0.1.0\n',
    bundleVersion: '0.1.0\n',
    binaryArchitectures: 'arm64\n',
  }
  assert.doesNotThrow(() => validateReleaseBundleIdentity(actual, expected))
  for (const [field, value] of [
    ['bundleIdentifier', 'com.example.impostor'],
    ['displayName', 'Other App'],
    ['executableName', 'Other App'],
    ['shortVersion', '0.2.0'],
    ['bundleVersion', '99'],
    ['binaryArchitectures', 'arm64 x86_64'],
  ]) {
    assert.throws(
      () => validateReleaseBundleIdentity({ ...actual, [field]: value }, expected),
      new RegExp(field === 'binaryArchitectures' ? 'binary architectures' : field),
    )
  }

  const x64 = directDownloadReleasePlan({ root, manifest, env: validEnv, platform: 'darwin', arch: 'x64' })
  assert.deepEqual(x64.bundleIdentity.binaryArchitectures, ['x86_64'], 'Packager x64 maps to the Mach-O architecture name')
})

test('download archive is verified as signed, stapled, and Gatekeeper-accepted before smoke', () => {
  const appPath = '/tmp/download/Agent Commons.app'
  assert.deepEqual(releaseVerificationCommands(appPath), [
    {
      command: '/usr/bin/codesign',
      args: ['--verify', '--deep', '--strict', '--verbose=2', appPath],
    },
    {
      command: '/usr/bin/xcrun',
      args: ['stapler', 'validate', '-v', appPath],
    },
    {
      command: '/usr/sbin/spctl',
      args: ['--assess', '--type', 'execute', '--verbose=4', appPath],
    },
  ])
  assert.deepEqual(archiveCreateCommand(appPath, '/repo/release/app.zip'), {
    command: '/usr/bin/ditto',
    args: ['-c', '-k', '--sequesterRsrc', '--keepParent', 'Agent Commons.app', '/repo/release/app.zip'],
    cwd: '/tmp/download',
  })
  assert.deepEqual(archiveExtractCommand('/repo/release/app.zip', '/tmp/extracted'), {
    command: '/usr/bin/ditto',
    args: ['-x', '-k', '/repo/release/app.zip', '/tmp/extracted'],
  })
})

test('release checksum is strict, portable SHA-256 manifest syntax', () => {
  const digest = 'a'.repeat(64)
  assert.equal(checksumLine(digest, 'Agent-Commons-0.1.0-macos-arm64.zip'), `${digest}  Agent-Commons-0.1.0-macos-arm64.zip\n`)
  assert.throws(() => checksumLine('ABC', 'app.zip'), /lowercase SHA-256/)
  assert.throws(() => checksumLine(digest, '../app.zip'), /not a path/)
})

test('release receipt binds artifact identity, size, digest, and completed verification', () => {
  const digest = 'b'.repeat(64)
  const bundleIdentity = directDownloadReleasePlan({
    root,
    manifest,
    env: validEnv,
    platform: 'darwin',
    arch: 'arm64',
  }).bundleIdentity
  const json = releaseReceiptJson({
    productName: 'Agent Commons',
    version: '0.1.0',
    platform: 'macos',
    architecture: 'arm64',
    archiveName: 'Agent-Commons-0.1.0-macos-arm64.zip',
    bytes: 12_345,
    sha256: digest,
    bundleIdentity,
  })
  assert.equal(json.endsWith('\n'), true)
  assert.deepEqual(JSON.parse(json), {
    schemaVersion: 2,
    product: 'Agent Commons',
    version: '0.1.0',
    platform: 'macos',
    architecture: 'arm64',
    artifact: {
      file: 'Agent-Commons-0.1.0-macos-arm64.zip',
      bytes: 12_345,
      sha256: digest,
    },
    bundle: bundleIdentity,
    verification: {
      bundleIdentity: 'verified',
      codeSignature: 'verified',
      notarizationTicket: 'stapled',
      gatekeeper: 'accepted',
      executableSmoke: 'passed',
    },
  })
  assert.throws(
    () => releaseReceiptJson({
      productName: 'Agent Commons',
      version: '0.1.0',
      platform: 'macos',
      architecture: 'arm64',
      archiveName: 'different.zip',
      bytes: 12_345,
      sha256: digest,
      bundleIdentity,
    }),
    /archive name must match/,
  )
  assert.throws(
    () => releaseReceiptJson({
      productName: 'Agent Commons',
      version: '0.1.0',
      platform: 'macos',
      architecture: 'arm64',
      archiveName: 'Agent-Commons-0.1.0-macos-arm64.zip',
      bytes: 0,
      sha256: digest,
      bundleIdentity,
    }),
    /positive archive byte size/,
  )
  assert.throws(
    () => releaseReceiptJson({
      productName: 'Agent Commons',
      version: '0.1.0',
      platform: 'macos',
      architecture: 'arm64',
      archiveName: 'Agent-Commons-0.1.0-macos-arm64.zip',
      bytes: 12_345,
      sha256: digest,
      bundleIdentity: { ...bundleIdentity, shortVersion: '0.2.0' },
    }),
    /shortVersion/,
  )
})

test('release publication is immutable and rolls back every newly created verifier', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-commons-release-publish-test-'))
  const stagedArchive = join(directory, 'staged.zip')
  const stagedChecksum = join(directory, 'staged.sha256')
  const stagedReceipt = join(directory, 'staged.json')
  const archivePath = join(directory, 'release.zip')
  const checksumPath = join(directory, 'release.sha256')
  const receiptPath = join(directory, 'release.json')
  await writeFile(stagedArchive, 'archive-one')
  await writeFile(stagedChecksum, 'checksum-one')
  await writeFile(stagedReceipt, 'receipt-one')
  try {
    const auxiliaryArtifacts = [
      { stagedPath: stagedReceipt, destinationPath: receiptPath },
      { stagedPath: stagedChecksum, destinationPath: checksumPath },
    ]
    await publishImmutableRelease({ stagedArchive, archivePath, auxiliaryArtifacts })
    assert.equal(await readFile(archivePath, 'utf8'), 'archive-one')
    assert.equal(await readFile(checksumPath, 'utf8'), 'checksum-one')
    assert.equal(await readFile(receiptPath, 'utf8'), 'receipt-one')

    await writeFile(stagedArchive, 'archive-two')
    await writeFile(stagedChecksum, 'checksum-two')
    await writeFile(stagedReceipt, 'receipt-two')
    await assert.rejects(
      publishImmutableRelease({ stagedArchive, archivePath, auxiliaryArtifacts }),
      /EEXIST/,
    )
    assert.equal(await readFile(archivePath, 'utf8'), 'archive-one')
    assert.equal(await readFile(checksumPath, 'utf8'), 'checksum-one')
    assert.equal(await readFile(receiptPath, 'utf8'), 'receipt-one')

    const partialArchive = join(directory, 'partial.zip')
    const partialChecksum = join(directory, 'partial.sha256')
    const partialReceipt = join(directory, 'partial.json')
    let copies = 0
    await assert.rejects(
      publishImmutableRelease({
        stagedArchive,
        archivePath: partialArchive,
        auxiliaryArtifacts: [
          { stagedPath: stagedReceipt, destinationPath: partialReceipt },
          { stagedPath: stagedChecksum, destinationPath: partialChecksum },
        ],
        async copy(source, destination) {
          copies += 1
          if (copies === 3) throw new Error('simulated archive publication failure')
          await copyFile(source, destination)
        },
      }),
      /simulated archive publication failure/,
    )
    assert.equal(existsSync(partialArchive), false)
    assert.equal(existsSync(partialChecksum), false)
    assert.equal(existsSync(partialReceipt), false)

    await assert.rejects(
      publishImmutableRelease({
        stagedArchive,
        archivePath: partialArchive,
        auxiliaryArtifacts: [
          { stagedPath: stagedChecksum, destinationPath: partialChecksum },
          { stagedPath: stagedReceipt, destinationPath: partialChecksum },
        ],
      }),
      /destinations must be unique/,
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('release orchestration verifies the extracted download and runs the executable smoke', () => {
  const source = readFileSync(new URL('./release.mjs', import.meta.url), 'utf8')
  assert.match(source, /directDownloadReleasePlan/)
  assert.match(source, /packageDesktop\(\{/)
  assert.match(source, /artifacts\.length !== 1/)
  assert.match(source, /await verifyBundleIdentity\(plan\.appPath, plan\.executablePath, plan\.bundleIdentity\)/)
  assert.match(source, /await verifyApp\(plan\.appPath\)/)
  assert.match(source, /entries\.length !== 1/)
  assert.match(source, /const downloadedBundleIdentity = await verifyBundleIdentity\(extractedApp, extractedExecutable, plan\.bundleIdentity\)/)
  assert.match(source, /await verifyApp\(extractedApp\)/)
  assert.match(source, /await smokePackagedDesktop\(\{/)
  assert.match(source, /checksumLine\(digest, plan\.archiveName\)/)
  assert.match(source, /releaseReceiptJson\(\{/)
  assert.match(source, /bundleIdentity: downloadedBundleIdentity/)
  assert.match(source, /publishImmutableRelease/)
  assert.match(source, /destinationPath: plan\.receiptPath/)
  assert.match(source, /version already has a direct-download output/)
  assert.match(source, /'\/usr\/bin\/lipo'/)
  assert.match(source, /'\/usr\/bin\/plutil'/)
  assert.doesNotMatch(source, /rm\(plan\.checksumPath/)

  const entitlements = readFileSync(new URL('./entitlements.mac.plist', import.meta.url), 'utf8')
  assert.match(entitlements, /com\.apple\.security\.cs\.allow-jit/)
  for (const denied of ['device.camera', 'device.microphone', 'device.audio-input', 'device.bluetooth', 'device.usb', 'photos-library', 'personal-information.location', 'device.print']) {
    assert.doesNotMatch(entitlements, new RegExp(`<key>com\\.apple\\.security\\.${denied}`), denied)
  }
})
