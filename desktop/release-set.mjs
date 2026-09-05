import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { copyFile, lstat, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  checksumLine,
  directDownloadReleaseSetPlan,
  releaseSetJson,
  validateReleaseReceipt,
} from './release-plan.mjs'
import { publishImmutableReleaseSet } from './release-publish.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

async function sha256(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function requireRegularFile(path, label) {
  let metadata
  try {
    metadata = await lstat(path)
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`Direct macOS release set is missing ${label}: ${path}`)
    throw error
  }
  if (!metadata.isFile()) throw new Error(`Direct macOS release set ${label} must be a regular file: ${path}`)
}

async function inspectCandidate(candidate, version) {
  await Promise.all([
    requireRegularFile(candidate.candidateArchivePath, `${candidate.label} archive`),
    requireRegularFile(candidate.candidateChecksumPath, `${candidate.label} checksum`),
    requireRegularFile(candidate.candidateReceiptPath, `${candidate.label} receipt`),
  ])
  const archiveBytes = (await stat(candidate.candidateArchivePath)).size
  if (archiveBytes === 0) throw new Error(`Direct macOS release set ${candidate.label} archive is empty.`)
  const digest = await sha256(candidate.candidateArchivePath)
  const adjacentChecksum = await readFile(candidate.candidateChecksumPath, 'utf8')
  if (adjacentChecksum !== checksumLine(digest, candidate.archiveName)) {
    throw new Error(`Direct macOS release set ${candidate.label} checksum does not match its archive.`)
  }
  let receipt
  try {
    receipt = JSON.parse(await readFile(candidate.candidateReceiptPath, 'utf8'))
  } catch (error) {
    throw new Error(`Direct macOS release set ${candidate.label} receipt is not valid JSON.`, { cause: error })
  }
  validateReleaseReceipt(receipt, {
    version,
    architecture: candidate.architecture,
    archiveName: candidate.archiveName,
    bytes: archiveBytes,
    sha256: digest,
  })
  return {
    architecture: candidate.architecture,
    archiveName: candidate.archiveName,
    checksumName: candidate.checksumName,
    receiptName: candidate.receiptName,
    bytes: archiveBytes,
    sha256: digest,
  }
}

export async function finalizeMacDirectDownloadSet({ root = ROOT } = {}) {
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  const plan = directDownloadReleaseSetPlan({ root, manifest })
  const publicPaths = [
    plan.manifestPath,
    ...plan.artifacts.flatMap((candidate) => [candidate.receiptPath, candidate.checksumPath, candidate.archivePath]),
  ]
  if (publicPaths.some((path) => existsSync(path))) {
    throw new Error('This version already has a public or partial direct-download release set. Bump the package version or audit the existing output.')
  }
  const artifacts = []
  for (const candidate of plan.artifacts) artifacts.push(await inspectCandidate(candidate, manifest.version))

  const staging = await mkdtemp(join(tmpdir(), 'agent-commons-release-set-'))
  const stagedManifest = join(staging, plan.manifestName)
  try {
    await writeFile(stagedManifest, releaseSetJson({
      productName: manifest.productName,
      version: manifest.version,
      artifacts,
    }), { encoding: 'utf8', mode: 0o644 })
    await mkdir(plan.releaseDirectory, { recursive: true })
    await publishImmutableReleaseSet({
      artifacts: plan.artifacts.flatMap((candidate) => [
        { stagedPath: candidate.candidateReceiptPath, destinationPath: candidate.receiptPath },
        { stagedPath: candidate.candidateChecksumPath, destinationPath: candidate.checksumPath },
        { stagedPath: candidate.candidateArchivePath, destinationPath: candidate.archivePath },
      ]),
      completionArtifact: { stagedPath: stagedManifest, destinationPath: plan.manifestPath },
    })
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => {})
  }
  console.log(`[desktop-release-set] ${plan.manifestPath}`)
  for (const candidate of plan.artifacts) console.log(`[desktop-release-set] ${candidate.archivePath}`)
  return plan
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await finalizeMacDirectDownloadSet()
