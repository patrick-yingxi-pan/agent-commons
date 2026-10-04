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
import { releaseUpdateFeedJson, validateUpdateBaseUrl } from './updateFeed.mjs'

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

export async function finalizeMacDirectDownloadSet({ root = ROOT, baseUrl = process.env.AGENT_COMMONS_UPDATE_BASE_URL, copy = copyFile, remove = rm } = {}) {
  validateUpdateBaseUrl(baseUrl)
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  const plan = directDownloadReleaseSetPlan({ root, manifest })
  const publicPaths = [
    plan.manifestPath,
    ...plan.artifacts.flatMap((candidate) => [candidate.receiptPath, candidate.checksumPath, candidate.archivePath, candidate.updatePath]),
  ]
  if (publicPaths.some((path) => existsSync(path))) {
    throw new Error('This version already has a public or partial direct-download release set. Bump the package version or audit the existing output.')
  }
  const staging = await mkdtemp(join(tmpdir(), 'agent-commons-release-set-'))
  const stagedManifest = join(staging, plan.manifestName)
  const failures = []
  try {
    // Hash and validate private snapshots, not mutable candidate paths that a
    // concurrent build could replace between verification and publication.
    const artifacts = []
    const candidateFiles = []
    for (const candidate of plan.artifacts) {
      const staged = { ...candidate }
      for (const [sourceKey, nameKey, destinationKey] of [
        ['candidateReceiptPath', 'receiptName', 'receiptPath'],
        ['candidateChecksumPath', 'checksumName', 'checksumPath'],
        ['candidateArchivePath', 'archiveName', 'archivePath'],
      ]) {
        await requireRegularFile(candidate[sourceKey], `${candidate.label} ${candidate[nameKey]}`)
        staged[sourceKey] = join(staging, candidate[nameKey])
        await copyFile(candidate[sourceKey], staged[sourceKey])
        candidateFiles.push({ stagedPath: staged[sourceKey], destinationPath: candidate[destinationKey] })
      }
      artifacts.push(await inspectCandidate(staged, manifest.version))
    }
    const updateFeeds = []
    for (const artifact of artifacts) {
      const candidate = plan.artifacts.find((row) => row.architecture === artifact.architecture)
      const stagedPath = join(staging, candidate.updateName)
      const { architecture, archiveName, bytes, sha256 } = artifact
      await writeFile(stagedPath, releaseUpdateFeedJson({
        baseUrl, version: manifest.version, artifact: { architecture, archiveName, bytes, sha256 },
      }), { encoding: 'utf8', mode: 0o644 })
      updateFeeds.push({ stagedPath, destinationPath: candidate.updatePath })
    }
    await writeFile(stagedManifest, releaseSetJson({
      productName: manifest.productName,
      version: manifest.version,
      artifacts,
    }), { encoding: 'utf8', mode: 0o644 })
    await mkdir(plan.releaseDirectory, { recursive: true })
    await publishImmutableReleaseSet({
      copy,
      artifacts: [...candidateFiles, ...updateFeeds],
      completionArtifact: { stagedPath: stagedManifest, destinationPath: plan.manifestPath },
    })
  } catch (error) {
    failures.push(error)
  }
  try {
    await remove(staging, { recursive: true, force: true })
  } catch (error) {
    throw new AggregateError(
      [...failures, error],
      `Direct macOS release-set private snapshot cleanup failed: ${staging}. Inspect release outputs and temporary snapshots before retrying; any completed release outputs are preserved.`,
    )
  }
  if (failures.length > 0) throw failures[0]
  console.log(`[desktop-release-set] ${plan.manifestPath}`)
  for (const candidate of plan.artifacts) console.log(`[desktop-release-set] ${candidate.archivePath}`)
  return plan
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await finalizeMacDirectDownloadSet()
