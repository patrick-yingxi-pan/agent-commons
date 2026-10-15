import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { packageDesktop } from './package.mjs'
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
import { smokePackagedDesktop } from './smoke.mjs'
import { inspectNativeMacReleaseHost } from './releaseHost.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

function run({ command, args, cwd = ROOT }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: process.env, stdio: 'inherit' })
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} failed with ${signal ? `signal ${signal}` : `code ${code}`}.`))
    })
  })
}

function capture({ command, args, cwd = ROOT }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve(stdout)
      else reject(new Error(`${command} failed with ${signal ? `signal ${signal}` : `code ${code}`}.\n${stderr}`))
    })
  })
}

async function sha256(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function verifyApp(appPath) {
  for (const command of releaseVerificationCommands(appPath)) await run(command)
}

async function verifyBundleIdentity(appPath, executablePath, expected) {
  const actual = {}
  for (const probe of releaseBundleIdentityProbes(appPath, executablePath)) {
    actual[probe.field] = await capture(probe)
  }
  return validateReleaseBundleIdentity(actual, expected)
}

async function preflightAppleTools() {
  for (const tool of ['codesign', 'notarytool', 'stapler']) {
    await run({ command: '/usr/bin/xcrun', args: ['--find', tool] })
  }
  for (const path of ['/usr/bin/ditto', '/usr/bin/lipo', '/usr/bin/plutil', '/usr/sbin/spctl']) {
    if (!existsSync(path)) throw new Error(`Required macOS release tool is missing: ${path}`)
  }
}

export async function releaseMacDirectDownload({ env = process.env } = {}) {
  const nativeHost = await inspectNativeMacReleaseHost()
  const manifest = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
  // Resolve all credentials and output names before a build writes anything.
  const plan = directDownloadReleasePlan({ root: ROOT, manifest, env, platform: nativeHost.platform, arch: nativeHost.architecture })
  if (existsSync(plan.archivePath) || existsSync(plan.checksumPath) || existsSync(plan.receiptPath)) {
    throw new Error('This version already has a direct-download output. Bump the package version before publishing again.')
  }
  await preflightAppleTools()

  const artifacts = await packageDesktop({
    targetPlatform: plan.targetPlatform,
    targetArch: plan.targetArch,
    releaseOptions: plan.packagerOptions,
  })
  if (
    artifacts.length !== 1 ||
    artifacts[0] !== plan.packageDirectory ||
    !existsSync(plan.appPath) ||
    !existsSync(plan.executablePath)
  ) {
    throw new Error('Signed packaging did not produce the one expected macOS application bundle.')
  }
  await verifyBundleIdentity(plan.appPath, plan.executablePath, plan.bundleIdentity)
  await verifyApp(plan.appPath)

  // A native candidate is immutable. Build and test in an isolated staging
  // directory, then store it with exclusive copies. The pair finalizer is the
  // only operation that promotes candidates into the public release directory.
  const staging = await mkdtemp(join(tmpdir(), 'agent-commons-direct-release-'))
  const stagedArchive = join(staging, plan.archiveName)
  const stagedChecksum = join(staging, `${plan.archiveName}.sha256`)
  const stagedReceipt = join(staging, plan.receiptName)
  const extracted = join(staging, 'extracted')
  try {
    await run(archiveCreateCommand(plan.appPath, stagedArchive))
    const archiveBytes = (await stat(stagedArchive)).size
    if (archiveBytes === 0) throw new Error('Direct-download archive is empty.')
    await mkdir(extracted)
    await run(archiveExtractCommand(stagedArchive, extracted))
    const entries = await readdir(extracted)
    if (entries.length !== 1 || entries[0] !== 'Agent Commons.app') {
      throw new Error('Direct-download archive must extract to exactly one Agent Commons application.')
    }
    const extractedApp = join(extracted, entries[0])
    const extractedExecutable = join(extractedApp, 'Contents', 'MacOS', 'Agent Commons')
    const downloadedBundleIdentity = await verifyBundleIdentity(extractedApp, extractedExecutable, plan.bundleIdentity)
    await verifyApp(extractedApp)
    await smokePackagedDesktop({
      executable: extractedExecutable,
    })

    const digest = await sha256(stagedArchive)
    await writeFile(stagedChecksum, checksumLine(digest, plan.archiveName), { encoding: 'utf8', mode: 0o644 })
    await writeFile(stagedReceipt, releaseReceiptJson({
      productName: manifest.productName,
      version: manifest.version,
      platform: 'macos',
      architecture: plan.targetArch,
      archiveName: plan.archiveName,
      bytes: archiveBytes,
      sha256: digest,
      bundleIdentity: downloadedBundleIdentity,
      nativeHost,
    }), { encoding: 'utf8', mode: 0o644 })
    await mkdir(plan.releaseDirectory, { recursive: true })
    await publishImmutableRelease({
      stagedArchive,
      archivePath: plan.archivePath,
      auxiliaryArtifacts: [
        { stagedPath: stagedReceipt, destinationPath: plan.receiptPath },
        { stagedPath: stagedChecksum, destinationPath: plan.checksumPath },
      ],
    })
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => {})
  }
  console.log(`[desktop-release-candidate] ${plan.archivePath}`)
  console.log(`[desktop-release-candidate] ${plan.checksumPath}`)
  console.log(`[desktop-release-candidate] ${plan.receiptPath}`)
  return plan
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await releaseMacDirectDownload()
