import { basename, dirname, join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import packagerConfig, { DESKTOP_BUNDLE_ID, DESKTOP_PRODUCT_NAME } from './packager.config.mjs'
import { assertUpdateBaseUrl, parseStableVersion } from './updateMetadata.mjs'
import { BUNDLED_GIT } from './bundledGit.mjs'

export const DIRECT_DOWNLOAD_ENV = Object.freeze({
  signingIdentity: 'APPLE_SIGNING_IDENTITY',
  notaryProfile: 'APPLE_NOTARY_KEYCHAIN_PROFILE',
  keychain: 'APPLE_KEYCHAIN',
})

export const DIRECT_DOWNLOAD_ARCHITECTURES = Object.freeze(['arm64', 'x64'])
export const DIRECT_DOWNLOAD_ARCHITECTURE_LABELS = Object.freeze({
  arm64: 'Apple Silicon',
  x64: 'Intel',
})

const SUPPORTED_ARCHES = new Set(DIRECT_DOWNLOAD_ARCHITECTURES)
const SAFE_VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/

function assertSafeVersion(version, subject = 'Direct macOS release') {
  if (!SAFE_VERSION.test(version ?? '')) throw new Error(`${subject} requires a safe semantic package version.`)
}

function assertSupportedArchitecture(architecture, subject = 'Direct macOS release') {
  if (!SUPPORTED_ARCHES.has(architecture)) {
    throw new Error(`${subject} architecture must be arm64 or x64, received ${architecture}.`)
  }
}

function releaseArtifactNames(version, architecture) {
  assertSafeVersion(version)
  assertSupportedArchitecture(architecture)
  const stem = `Agent-Commons-${version}-macos-${architecture}`
  return {
    archiveName: `${stem}.zip`,
    checksumName: `${stem}.zip.sha256`,
    receiptName: `${stem}.release.json`,
    updateName: `${stem}.update.json`,
  }
}

function required(env, key, label) {
  const value = env[key]?.trim()
  if (!value) throw new Error(`Direct macOS release requires ${key} (${label}).`)
  return value
}

function signingOptions({ identity, keychain, entitlementsPath }) {
  return {
    identity,
    ...(keychain ? { keychain } : {}),
    identityValidation: true,
    hardenedRuntime: true,
    strictVerify: true,
    continueOnError: false,
    preAutoEntitlements: false,
    // The source archive is data, sealed by the enclosing app signature. Do
    // not apply executable signing/xattrs to it; the adjacent Mach-O Git is
    // still discovered and signed normally, then checked again after extraction.
    ignore: [(filePath) => filePath.endsWith(`/Contents/Resources/agent-commons-git/${BUNDLED_GIT.sourceArchive}`)],
    preEmbedProvisioningProfile: false,
    // The plugin helper needs Electron's extra executable-memory/library
    // exceptions. Renderer and GPU helpers already resolve to this same JIT
    // profile; every generic binary avoids osx-sign's broad device defaults.
    optionsForFile(filePath) {
      if (filePath.endsWith('/Contents/Resources/agent-commons-git/git')) {
        return { entitlements: join(dirname(entitlementsPath), 'entitlements.git.plist') }
      }
      if (filePath.endsWith('/Contents/Resources/agent-commons-git-file')) {
        return { entitlements: join(dirname(entitlementsPath), 'entitlements.git.plist') }
      }
      return filePath.includes('(Plugin).app') ? null : { entitlements: entitlementsPath }
    },
  }
}

export function directDownloadReleasePlan({ root, manifest, env = process.env, platform, arch }) {
  if (platform !== 'darwin') {
    throw new Error('Direct signed/notarized releases must run on macOS.')
  }
  assertSupportedArchitecture(arch)
  assertSafeVersion(manifest?.version)

  const identity = required(env, DIRECT_DOWNLOAD_ENV.signingIdentity, 'Developer ID Application certificate name')
  if (!identity.startsWith('Developer ID Application:')) {
    throw new Error(`${DIRECT_DOWNLOAD_ENV.signingIdentity} must name a Developer ID Application identity.`)
  }
  const keychainProfile = required(
    env,
    DIRECT_DOWNLOAD_ENV.notaryProfile,
    'notarytool credentials stored in macOS Keychain',
  )
  const keychain = env[DIRECT_DOWNLOAD_ENV.keychain]?.trim() || undefined
  const updateBaseUrl = assertUpdateBaseUrl(env.AGENT_COMMONS_UPDATE_BASE_URL)
  parseStableVersion(manifest.version)
  const productName = manifest.productName
  if (productName !== DESKTOP_PRODUCT_NAME) throw new Error('Direct release product identity must remain Agent Commons.')

  const packageDirectory = join(root, 'out', `${productName}-darwin-${arch}`)
  const appPath = join(packageDirectory, `${productName}.app`)
  const releaseRoot = join(root, 'release')
  const releaseDirectory = join(releaseRoot, 'candidates', manifest.version, arch)
  const { archiveName, receiptName } = releaseArtifactNames(manifest.version, arch)
  const archivePath = join(releaseDirectory, archiveName)

  return {
    targetPlatform: 'darwin',
    targetArch: arch,
    packageDirectory,
    appPath,
    executablePath: join(appPath, 'Contents', 'MacOS', productName),
    releaseRoot,
    releaseDirectory,
    archiveName,
    archivePath,
    checksumPath: `${archivePath}.sha256`,
    receiptName,
    receiptPath: join(releaseDirectory, receiptName),
    bundleIdentity: {
      bundleIdentifier: DESKTOP_BUNDLE_ID,
      displayName: DESKTOP_PRODUCT_NAME,
      executableName: DESKTOP_PRODUCT_NAME,
      shortVersion: manifest.version,
      bundleVersion: manifest.version,
      updateBaseUrl,
      binaryArchitectures: [arch === 'x64' ? 'x86_64' : arch],
    },
    packagerOptions: {
      extendInfo: { ...packagerConfig.extendInfo, AgentCommonsUpdateBaseURL: updateBaseUrl },
      osxSign: signingOptions({
        identity,
        keychain,
        entitlementsPath: join(root, 'desktop', 'entitlements.mac.plist'),
      }),
      osxNotarize: {
        keychainProfile,
        ...(keychain ? { keychain } : {}),
      },
    },
  }
}

export function directDownloadReleaseSetPlan({ root, manifest }) {
  assertSafeVersion(manifest?.version, 'Direct macOS release set')
  if (manifest?.productName !== DESKTOP_PRODUCT_NAME) {
    throw new Error('Direct release set product identity must remain Agent Commons.')
  }
  const releaseDirectory = join(root, 'release')
  const candidateRoot = join(releaseDirectory, 'candidates', manifest.version)
  const manifestName = `Agent-Commons-${manifest.version}-macos.release.json`
  return {
    releaseDirectory,
    candidateRoot,
    manifestName,
    manifestPath: join(releaseDirectory, manifestName),
    artifacts: DIRECT_DOWNLOAD_ARCHITECTURES.map((architecture) => {
      const names = releaseArtifactNames(manifest.version, architecture)
      const candidateDirectory = join(candidateRoot, architecture)
      return {
        architecture,
        label: DIRECT_DOWNLOAD_ARCHITECTURE_LABELS[architecture],
        ...names,
        candidateArchivePath: join(candidateDirectory, names.archiveName),
        candidateChecksumPath: join(candidateDirectory, names.checksumName),
        candidateReceiptPath: join(candidateDirectory, names.receiptName),
        archivePath: join(releaseDirectory, names.archiveName),
        checksumPath: join(releaseDirectory, names.checksumName),
        receiptPath: join(releaseDirectory, names.receiptName),
        updatePath: join(releaseDirectory, names.updateName),
      }
    }),
  }
}

/** Read release identity from the bundle itself. `plutil` handles either XML or
 * binary Info.plist without parsing it in-process; `lipo` reports the Mach-O
 * architectures the downloaded executable actually contains. */
export function releaseBundleIdentityProbes(appPath, executablePath) {
  const infoPlist = join(appPath, 'Contents', 'Info.plist')
  const plistProbe = (field, key) => ({
    field,
    command: '/usr/bin/plutil',
    args: ['-extract', key, 'raw', '-o', '-', infoPlist],
  })
  return [
    plistProbe('bundleIdentifier', 'CFBundleIdentifier'),
    plistProbe('displayName', 'CFBundleDisplayName'),
    plistProbe('executableName', 'CFBundleExecutable'),
    plistProbe('shortVersion', 'CFBundleShortVersionString'),
    plistProbe('bundleVersion', 'CFBundleVersion'),
    plistProbe('updateBaseUrl', 'AgentCommonsUpdateBaseURL'),
    {
      field: 'binaryArchitectures',
      command: '/usr/bin/lipo',
      args: ['-archs', executablePath],
    },
  ]
}

export function validateReleaseBundleIdentity(actual, expected) {
  const text = (value) => typeof value === 'string' ? value.trim() : undefined
  const rawArchitectures = Array.isArray(actual?.binaryArchitectures)
    ? actual.binaryArchitectures
    : typeof actual?.binaryArchitectures === 'string'
      ? actual.binaryArchitectures.split(/\s+/)
      : []
  const normalized = {
    bundleIdentifier: text(actual?.bundleIdentifier),
    displayName: text(actual?.displayName),
    executableName: text(actual?.executableName),
    shortVersion: text(actual?.shortVersion),
    bundleVersion: text(actual?.bundleVersion),
    updateBaseUrl: typeof actual?.updateBaseUrl === 'string' ? actual.updateBaseUrl.replace(/\r?\n$/, '') : undefined,
    binaryArchitectures: rawArchitectures.map(text).filter(Boolean).sort(),
  }
  for (const field of ['bundleIdentifier', 'displayName', 'executableName', 'shortVersion', 'bundleVersion', 'updateBaseUrl']) {
    if (normalized[field] !== expected?.[field]) {
      throw new Error(`Release bundle ${field} does not match the immutable release plan.`)
    }
  }
  const expectedArchitectures = [...(expected?.binaryArchitectures ?? [])].sort()
  if (
    normalized.binaryArchitectures?.length !== expectedArchitectures.length ||
    normalized.binaryArchitectures.some((value, index) => value !== expectedArchitectures[index])
  ) {
    throw new Error('Release bundle binary architectures do not match the immutable release plan.')
  }
  return normalized
}

export function releaseVerificationCommands(appPath) {
  return [
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
  ]
}

export function archiveCreateCommand(appPath, archivePath) {
  return {
    command: '/usr/bin/ditto',
    args: ['-c', '-k', '--sequesterRsrc', '--keepParent', basename(appPath), archivePath],
    cwd: dirname(appPath),
  }
}

export function archiveExtractCommand(archivePath, destination) {
  return {
    command: '/usr/bin/ditto',
    args: ['-x', '-k', archivePath, destination],
  }
}

export function checksumLine(digest, archiveName) {
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('Release checksum must be a lowercase SHA-256 digest.')
  if (basename(archiveName) !== archiveName) throw new Error('Release checksum must name one archive, not a path.')
  return `${digest}  ${archiveName}\n`
}

export function releaseReceiptJson({ productName, version, platform, architecture, archiveName, bytes, sha256, bundleIdentity }) {
  if (productName !== DESKTOP_PRODUCT_NAME) throw new Error('Release receipt product identity must remain Agent Commons.')
  if (!SAFE_VERSION.test(version ?? '')) throw new Error('Release receipt requires a safe semantic package version.')
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(platform ?? '')) throw new Error('Release receipt requires a safe platform name.')
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(architecture ?? '')) {
    throw new Error('Release receipt requires a safe architecture name.')
  }
  const expectedArchive = `Agent-Commons-${version}-${platform}-${architecture}.zip`
  if (archiveName !== expectedArchive || basename(archiveName) !== archiveName) {
    throw new Error('Release receipt archive name must match its version, platform, and architecture.')
  }
  if (!Number.isSafeInteger(bytes) || bytes <= 0) throw new Error('Release receipt requires a positive archive byte size.')
  if (!/^[a-f0-9]{64}$/.test(sha256 ?? '')) throw new Error('Release receipt requires a lowercase SHA-256 digest.')
  const verifiedBundleIdentity = validateReleaseBundleIdentity(bundleIdentity, {
    bundleIdentifier: DESKTOP_BUNDLE_ID,
    displayName: DESKTOP_PRODUCT_NAME,
    executableName: DESKTOP_PRODUCT_NAME,
    shortVersion: version,
    bundleVersion: version,
    updateBaseUrl: assertUpdateBaseUrl(bundleIdentity?.updateBaseUrl),
    binaryArchitectures: [architecture === 'x64' ? 'x86_64' : architecture],
  })

  return `${JSON.stringify({
    schemaVersion: 3,
    product: productName,
    version,
    platform,
    architecture,
    artifact: {
      file: archiveName,
      bytes,
      sha256,
    },
    bundle: verifiedBundleIdentity,
    verification: {
      bundleIdentity: 'verified',
      codeSignature: 'verified',
      notarizationTicket: 'stapled',
      gatekeeper: 'accepted',
      executableSmoke: 'passed',
    },
  }, null, 2)}\n`
}

