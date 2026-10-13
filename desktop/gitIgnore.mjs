import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isGitSnapshotPath } from '../contract/localGitSnapshot.mjs'
import { MAX_GIT_BROWSE_ENTRIES } from '../contract/localGitBrowse.mjs'

const MAX_ENTRIES = 500
const MAX_DIRECTORIES = 1024
const MAX_DEPTH = 64
const MAX_IGNORE_FILE_BYTES = 64 * 1024
const MAX_BATCH_BYTES = 32 * 1024
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
const MODES = new Set(['100644', '100755', '120000', '160000', '040000'])
const DIRECTORY_MODES = new Set(['160000', '040000'])
const fail = () => { throw new Error('Git ignore evaluation is unavailable or exceeds its read limits.') }

function checkedEntries(entries, maximum) {
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > MAX_GIT_BROWSE_ENTRIES ||
    !Array.isArray(entries) || entries.length > maximum) fail()
  const unique = new Map()
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
      Object.keys(entry).sort().join(',') !== 'mode,name' || !isGitSnapshotPath(entry.name) || !MODES.has(entry.mode)) fail()
    const previous = unique.get(entry.name)
    if (previous && previous !== entry.mode) {
      // Index/HEAD unions can contain a path/file-directory transition. Keep
      // directory structure if either view needs it; ignore matching remains
      // conservative for both candidate names.
      if (DIRECTORY_MODES.has(previous) || DIRECTORY_MODES.has(entry.mode)) unique.set(entry.name, '040000')
      else unique.set(entry.name, '100644')
    } else unique.set(entry.name, entry.mode)
  }
  return [...unique].map(([name, mode]) => ({ name, mode }))
}

function structure(entries) {
  const directories = new Set()
  const candidates = new Set()
  for (const { name, mode } of entries) {
    candidates.add(name)
    const parts = name.split('/')
    if (parts.length - 1 > MAX_DEPTH) fail()
    for (let i = 1; i < parts.length; i++) directories.add(parts.slice(0, i).join('/'))
    if (DIRECTORY_MODES.has(mode)) directories.add(name)
    if (directories.size > MAX_DIRECTORIES) fail()
  }
  return { directories, candidates }
}

function safeBytes(value, maxBytes) {
  return value?.status === 'file' && value.bytes instanceof Uint8Array &&
    value.sizeBytes === value.bytes.byteLength && value.bytes.byteLength <= maxBytes
}

async function copyIgnoreFile({ base, name, destination, load, reserveMetadata, optionalUnsupported }) {
  const value = await load(base, name, MAX_IGNORE_FILE_BYTES)
  if (value.status === 'missing' || (optionalUnsupported && value.status === 'unsupported')) return false
  if (!safeBytes(value, MAX_IGNORE_FILE_BYTES)) fail()
  if (await reserveMetadata(value.bytes.byteLength) === false) fail()
  await writeFile(destination, value.bytes, { mode: 0o600, flag: 'wx' })
  return true
}

function parseIgnored(result, candidates) {
  if (!result || ![0, 1].includes(result.status) || !(result.stdout instanceof Uint8Array) ||
    result.stdout.byteLength > MAX_BATCH_BYTES) fail()
  let text
  try { text = decoder.decode(result.stdout) } catch { fail() }
  if (text && !text.endsWith('\0')) fail()
  const paths = text ? text.slice(0, -1).split('\0') : []
  const matched = new Set()
  for (const path of paths) {
    if (!path || !candidates.has(path) || matched.has(path)) fail()
    matched.add(path)
  }
  if ((result.status === 0) !== (matched.size > 0)) fail()
  return matched
}

/** Evaluate Git ignore rules using only bounded copied metadata and an empty
 * private worktree. No source working-tree content is materialized or given to
 * Git; candidates travel only on stdin to fixed check-ignore invocations. */
