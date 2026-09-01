import { basename, dirname, join } from 'node:path'

export const DIRECT_DOWNLOAD_ENV = Object.freeze({
  signingIdentity: 'APPLE_SIGNING_IDENTITY',
  notaryProfile: 'APPLE_NOTARY_KEYCHAIN_PROFILE',
  keychain: 'APPLE_KEYCHAIN',
})

const SUPPORTED_ARCHES = new Set(['arm64', 'x64'])
const SAFE_VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/

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
    preEmbedProvisioningProfile: false,
    // The plugin helper needs Electron's extra executable-memory/library
    // exceptions. Renderer and GPU helpers already resolve to this same JIT
    // profile; every generic binary avoids osx-sign's broad device defaults.
    optionsForFile(filePath) {
      return filePath.includes('(Plugin).app') ? null : { entitlements: entitlementsPath }
    },
  }
}

export function directDownloadReleasePlan({ root, manifest, env = process.env, platform, arch }) {
  if (platform !== 'darwin') {
    throw new Error('Direct signed/notarized releases must run on macOS.')
  }
  if (!SUPPORTED_ARCHES.has(arch)) {
    throw new Error(`Direct macOS release architecture must be arm64 or x64, received ${arch}.`)
  }
  if (!SAFE_VERSION.test(manifest?.version ?? '')) {
    throw new Error('Direct macOS release requires a safe semantic package version.')
  }

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
  const productName = manifest.productName
  if (productName !== 'Agent Commons') throw new Error('Direct release product identity must remain Agent Commons.')

  const packageDirectory = join(root, 'out', `${productName}-darwin-${arch}`)
  const appPath = join(packageDirectory, `${productName}.app`)
  const releaseDirectory = join(root, 'release')
  const archiveName = `Agent-Commons-${manifest.version}-macos-${arch}.zip`
  const archivePath = join(releaseDirectory, archiveName)
  const receiptName = `Agent-Commons-${manifest.version}-macos-${arch}.release.json`

  return {
    targetPlatform: 'darwin',
    targetArch: arch,
    packageDirectory,
    appPath,
    executablePath: join(appPath, 'Contents', 'MacOS', productName),
    releaseDirectory,
    archiveName,
    archivePath,
    checksumPath: `${archivePath}.sha256`,
    receiptName,
    receiptPath: join(releaseDirectory, receiptName),
    packagerOptions: {
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

export function releaseReceiptJson({ productName, version, platform, architecture, archiveName, bytes, sha256 }) {
  if (productName !== 'Agent Commons') throw new Error('Release receipt product identity must remain Agent Commons.')
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

  return `${JSON.stringify({
    schemaVersion: 1,
    product: productName,
    version,
    platform,
    architecture,
    artifact: {
      file: archiveName,
      bytes,
      sha256,
    },
    verification: {
      codeSignature: 'verified',
      notarizationTicket: 'stapled',
      gatekeeper: 'accepted',
      executableSmoke: 'passed',
    },
  }, null, 2)}\n`
}
