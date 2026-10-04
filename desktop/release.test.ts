import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  archiveCreateCommand,
  archiveExtractCommand,
  checksumLine,
  directDownloadReleasePlan,
  directDownloadReleaseSetPlan,
  releaseBundleIdentityProbes,
  releaseReceiptJson,
  releaseSetJson,
  releaseVerificationCommands,
  validateReleaseReceipt,
  validateReleaseBundleIdentity,
} from './release-plan.mjs'
import { publishImmutableRelease, publishImmutableReleaseSet } from './release-publish.mjs'
import { finalizeMacDirectDownloadSet } from './release-set.mjs'

const root = '/repo'
const manifest = { version: '0.1.0', productName: 'Agent Commons' }
const validEnv = {
  APPLE_SIGNING_IDENTITY: 'Developer ID Application: Agent Commons (ABCDE12345)',
  APPLE_NOTARY_KEYCHAIN_PROFILE: 'agent-commons-notary',
  AGENT_COMMONS_UPDATE_BASE_URL: 'https://updates.example.com/releases/',
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
  for (const updateBaseUrl of [undefined, 'http://updates.example.com/releases/', 'https://updates.example.com/releases']) {
    assert.throws(() => directDownloadReleasePlan({
      root, manifest, env: { ...validEnv, AGENT_COMMONS_UPDATE_BASE_URL: updateBaseUrl }, platform: 'darwin', arch: 'arm64',
    }), /AGENT_COMMONS_UPDATE_BASE_URL/)
  }
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
  assert.equal(plan.releaseRoot, '/repo/release')
  assert.equal(plan.releaseDirectory, '/repo/release/candidates/0.1.0/arm64')
  assert.equal(plan.archivePath, '/repo/release/candidates/0.1.0/arm64/Agent-Commons-0.1.0-macos-arm64.zip')
  assert.equal(plan.checksumPath, `${plan.archivePath}.sha256`)
  assert.equal(plan.receiptName, 'Agent-Commons-0.1.0-macos-arm64.release.json')
  assert.equal(plan.receiptPath, '/repo/release/candidates/0.1.0/arm64/Agent-Commons-0.1.0-macos-arm64.release.json')
  assert.deepEqual(plan.bundleIdentity, {
    bundleIdentifier: 'com.agentcommons.desktop',
    displayName: 'Agent Commons',
    executableName: 'Agent Commons',
    shortVersion: '0.1.0',
    bundleVersion: '0.1.0',
    updateBaseUrl: validEnv.AGENT_COMMONS_UPDATE_BASE_URL,
    binaryArchitectures: ['arm64'],
  })
  assert.deepEqual(plan.packagerOptions.osxNotarize, {
    keychainProfile: 'agent-commons-notary',
    keychain: '/build/release.keychain-db',
  })
  assert.equal(plan.packagerOptions.extendInfo.AgentCommonsUpdateBaseURL, validEnv.AGENT_COMMONS_UPDATE_BASE_URL)
  assert.deepEqual(plan.packagerOptions.extendInfo.NSAppTransportSecurity, {
    NSAllowsArbitraryLoads: false, NSAllowsLocalNetworking: true,
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
    { field: 'updateBaseUrl', command: '/usr/bin/plutil', args: ['-extract', 'AgentCommonsUpdateBaseURL', 'raw', '-o', '-', `${appPath}/Contents/Info.plist`] },
    { field: 'binaryArchitectures', command: '/usr/bin/lipo', args: ['-archs', executablePath] },
  ])

  const expected = directDownloadReleasePlan({ root, manifest, env: validEnv, platform: 'darwin', arch: 'arm64' }).bundleIdentity
  const actual = {
    bundleIdentifier: 'com.agentcommons.desktop\n',
    displayName: 'Agent Commons\n',
    executableName: 'Agent Commons\n',
    shortVersion: '0.1.0\n',
    bundleVersion: '0.1.0\n',
    updateBaseUrl: `${validEnv.AGENT_COMMONS_UPDATE_BASE_URL}\n`,
    binaryArchitectures: 'arm64\n',
  }
  assert.doesNotThrow(() => validateReleaseBundleIdentity(actual, expected))
  for (const [field, value] of [
    ['bundleIdentifier', 'com.example.impostor'],
    ['displayName', 'Other App'],
    ['executableName', 'Other App'],
    ['shortVersion', '0.2.0'],
    ['bundleVersion', '99'],
    ['updateBaseUrl', 'https://other.example.com/releases/'],
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

test('direct download release set requires separate Apple Silicon and Intel artifacts', () => {
  const plan = directDownloadReleaseSetPlan({ root, manifest })
  assert.equal(plan.candidateRoot, '/repo/release/candidates/0.1.0')
  assert.equal(plan.manifestPath, '/repo/release/Agent-Commons-0.1.0-macos.release.json')
  assert.deepEqual(plan.artifacts.map(({ architecture, label, archiveName, candidateArchivePath, archivePath }) => ({
    architecture,
    label,
    archiveName,
    candidateArchivePath,
    archivePath,
  })), [
    {
      architecture: 'arm64',
      label: 'Apple Silicon',
      archiveName: 'Agent-Commons-0.1.0-macos-arm64.zip',
      candidateArchivePath: '/repo/release/candidates/0.1.0/arm64/Agent-Commons-0.1.0-macos-arm64.zip',
      archivePath: '/repo/release/Agent-Commons-0.1.0-macos-arm64.zip',
    },
    {
      architecture: 'x64',
      label: 'Intel',
      archiveName: 'Agent-Commons-0.1.0-macos-x64.zip',
      candidateArchivePath: '/repo/release/candidates/0.1.0/x64/Agent-Commons-0.1.0-macos-x64.zip',
      archivePath: '/repo/release/Agent-Commons-0.1.0-macos-x64.zip',
    },
  ])
  assert.throws(
    () => directDownloadReleaseSetPlan({ root, manifest: { ...manifest, version: '../next' } }),
    /safe semantic package version/,
  )
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
    schemaVersion: 3,
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

  const receipt = JSON.parse(json)
  assert.equal(validateReleaseReceipt(receipt, {
    updateBaseUrl: validEnv.AGENT_COMMONS_UPDATE_BASE_URL,
    version: '0.1.0',
    architecture: 'arm64',
    archiveName: 'Agent-Commons-0.1.0-macos-arm64.zip',
    bytes: 12_345,
    sha256: digest,
  }), receipt)
  assert.throws(
    () => validateReleaseReceipt({ ...receipt, verification: { ...receipt.verification, executableSmoke: 'skipped' } }, {
      updateBaseUrl: validEnv.AGENT_COMMONS_UPDATE_BASE_URL,
      version: '0.1.0',
      architecture: 'arm64',
      archiveName: 'Agent-Commons-0.1.0-macos-arm64.zip',
      bytes: 12_345,
      sha256: digest,
    }),
    /does not match its artifact/,
  )
})

test('release-set manifest is deterministic, ordered, and incomplete pairs fail closed', () => {
  const artifacts = [
    {
      architecture: 'x64',
      archiveName: 'Agent-Commons-0.1.0-macos-x64.zip',
      checksumName: 'Agent-Commons-0.1.0-macos-x64.zip.sha256',
      receiptName: 'Agent-Commons-0.1.0-macos-x64.release.json',
      bytes: 22,
      sha256: '2'.repeat(64),
    },
    {
      architecture: 'arm64',
      archiveName: 'Agent-Commons-0.1.0-macos-arm64.zip',
      checksumName: 'Agent-Commons-0.1.0-macos-arm64.zip.sha256',
      receiptName: 'Agent-Commons-0.1.0-macos-arm64.release.json',
      bytes: 11,
      sha256: '1'.repeat(64),
    },
  ]
  const releaseSet = JSON.parse(releaseSetJson({ productName: 'Agent Commons', version: '0.1.0', artifacts }))
  assert.equal(releaseSet.schemaVersion, 2)
  assert.equal(releaseSet.distribution, 'direct-download')
  assert.deepEqual(releaseSet.artifacts.map(({ architecture, label, updateFile }) => ({ architecture, label, updateFile })), [
    { architecture: 'arm64', label: 'Apple Silicon', updateFile: 'Agent-Commons-0.1.0-macos-arm64.update.json' },
    { architecture: 'x64', label: 'Intel', updateFile: 'Agent-Commons-0.1.0-macos-x64.update.json' },
  ])
  assert.throws(
    () => releaseSetJson({ productName: 'Agent Commons', version: '0.1.0', artifacts: artifacts.slice(0, 1) }),
    /exactly Apple Silicon and Intel/,
  )
  assert.throws(
    () => releaseSetJson({ productName: 'Agent Commons', version: '0.1.0', artifacts: [artifacts[0], artifacts[0]] }),
    /unique architectures/,
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

test('release-set publication writes its completion marker last and rolls back partial pairs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-commons-release-set-publish-test-'))
  try {
    const stagedArm = join(directory, 'staged-arm.zip')
    const stagedIntel = join(directory, 'staged-intel.zip')
    const stagedArmFeed = join(directory, 'staged-arm.update.json')
    const stagedIntelFeed = join(directory, 'staged-intel.update.json')
    const stagedManifest = join(directory, 'staged-release.json')
    await writeFile(stagedArm, 'arm')
    await writeFile(stagedIntel, 'intel')
    await writeFile(stagedArmFeed, 'arm feed')
    await writeFile(stagedIntelFeed, 'intel feed')
    await writeFile(stagedManifest, 'complete')
    const arm = join(directory, 'arm.zip')
    const intel = join(directory, 'intel.zip')
    const armFeed = join(directory, 'arm.update.json')
    const intelFeed = join(directory, 'intel.update.json')
    const releaseManifest = join(directory, 'release.json')
    const order = []
    await publishImmutableReleaseSet({
      artifacts: [
        { stagedPath: stagedArm, destinationPath: arm },
        { stagedPath: stagedIntel, destinationPath: intel },
        { stagedPath: stagedArmFeed, destinationPath: armFeed },
        { stagedPath: stagedIntelFeed, destinationPath: intelFeed },
      ],
      completionArtifact: { stagedPath: stagedManifest, destinationPath: releaseManifest },
      async copy(source, destination, flags) {
        order.push(source)
        await copyFile(source, destination, flags)
      },
    })
    assert.deepEqual(order, [stagedArm, stagedIntel, stagedArmFeed, stagedIntelFeed, stagedManifest])
    assert.equal(await readFile(armFeed, 'utf8'), 'arm feed')
    assert.equal(await readFile(intelFeed, 'utf8'), 'intel feed')

    const immutableArm = join(directory, 'immutable-arm.zip')
    const immutableFeed = join(directory, 'immutable.update.json')
    const immutableManifest = join(directory, 'immutable-release.json')
    await writeFile(immutableFeed, 'published feed')
    await assert.rejects(
      publishImmutableReleaseSet({
        artifacts: [
          { stagedPath: stagedArm, destinationPath: immutableArm },
          { stagedPath: stagedArmFeed, destinationPath: immutableFeed },
        ],
        completionArtifact: { stagedPath: stagedManifest, destinationPath: immutableManifest },
      }),
      /EEXIST/,
    )
    assert.equal(existsSync(immutableArm), false, 'a feed collision rolls back the newly copied archive')
    assert.equal(await readFile(immutableFeed, 'utf8'), 'published feed', 'an existing feed is never overwritten or removed')
    assert.equal(existsSync(immutableManifest), false)

    const failedArm = join(directory, 'failed-arm.zip')
    const failedIntel = join(directory, 'failed-intel.zip')
    const failedArmFeed = join(directory, 'failed-arm.update.json')
    const failedIntelFeed = join(directory, 'failed-intel.update.json')
    const failedManifest = join(directory, 'failed-release.json')
    // Preserve second-architecture refusal and cover both feed and marker failures.
    for (const failAt of [2, 4, 5]) {
      let copies = 0
      await assert.rejects(
        publishImmutableReleaseSet({
          artifacts: [
            { stagedPath: stagedArm, destinationPath: failedArm },
            { stagedPath: stagedIntel, destinationPath: failedIntel },
            { stagedPath: stagedArmFeed, destinationPath: failedArmFeed },
            { stagedPath: stagedIntelFeed, destinationPath: failedIntelFeed },
          ],
          completionArtifact: { stagedPath: stagedManifest, destinationPath: failedManifest },
          async copy(source, destination) {
            copies += 1
            if (copies === failAt) throw new Error('simulated release-set copy failure')
            await copyFile(source, destination)
          },
        }),
        /simulated release-set copy failure/,
      )
      assert.equal(existsSync(failedArm), false)
      assert.equal(existsSync(failedIntel), false)
      assert.equal(existsSync(failedArmFeed), false)
      assert.equal(existsSync(failedIntelFeed), false)
      assert.equal(existsSync(failedManifest), false)
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('release-set finalizer verifies both candidates before exposing either public ZIP', async () => {
  const baseUrl = 'https://updates.example.com/releases/'
  const testRoot = await mkdtemp(join(tmpdir(), 'agent-commons-release-set-finalize-test-'))
  try {
    await writeFile(join(testRoot, 'package.json'), `${JSON.stringify(manifest)}\n`)
    const plan = directDownloadReleaseSetPlan({ root: testRoot, manifest })
    for (const candidate of plan.artifacts) {
      await mkdir(join(plan.candidateRoot, candidate.architecture), { recursive: true })
      const contents = `signed-${candidate.architecture}-archive`
      const digest = createHash('sha256').update(contents).digest('hex')
      await writeFile(candidate.candidateArchivePath, contents)
      await writeFile(candidate.candidateChecksumPath, checksumLine(digest, candidate.archiveName))
      const bundleIdentity = directDownloadReleasePlan({
        root: testRoot,
        manifest,
        env: validEnv,
        platform: 'darwin',
        arch: candidate.architecture,
      }).bundleIdentity
      await writeFile(candidate.candidateReceiptPath, releaseReceiptJson({
        productName: manifest.productName,
        version: manifest.version,
        platform: 'macos',
        architecture: candidate.architecture,
        archiveName: candidate.archiveName,
        bytes: Buffer.byteLength(contents),
        sha256: digest,
        bundleIdentity,
      }))
    }
    const configuredBaseUrl = process.env.AGENT_COMMONS_UPDATE_BASE_URL
    try {
      delete process.env.AGENT_COMMONS_UPDATE_BASE_URL
      await assert.rejects(
        finalizeMacDirectDownloadSet({ root: testRoot }),
        /AGENT_COMMONS_UPDATE_BASE_URL.*canonical HTTPS directory URL/,
      )
    } finally {
      if (configuredBaseUrl === undefined) delete process.env.AGENT_COMMONS_UPDATE_BASE_URL
      else process.env.AGENT_COMMONS_UPDATE_BASE_URL = configuredBaseUrl
    }
    await assert.rejects(
      finalizeMacDirectDownloadSet({ root: testRoot, baseUrl: 'http://updates.example.com/releases/' }),
      /AGENT_COMMONS_UPDATE_BASE_URL.*canonical public HTTPS directory URL/,
    )
    assert.equal(plan.artifacts.every((candidate) => !existsSync(candidate.updatePath)), true, 'invalid feed configuration writes no feed')
    await assert.rejects(
      finalizeMacDirectDownloadSet({ root: testRoot, baseUrl: 'https://other.example.com/releases/' }),
      /update location does not match finalization/,
    )
    assert.equal(existsSync(plan.manifestPath), false, 'destination mismatch must not publish a completion marker')
    assert.equal(plan.artifacts.every((candidate) => !existsSync(candidate.updatePath) && !existsSync(candidate.archivePath)), true,
      'signed destination mismatch publishes neither feeds nor archives')
    const intel = plan.artifacts.find((candidate) => candidate.architecture === 'x64')
    assert.ok(intel)
    await writeFile(intel.candidateChecksumPath, `${'0'.repeat(64)}  ${intel.archiveName}\n`)
    await assert.rejects(
      finalizeMacDirectDownloadSet({ root: testRoot, baseUrl }),
      /Intel checksum does not match its archive/,
    )
    assert.equal(existsSync(plan.manifestPath), false)
    assert.equal(plan.artifacts.every((candidate) => !existsSync(candidate.updatePath)), true, 'invalid candidate pairs publish no updater feeds')
    assert.equal(plan.artifacts.every((candidate) => (
      !existsSync(candidate.archivePath) && !existsSync(candidate.checksumPath) && !existsSync(candidate.receiptPath)
    )), true)
    const intelDigest = createHash('sha256').update(await readFile(intel.candidateArchivePath)).digest('hex')
    await writeFile(intel.candidateChecksumPath, checksumLine(intelDigest, intel.archiveName))
    const arm = plan.artifacts.find((candidate) => candidate.architecture === 'arm64')
    assert.ok(arm)
    await writeFile(arm.updatePath, 'pre-existing feed')
    await assert.rejects(
      finalizeMacDirectDownloadSet({ root: testRoot, baseUrl }),
      /already has a public or partial direct-download release set/,
    )
    assert.equal(await readFile(arm.updatePath, 'utf8'), 'pre-existing feed', 'a pre-existing architecture feed is immutable')
    assert.equal(plan.artifacts.every((candidate) => !existsSync(candidate.archivePath)), true, 'feed collision publishes no archive')
    await rm(arm.updatePath)

    let changedCandidate = false
    await finalizeMacDirectDownloadSet({
      root: testRoot,
      baseUrl,
      async copy(source, destination, flags) {
        // Simulate a build replacing its candidate after validation but before
        // publication. The release must use its verified private snapshot.
        if (!changedCandidate) {
          changedCandidate = true
          await writeFile(arm.candidateArchivePath, 'changed-after-candidate-validation')
        }
        await copyFile(source, destination, flags)
      },
    })
    assert.equal(changedCandidate, true)
    assert.equal(await readFile(arm.archivePath, 'utf8'), 'signed-arm64-archive')
    assert.equal(existsSync(plan.manifestPath), true)
    assert.equal(plan.artifacts.every((candidate) => (
      existsSync(candidate.archivePath) && existsSync(candidate.checksumPath) && existsSync(candidate.receiptPath)
    )), true)
    const releaseSet = JSON.parse(await readFile(plan.manifestPath, 'utf8'))
    assert.deepEqual(releaseSet.artifacts.map((artifact) => artifact.label), ['Apple Silicon', 'Intel'])
    assert.equal(releaseSet.schemaVersion, 2)
    for (const candidate of plan.artifacts) {
      const archive = await readFile(candidate.archivePath)
      const digest = createHash('sha256').update(archive).digest('hex')
      const feed = JSON.parse(await readFile(candidate.updatePath, 'utf8'))
      assert.deepEqual(feed, {
        currentRelease: manifest.version,
        releases: [{
          version: manifest.version,
          updateTo: {
            version: manifest.version,
            url: `${baseUrl}${candidate.archiveName}`,
            name: manifest.version,
            sha256: digest,
            size: archive.byteLength,
          },
        }],
      })
      const entry = releaseSet.artifacts.find((artifact) => artifact.architecture === candidate.architecture)
      assert.equal(entry?.updateFile, candidate.updateName)
      assert.equal(feed.releases[0].updateTo.sha256, entry?.sha256)
      assert.equal(feed.releases[0].updateTo.size, entry?.bytes)
    }
    await assert.rejects(
      finalizeMacDirectDownloadSet({ root: testRoot, baseUrl }),
      /already has a public or partial direct-download release set/,
    )
  } finally {
    await rm(testRoot, { recursive: true, force: true })
  }
})

async function validReleaseSetFixture() {
  const root = await mkdtemp(join(tmpdir(), 'agent-commons-release-set-cleanup-test-'))
  await writeFile(join(root, 'package.json'), `${JSON.stringify(manifest)}\n`)
  const plan = directDownloadReleaseSetPlan({ root, manifest })
  for (const candidate of plan.artifacts) {
    await mkdir(join(plan.candidateRoot, candidate.architecture), { recursive: true })
    const contents = `signed-${candidate.architecture}-archive`
    const digest = createHash('sha256').update(contents).digest('hex')
    await writeFile(candidate.candidateArchivePath, contents)
    await writeFile(candidate.candidateChecksumPath, checksumLine(digest, candidate.archiveName))
    const bundleIdentity = directDownloadReleasePlan({
      root,
      manifest,
      env: validEnv,
      platform: 'darwin',
      arch: candidate.architecture,
    }).bundleIdentity
    await writeFile(candidate.candidateReceiptPath, releaseReceiptJson({
      productName: manifest.productName,
      version: manifest.version,
      platform: 'macos',
      architecture: candidate.architecture,
      archiveName: candidate.archiveName,
      bytes: Buffer.byteLength(contents),
      sha256: digest,
      bundleIdentity,
    }))
  }
  return { root, plan }
}

test('release-set finalizer reports private snapshot cleanup failure after publishing a complete set', async () => {
  const { root, plan } = await validReleaseSetFixture()
  const baseUrl = 'https://updates.example.com/releases/'
  let snapshotDirectory: string | undefined
  try {
    await assert.rejects(
      finalizeMacDirectDownloadSet({
        root,
        baseUrl,
        async remove(path, options) {
          if (path.includes('agent-commons-release-set-')) {
            snapshotDirectory = path
            throw new Error('simulated private snapshot cleanup failure')
          }
          await rm(path, options)
        },
      }),
      (error: unknown) => {
        assert.equal(error instanceof AggregateError, true)
        const aggregate = error as AggregateError
        assert.match(aggregate.message, /private snapshot cleanup failed/i)
        assert.match(aggregate.message, /inspect.*before retry/i)
        assert.ok(snapshotDirectory)
        assert.ok(aggregate.message.includes(snapshotDirectory), 'the operator sees the exact private snapshot directory')
        assert.equal(aggregate.errors.length, 1, 'cleanup-only failure has one exact cause')
        assert.equal(aggregate.errors.some((entry) => entry instanceof Error && entry.message === 'simulated private snapshot cleanup failure'), true)
        return true
      },
    )
    assert.ok(snapshotDirectory, 'the finalizer attempted to remove its private candidate snapshot directory')
    assert.equal(existsSync(snapshotDirectory), true, 'failed cleanup leaves the named private directory for inspection')
    assert.equal(existsSync(plan.manifestPath), true, 'completed outputs remain published and must be inspected before retry')
    for (const candidate of plan.artifacts) {
      assert.equal(existsSync(candidate.archivePath), true)
      assert.equal(existsSync(candidate.checksumPath), true)
      assert.equal(existsSync(candidate.receiptPath), true)
      assert.equal(existsSync(candidate.updatePath), true)
    }
  } finally {
    if (snapshotDirectory) await rm(snapshotDirectory, { recursive: true, force: true })
    await rm(root, { recursive: true, force: true })
  }
})

test('release-set finalizer preserves candidate validation and private snapshot cleanup failures', async () => {
  const { root, plan } = await validReleaseSetFixture()
  const candidate = plan.artifacts.find((artifact) => artifact.architecture === 'x64')!
  await writeFile(candidate.candidateChecksumPath, `${'0'.repeat(64)}  ${candidate.archiveName}\n`)
  let snapshotDirectory: string | undefined
  try {
    await assert.rejects(
      finalizeMacDirectDownloadSet({
        root,
        baseUrl: 'https://updates.example.com/releases/',
        async remove(path, options) {
          if (path.includes('agent-commons-release-set-')) {
            snapshotDirectory = path
            throw new Error('simulated private snapshot cleanup failure')
          }
          await rm(path, options)
        },
      }),
      (error: unknown) => {
        assert.equal(error instanceof AggregateError, true)
        const aggregate = error as AggregateError
        assert.match(aggregate.message, /private snapshot cleanup failed/i)
        assert.match(aggregate.message, /inspect.*before retry/i)
        assert.ok(snapshotDirectory)
        assert.ok(aggregate.message.includes(snapshotDirectory), 'the operator sees the exact private snapshot directory')
        assert.equal(aggregate.errors.length, 2, 'validation and cleanup failures remain distinct causes')
        assert.equal(aggregate.errors.some((entry) => entry instanceof Error && /Intel checksum does not match its archive/.test(entry.message)), true)
        assert.equal(aggregate.errors.some((entry) => entry instanceof Error && entry.message === 'simulated private snapshot cleanup failure'), true)
        return true
      },
    )
    assert.ok(snapshotDirectory, 'the finalizer attempted private snapshot cleanup after validation failed')
    assert.equal(existsSync(snapshotDirectory), true, 'failed cleanup leaves the named private directory for inspection')
    assert.equal(existsSync(plan.manifestPath), false, 'validation failure publishes no completion marker')
    for (const artifact of plan.artifacts) {
      assert.equal(existsSync(artifact.archivePath), false)
      assert.equal(existsSync(artifact.checksumPath), false)
      assert.equal(existsSync(artifact.receiptPath), false)
      assert.equal(existsSync(artifact.updatePath), false)
    }
  } finally {
    if (snapshotDirectory) await rm(snapshotDirectory, { recursive: true, force: true })
    await rm(root, { recursive: true, force: true })
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

  const setSource = readFileSync(new URL('./release-set.mjs', import.meta.url), 'utf8')
  assert.match(setSource, /for \(const candidate of plan\.artifacts\)/)
  assert.match(setSource, /validateReleaseReceipt/)
  assert.match(setSource, /adjacentChecksum !== checksumLine/)
  assert.match(setSource, /publishImmutableReleaseSet/)
  assert.match(setSource, /completionArtifact:/)

  const entitlements = readFileSync(new URL('./entitlements.mac.plist', import.meta.url), 'utf8')
  assert.match(entitlements, /com\.apple\.security\.cs\.allow-jit/)
  for (const denied of ['device.camera', 'device.microphone', 'device.audio-input', 'device.bluetooth', 'device.usb', 'photos-library', 'personal-information.location', 'device.print']) {
    assert.doesNotMatch(entitlements, new RegExp(`<key>com\\.apple\\.security\\.${denied}`), denied)
  }
})