export async function readGitIgnoredPaths({
  root, common, metadata, worktree, staging, entries, load, runGit, signal, reserveMetadata,
  maxEntries = MAX_ENTRIES,
}) {
  if (!root || !common || !metadata || !worktree || !staging || typeof load !== 'function' ||
    typeof runGit !== 'function' || typeof reserveMetadata !== 'function' || signal?.aborted) fail()
  const check = () => { if (signal?.aborted) fail() }
  const admitted = checkedEntries(entries, maxEntries)
  const { directories, candidates } = structure(admitted)
  if (directories.size > MAX_DIRECTORIES) fail()

  const orderedDirectories = [...directories].sort((a, b) => {
    const depth = a.split('/').length - b.split('/').length
    return depth || (a < b ? -1 : a > b ? 1 : 0)
  })
  for (const directory of orderedDirectories) {
    check()
    await mkdir(join(worktree, directory), { mode: 0o700 })
  }

  // Leave a zero-byte structural placeholder for each leaf. A directory wins
  // on a cross-snapshot file/directory transition so nested candidates remain
  // addressable without ever reading their source contents.
  for (const { name, mode } of admitted) {
    check()
    if (DIRECTORY_MODES.has(mode) || directories.has(name)) continue
    if (name === '.gitignore' || name.endsWith('/.gitignore')) continue
    await writeFile(join(worktree, name), new Uint8Array(), { mode: 0o600, flag: 'wx' })
  }

  const orderedConfigDirs = ['', ...orderedDirectories]
  const copiedIgnoreFiles = new Set()
  for (const directory of orderedConfigDirs) {
    check()
    const name = directory ? `${directory}/.gitignore` : '.gitignore'
    const destination = join(worktree, name)
    // In a cross-snapshot file/directory transition a candidate may require
    // this path as a directory. A real source ignore file cannot be represented
    // at the same time, so fail closed rather than silently lose its rules.
    if (directories.has(name)) {
      const value = await load(root, name, MAX_IGNORE_FILE_BYTES)
      if (value.status === 'missing' || value.status === 'unsupported') continue
      if (!safeBytes(value, MAX_IGNORE_FILE_BYTES)) fail()
      fail()
    }
    if (await copyIgnoreFile({ base: root, name, destination, load, reserveMetadata, optionalUnsupported: true })) {
      copiedIgnoreFiles.add(name)
    }
  }
  for (const { name, mode } of admitted) {
    if ((name === '.gitignore' || name.endsWith('/.gitignore')) && !DIRECTORY_MODES.has(mode) &&
      !directories.has(name) && !copiedIgnoreFiles.has(name)) {
      await writeFile(join(worktree, name), new Uint8Array(), { mode: 0o600, flag: 'wx' })
    }
  }

  check()
  await mkdir(join(metadata, 'info'), { mode: 0o700, recursive: true })
  const excludesPath = join(metadata, 'info', 'exclude')
  await copyIgnoreFile({ base: common, name: 'info/exclude', destination: excludesPath,
    load, reserveMetadata, optionalUnsupported: false })

  const ignored = new Set()
  const orderedCandidates = [...candidates].sort()
  for (let start = 0; start < orderedCandidates.length;) {
    check()
    const batch = []
    let bytes = 0
    while (start < orderedCandidates.length) {
      const path = orderedCandidates[start]
      const size = Buffer.byteLength(path, 'utf8') + 1
      if (batch.length && bytes + size > MAX_BATCH_BYTES) break
      if (size > MAX_BATCH_BYTES) fail()
      batch.push(path)
      bytes += size
      start += 1
    }
    const input = Buffer.from(`${batch.join('\0')}\0`, 'utf8')
    const result = await runGit([
      `--git-dir=${metadata}`, `--work-tree=${worktree}`,
      'check-ignore', '--no-index', '-z', '--stdin', '--',
    ], { cwd: staging, signal, input })
    check()
    for (const path of parseIgnored(result, new Set(batch))) ignored.add(path)
  }
  return ignored
}