export function validateReleaseReceipt(receipt, { version, architecture, archiveName, bytes, sha256, updateBaseUrl }) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    throw new Error('Direct release candidate receipt must be a JSON object.')
  }
  let expected
  try {
    expected = JSON.parse(releaseReceiptJson({
      productName: DESKTOP_PRODUCT_NAME,
      version,
      platform: 'macos',
      architecture,
      archiveName,
      bytes,
      sha256,
      bundleIdentity: receipt.bundle,
    }))
  } catch (error) {
    throw new Error('Direct release candidate receipt does not match its artifact.', { cause: error })
  }
  if (!isDeepStrictEqual(receipt, expected)) {
    throw new Error('Direct release candidate receipt does not match its artifact.')
  }
  if (receipt.bundle.updateBaseUrl !== assertUpdateBaseUrl(updateBaseUrl)) {
    throw new Error('Direct release candidate update location does not match finalization.')
  }
  return receipt
}

export function releaseSetJson({ productName, version, artifacts }) {
  if (productName !== DESKTOP_PRODUCT_NAME) throw new Error('Direct release set product identity must remain Agent Commons.')
  assertSafeVersion(version, 'Direct macOS release set')
  if (!Array.isArray(artifacts) || artifacts.length !== DIRECT_DOWNLOAD_ARCHITECTURES.length) {
    throw new Error('Direct macOS release set requires exactly Apple Silicon and Intel candidates.')
  }
  const byArchitecture = new Map()
  for (const artifact of artifacts) {
    assertSupportedArchitecture(artifact?.architecture, 'Direct macOS release set')
    if (byArchitecture.has(artifact.architecture)) {
      throw new Error('Direct macOS release set candidates must have unique architectures.')
    }
    const names = releaseArtifactNames(version, artifact.architecture)
    if (
      artifact.archiveName !== names.archiveName ||
      artifact.checksumName !== names.checksumName ||
      artifact.receiptName !== names.receiptName
    ) {
      throw new Error('Direct macOS release set candidate names must match version and architecture.')
    }
    if (!Number.isSafeInteger(artifact.bytes) || artifact.bytes <= 0) {
      throw new Error('Direct macOS release set candidate requires a positive archive byte size.')
    }
    if (!/^[a-f0-9]{64}$/.test(artifact.sha256 ?? '')) {
      throw new Error('Direct macOS release set candidate requires a lowercase SHA-256 digest.')
    }
    byArchitecture.set(artifact.architecture, artifact)
  }
  const ordered = DIRECT_DOWNLOAD_ARCHITECTURES.map((architecture) => byArchitecture.get(architecture))
  if (ordered.some((artifact) => !artifact)) {
    throw new Error('Direct macOS release set requires one Apple Silicon and one Intel candidate.')
  }
  return `${JSON.stringify({
    schemaVersion: 2,
    product: productName,
    version,
    platform: 'macos',
    distribution: 'direct-download',
    artifacts: ordered.map((artifact) => ({
      architecture: artifact.architecture,
      label: DIRECT_DOWNLOAD_ARCHITECTURE_LABELS[artifact.architecture],
      file: artifact.archiveName,
      bytes: artifact.bytes,
      sha256: artifact.sha256,
      checksumFile: artifact.checksumName,
      receiptFile: artifact.receiptName,
      updateFile: releaseArtifactNames(version, artifact.architecture).updateName,
    })),
  }, null, 2)}\n`
}
