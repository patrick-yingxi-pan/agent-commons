import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isGitSnapshotPath, MAX_GIT_SNAPSHOT_ENTRIES } from '../contract/localGitSnapshot.mjs'
import { MAX_GIT_BROWSE_ENTRIES } from '../contract/localGitBrowse.mjs'

const MAX_METADATA_BYTES = 16 * 1024 * 1024
const MAX_INDEX_OUTPUT_BYTES = 2 * 1024 * 1024
const fail = () => { throw new Error('The repository is unavailable or has changed. Your saved snapshots have not been changed.') }

/** Copy the selected index and shared indexes, determine their hash format,
 * then prepare only a generated private config for the in-memory Git run. */
export async function prepareGitIndex({
  git,
  common,
  metadata,
  staging,
  load,
  copyMetadata,
  listSharedIndexes,
  fileExecutable,
  runGit,
  signal,
}) {
  const index = await copyMetadata(git, 'index', join(metadata, 'index'), MAX_METADATA_BYTES, true)
  const sharedNames = await listSharedIndexes(git, { signal, executable: fileExecutable })
  for (const name of sharedNames) await copyMetadata(git, name, join(metadata, name), MAX_METADATA_BYTES)

  let objectFormat = index && ['sha1', 'sha256'].find((algorithm) => {
    const size = algorithm === 'sha1' ? 20 : 32
    return index.byteLength > size && createHash(algorithm).update(index.subarray(0, -size)).digest().equals(index.subarray(-size))
  })

  // Skip-hash indexes have an all-zero trailer. Read only the one relevant
  // source config key through Git's no-includes mode; never copy source config.
  if (!objectFormat) {
    const config = await load(common, 'config', 128 * 1024)
    if (config.status !== 'missing') {
      if (config.status !== 'file' || !(config.bytes instanceof Uint8Array)) fail()
      const result = await runGit(['config', '--file', '-', '--no-includes', '--get', 'extensions.objectformat'], {
        cwd: staging,
        signal,
        input: config.bytes,
      })
      if (![0, 1].includes(result.status)) fail()
      const declared = result.status === 1
        ? 'sha1'
        : new TextDecoder('utf-8', { fatal: true }).decode(result.stdout).trim()
      if (!['sha1', 'sha256'].includes(declared)) fail()
      objectFormat = declared
    }
  }

  objectFormat ??= 'sha1'
  // A valid generated cone keeps Git from expanding sparse-directory entries
  // through this deliberately object-free private index store. No checkout or
  // sparse-index rewrite is requested; the captured index stays authoritative.
  await mkdir(join(metadata, 'info'), { recursive: true, mode: 0o700 })
  await writeFile(join(metadata, 'info', 'sparse-checkout'), '/*\n!/*/\n', { mode: 0o600, flag: 'wx' })
  await writeFile(join(metadata, 'config'), `[core]\nrepositoryformatversion=${objectFormat === 'sha256' ? 1 : 0}\nbare=false\nsparseCheckout=true\nsparseCheckoutCone=true\n[index]\nsparse=true\n${objectFormat === 'sha256' ? '[extensions]\nobjectformat=sha256\n' : ''}`, { mode: 0o600 })
  return objectFormat
}

/** Parse Git's NUL-delimited ls-files --stage output as authoritative stages.
 * Review additionally requests -t so skip-worktree never means deleted. */
export function parseGitIndexStages(bytes, { tagged = false, maxEntries = MAX_GIT_SNAPSHOT_ENTRIES } = {}) {
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > MAX_GIT_BROWSE_ENTRIES) fail()
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_INDEX_OUTPUT_BYTES) fail()
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  if (!text) return []
  if (!text.endsWith('\0')) fail()
  const records = text.slice(0, -1).split('\0')
  if (records.length > maxEntries * 4) fail()

  const entries = []
  const stagesByName = new Map()
  for (const record of records) {
    const tag = tagged ? record.slice(0, 2) : undefined
    if (tagged && !['H ', 'S ', 'M '].includes(tag)) fail()
    const match = /^(100644|100755|120000|160000|040000) ([a-f0-9]{40}|[a-f0-9]{64}) ([0-3])\t([^\0]+)$/.exec(tagged ? record.slice(2) : record)
    if (!match) fail()
    const mode = match[1]
    const oid = match[2]
    const stage = Number(match[3])
    if (tagged && (tag === 'M ') !== (stage !== 0)) fail()
    const name = mode === '040000' && match[4].endsWith('/') ? match[4].slice(0, -1) : match[4]
    if (!isGitSnapshotPath(name)) fail()

    const stages = stagesByName.get(name) ?? new Set()
    if (stages.has(stage) || (stage === 0 && stages.size > 0) || (stage !== 0 && stages.has(0))) fail()
    stages.add(stage)
    stagesByName.set(name, stages)
    entries.push({ name, mode, oid, stage, ...(tagged ? { skipWorktree: tag === 'S ' } : {}) })
    if (stagesByName.size > maxEntries) fail()
  }
  return entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : left.stage - right.stage)
}
