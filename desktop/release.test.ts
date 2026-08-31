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
  releaseVerificationCommands,
} from './release-plan.mjs'
import { publishImmutableReleasePair } from './release-publish.mjs'

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

test('release publication is immutable and rolls back a newly created half-pair', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-commons-release-publish-test-'))
  const stagedArchive = join(directory, 'staged.zip')
  const stagedChecksum = join(directory, 'staged.sha256')
  const archivePath = join(directory, 'release.zip')
  const checksumPath = join(directory, 'release.sha256')
  await writeFile(stagedArchive, 'archive-one')
  await writeFile(stagedChecksum, 'checksum-one')
  try {
    await publishImmutableReleasePair({ stagedArchive, stagedChecksum, archivePath, checksumPath })
    assert.equal(await readFile(archivePath, 'utf8'), 'archive-one')
    assert.equal(await readFile(checksumPath, 'utf8'), 'checksum-one')

    await writeFile(stagedArchive, 'archive-two')
    await writeFile(stagedChecksum, 'checksum-two')
    await assert.rejects(
      publishImmutableReleasePair({ stagedArchive, stagedChecksum, archivePath, checksumPath }),
      /EEXIST/,
    )
    assert.equal(await readFile(archivePath, 'utf8'), 'archive-one')
    assert.equal(await readFile(checksumPath, 'utf8'), 'checksum-one')

    const partialArchive = join(directory, 'partial.zip')
    const partialChecksum = join(directory, 'partial.sha256')
    let copies = 0
    await assert.rejects(
      publishImmutableReleasePair({
        stagedArchive,
        stagedChecksum,
        archivePath: partialArchive,
        checksumPath: partialChecksum,
        async copy(source, destination) {
          copies += 1
          if (copies === 2) throw new Error('simulated checksum publication failure')
          await copyFile(source, destination)
        },
      }),
      /simulated checksum publication failure/,
    )
    assert.equal(existsSync(partialArchive), false)
    assert.equal(existsSync(partialChecksum), false)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('release orchestration verifies the extracted download and runs the executable smoke', () => {
  const source = readFileSync(new URL('./release.mjs', import.meta.url), 'utf8')
  assert.match(source, /directDownloadReleasePlan/)
  assert.match(source, /packageDesktop\(\{/)
  assert.match(source, /artifacts\.length !== 1/)
  assert.match(source, /await verifyApp\(plan\.appPath\)/)
  assert.match(source, /entries\.length !== 1/)
  assert.match(source, /await verifyApp\(extractedApp\)/)
  assert.match(source, /await smokePackagedDesktop\(\{/)
  assert.match(source, /checksumLine\(digest, plan\.archiveName\)/)
  assert.match(source, /publishImmutableReleasePair/)
  assert.match(source, /version already has a direct-download output/)
  assert.doesNotMatch(source, /rm\(plan\.checksumPath/)

  const entitlements = readFileSync(new URL('./entitlements.mac.plist', import.meta.url), 'utf8')
  assert.match(entitlements, /com\.apple\.security\.cs\.allow-jit/)
  for (const denied of ['device.camera', 'device.microphone', 'device.audio-input', 'device.bluetooth', 'device.usb', 'photos-library', 'personal-information.location', 'device.print']) {
    assert.doesNotMatch(entitlements, new RegExp(`<key>com\\.apple\\.security\\.${denied}`), denied)
  }
})
