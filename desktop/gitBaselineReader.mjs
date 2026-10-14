import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { isGitSnapshotPath, MAX_GIT_SNAPSHOT_ENTRIES, MAX_GIT_SNAPSHOT_FILE_BYTES } from '../contract/localGitSnapshot.mjs'
import { isLocalGitFileSelection, MAX_GIT_BROWSE_ENTRIES, MAX_GIT_BROWSE_PATH_BYTES } from '../contract/localGitBrowse.mjs'
import { readGitFile, listGitSharedIndexes } from './gitFileRead.mjs'
import { prepareGitIndex, parseGitIndexStages } from './gitIndex.mjs'
import { createLocalGitReader, isLocalGitRoot, runLocalGit } from './localGitReader.mjs'
import { withGitObjectReader } from './gitObjectReader.mjs'
import { resolveGitHead } from './gitHead.mjs'
import { readGitIgnoredPaths } from './gitIgnore.mjs'

const FAILURE = 'The Git baseline is unavailable, changed or exceeds its read limits.'
const fail = () => { throw new Error(FAILURE) }
const MAX_METADATA_BYTES = 16 * 1024 * 1024
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

/** Decode only directory structure. Git still owns loose/pack/delta decoding. */
export function parseGitTree(bytes, objectFormat, { maxEntries = MAX_GIT_SNAPSHOT_ENTRIES } = {}) {
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > MAX_GIT_BROWSE_ENTRIES) fail()
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > 1024 * 1024 || !['sha1', 'sha256'].includes(objectFormat)) fail()
  const data = Buffer.from(bytes)
  const width = objectFormat === 'sha1' ? 20 : 32
  const entries = []
  const names = new Set()
  let offset = 0
  while (offset < data.length) {
    const space = data.indexOf(0x20, offset)
    if (space < 0 || space - offset > 6) fail()
    const mode = data.toString('utf8', offset, space)
    if (!['40000', '040000', '100644', '100755', '120000', '160000'].includes(mode)) fail()
    const nul = data.indexOf(0, space + 1)
    if (nul < 0 || nul + 1 + width > data.length) fail()
    const name = decoder.decode(data.subarray(space + 1, nul))
    if (!isGitSnapshotPath(name) || name.includes('/') || names.has(name)) fail()
    names.add(name)
    const oid = data.subarray(nul + 1, nul + 1 + width).toString('hex')
    if (/^0+$/.test(oid)) fail()
    entries.push({ name, mode: mode === '40000' ? '040000' : mode, oid })
    if (entries.length > maxEntries) fail()
    offset = nul + 1 + width
  }
  return entries
}

async function readHeadTreeOid(head, objectFormat, readObject) {
  if (head.oid === null) return null
  const commit = Buffer.from(await readObject(head.oid, 'commit'))
  // Commit messages (and identity headers) may use a declared legacy encoding.
  // Only the structural ASCII tree header is needed; do not decode the message.
  const headerEnd = commit.indexOf('\n\n')
  const headers = commit.subarray(0, headerEnd).toString('latin1')
  const width = objectFormat === 'sha1' ? 40 : 64
  const tree = new RegExp(`^tree ([a-f0-9]{${width}})(?:\\n|$)`).exec(headers)?.[1]
  if (!tree || /^0+$/.test(tree) || headerEnd < 0 ||
    headers.split('\n').filter(line => line.startsWith('tree ')).length !== 1) fail()
  return tree
}

async function readHeadTree(head, objectFormat, readObject) {
  const tree = await readHeadTreeOid(head, objectFormat, readObject)
  if (tree === null) return []
  const entries = []
  let visited = 0
  async function visit(oid, prefix, ancestors) {
    if (ancestors.length >= 64 || ancestors.includes(oid) || ++visited > MAX_GIT_SNAPSHOT_ENTRIES) fail()
    const children = parseGitTree(await readObject(oid, 'tree'), objectFormat)
    for (const child of children) {
      const name = prefix + child.name
      if (!isGitSnapshotPath(name)) fail()
      if (child.mode === '040000') await visit(child.oid, `${name}/`, [...ancestors, oid])
      else {
        entries.push({ name, mode: child.mode, oid: child.oid })
        if (entries.length > MAX_GIT_SNAPSHOT_ENTRIES) fail()
      }
    }
  }
  await visit(tree, '', [])
  return entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
}

/** Resolve one exact HEAD path without recursively visiting sibling trees or
 * admitting their blobs. Per-object and aggregate object-reader limits still
 * apply; wider metadata here never widens the whole-repository capture. */
async function readHeadPath(head, objectFormat, readObject, path) {
  let oid = await readHeadTreeOid(head, objectFormat, readObject)
  if (oid === null) return null
  const components = path.split('/')
  const ancestors = new Set()
  for (let index = 0; index < components.length; index += 1) {
    if (index >= 64 || ancestors.has(oid)) fail()
    ancestors.add(oid)
    const entries = parseGitTree(await readObject(oid, 'tree'), objectFormat, { maxEntries: MAX_GIT_BROWSE_ENTRIES })
    const entry = entries.find(candidate => candidate.name === components[index])
    if (!entry) return null
    if (index === components.length - 1) {
      return { name: path, mode: entry.mode, oid: entry.oid }
    }
    if (entry.mode !== '040000') return null
    oid = entry.oid
  }
  return null
}

/** Internal baseline transaction for the later local-only review surface.
 * Its callback receives real HEAD/index identities and may request referenced
 * regular-file blobs. It must apply review exclusions and build, not publish,
 * its result; only this function's return has passed all source fences. */
export async function withLocalGitBaseline(root, options, callback) {
  return withBaseline(root, options, callback)
}

/** Internal prerequisite for explicit single-file comparison. Selection does
 * not authorize a directory, untracked file, sparse path or unrelated blob.
 * Nothing from this transaction is published until the same source fences as
 * whole-repository review have passed. */
export async function withLocalGitFileBaseline(root, path, options, callback) {
  if (!isLocalGitFileSelection({ path }) || path.split('/').length > 64) fail()
  return withBaseline(root, options, callback, path)
}

async function withBaseline(root, {
  gitExecutable, fileExecutable, signal: callerSignal, readFile = readGitFile,
  listSharedIndexes = listGitSharedIndexes,
  includeWorkingTree = false,
  runGit = (args, options) => runLocalGit(gitExecutable, args, options),
} = {}, callback, selectedPath) {
  const lifetime = new AbortController()
  const signal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(30_000), ...(callerSignal ? [callerSignal] : [])])
  const check = () => { if (signal.aborted) fail() }
  let staging
  try {
    check()
    const inspector = createLocalGitReader({ gitExecutable, fileExecutable, readFile, runGit })
    if (!isLocalGitRoot(root) || !isDeepStrictEqual(await inspector.inspectLocalGitRoot(root.path, { signal }), root)) fail()
    const git = { path: root.repository.path, identity: root.repository.identity }
    const common = { path: root.repository.commonPath, identity: root.repository.commonIdentity }
    const observations = new Map()
    const signature = (value) => [value.status === 'too-large' ? 'file' : value.status, value.sizeBytes, value.version]
    const load = async (base, name, maxBytes) => {
      check()
      const value = await readFile(base, name, { maxBytes, signal, executable: fileExecutable })
      const key = `${base.path}\0${name}`
      const previous = observations.get(key)
      if (previous && !isDeepStrictEqual(previous.signature, signature(value))) fail()
      observations.set(key, { base, name, signature: signature(value) })
      return value
    }
    let metadataBytes = 0
    const reserveMetadata = (size) => {
      if (!Number.isSafeInteger(size) || size < 0 || size > MAX_METADATA_BYTES - metadataBytes) fail()
      metadataBytes += size
    }
    const copyMetadata = async (base, name, destination, limit, optional = false) => {
      const value = await load(base, name, limit)
      if (optional && value.status === 'missing') return undefined
      if (value.status !== 'file' || !(value.bytes instanceof Uint8Array) || value.sizeBytes !== value.bytes.byteLength) fail()
      reserveMetadata(value.bytes.byteLength)
      await writeFile(destination, value.bytes, { mode: 0o600, flag: 'wx' })
      return value.bytes
    }
    staging = await mkdtemp(join(tmpdir(), 'agent-commons-git-baseline-'))
    const metadata = join(staging, 'metadata')
    const worktree = join(staging, 'worktree')
    await mkdir(join(metadata, 'objects'), { recursive: true, mode: 0o700 })
    await mkdir(join(metadata, 'refs'), { mode: 0o700 })
    await mkdir(worktree, { mode: 0o700 })
    await writeFile(join(metadata, 'HEAD'), 'ref: refs/heads/main\n', { mode: 0o600, flag: 'wx' })
    const objectFormat = await prepareGitIndex({ git, common, metadata, staging, load, copyMetadata,
      listSharedIndexes, fileExecutable, runGit, signal })
    const tagged = includeWorkingTree || selectedPath !== undefined
    const result = await runGit([`--git-dir=${metadata}`, `--work-tree=${worktree}`, 'ls-files',
      ...(tagged ? ['-t'] : []), '--cached', '--stage', '--sparse', '-z', '--full-name', '--'], { cwd: staging, signal })
    if (result.status !== 0) fail()
    const completeIndex = parseGitIndexStages(result.stdout, { tagged,
      maxEntries: selectedPath === undefined ? MAX_GIT_SNAPSHOT_ENTRIES : MAX_GIT_BROWSE_ENTRIES })
    let selection
    if (selectedPath !== undefined) {
      const names = new Set(completeIndex.map(entry => entry.name))
      let pathBytes = 0
      for (const name of names) {
        if (!isLocalGitFileSelection({ path: name })) fail()
        pathBytes += Buffer.byteLength(name, 'utf8')
        if (pathBytes > MAX_GIT_BROWSE_PATH_BYTES) fail()
      }
      selection = Object.freeze({ path: selectedPath, sparse: completeIndex.some(entry =>
        (entry.mode === '040000' || entry.skipWorktree) &&
        (selectedPath === entry.name || selectedPath.startsWith(`${entry.name}/`))) })
    }
    const indexEntries = selection ? completeIndex.filter(entry => entry.name === selectedPath) : completeIndex
    const head = await resolveGitHead({ git, common, objectFormat, load })
    const output = await withGitObjectReader(common, { objectFormat, fileExecutable, runGit, signal, readFile }, async ({ readObject, probeObject }) => {
      const selectedHead = selection ? await readHeadPath(head, objectFormat, readObject, selectedPath) : null
      const headEntries = selection
        ? (selectedHead && selectedHead.mode !== '040000' ? [selectedHead] : [])
        : await readHeadTree(head, objectFormat, readObject)
      const paths = new Set([...headEntries, ...indexEntries].map(entry => entry.name))
      if (paths.size > MAX_GIT_SNAPSHOT_ENTRIES) fail()
      const ignoreCandidates = new Map()
      for (const entry of [...headEntries, ...indexEntries]) {
        if (!ignoreCandidates.has(entry.name) || ['040000', '160000'].includes(entry.mode)) {
          ignoreCandidates.set(entry.name, { name: entry.name, mode: entry.mode })
        }
      }
      // Whole review's HEAD/index union keeps directories on file/directory
      // transitions. Preserve that shape only for ignore matching, without
      // traversing the HEAD subtree or admitting any descendant content.
      if (selection && (selectedHead?.mode === '040000' ||
        completeIndex.some(entry => entry.name.startsWith(`${selectedPath}/`)))) {
        ignoreCandidates.set(selectedPath, { name: selectedPath, mode: '040000' })
      }
      const ignoredPaths = includeWorkingTree || selection ? await readGitIgnoredPaths({ root, common, metadata, worktree, staging,
        entries: [...ignoreCandidates.values()], load, runGit, signal, reserveMetadata }) : new Set()
      const unavailable = selection && (selection.sparse || indexEntries.some(entry => entry.stage !== 0))
      const admittedBlobs = new Set((unavailable ? [] : [...headEntries, ...indexEntries])
        .filter(entry => !ignoredPaths.has(entry.name) && ['100644', '100755'].includes(entry.mode)).map(entry => entry.oid))
      const workingPaths = new Set((unavailable ? [] : indexEntries).filter(entry => entry.stage === 0 && !entry.skipWorktree &&
        !ignoredPaths.has(entry.name) && ['100644', '100755'].includes(entry.mode)).map(entry => entry.name))
      let refused = false
      let workingOpen = true
      let workingQueue = Promise.resolve()
      const readWorkingFile = (name, maxBytes = MAX_GIT_SNAPSHOT_FILE_BYTES) => {
        const admitted = workingOpen && includeWorkingTree && workingPaths.has(name) &&
          (maxBytes === null || (Number.isSafeInteger(maxBytes) && maxBytes >= 0 && maxBytes <= MAX_GIT_SNAPSHOT_FILE_BYTES))
        const result = workingQueue.then(() => {
          if (!admitted) fail()
          return load(root, name, maxBytes)
        }).catch(() => { refused = true; fail() })
        workingQueue = result.then(() => {}, () => {})
        return result
      }
      const readBlob = (oid, maxBytes = MAX_GIT_SNAPSHOT_FILE_BYTES) => {
        if (!admittedBlobs.has(oid) || !Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > MAX_GIT_SNAPSHOT_FILE_BYTES) {
          refused = true
          return Promise.reject(new Error(FAILURE))
        }
        return readObject(oid, 'blob', maxBytes)
      }
      // Header metadata is only an unverified omission/allocation hint. A caller
      // must use readBlob before treating any content as hash-verified evidence.
      const probeBlob = async (oid) => {
        if (!admittedBlobs.has(oid)) { refused = true; fail() }
        const info = await probeObject(oid)
        if (info.typeHint !== 'blob') { refused = true; fail() }
        return { sizeHintBytes: info.sizeHintBytes, contentVerified: false }
      }
      let value
      try {
        value = await callback(Object.freeze({ objectFormat, head: Object.freeze({ ...head }),
          ...(selection ? { selection } : {}),
          headEntries: Object.freeze(headEntries.map(entry => Object.freeze(entry))),
          indexEntries: Object.freeze(indexEntries.map(entry => Object.freeze(entry))), readBlob, probeBlob,
          ...(includeWorkingTree || selection ? { ignoredPaths: Object.freeze([...ignoredPaths]) } : {}),
          ...(includeWorkingTree ? { readWorkingFile } : {}) }))
      } finally {
        workingOpen = false
        await workingQueue
      }
      if (refused) fail()
      return value
    })
    for (const observation of observations.values()) {
      check()
      const current = await readFile(observation.base, observation.name, { maxBytes: null, signal, executable: fileExecutable })
      if (!isDeepStrictEqual(observation.signature, signature(current))) fail()
    }
    if (!isDeepStrictEqual(await inspector.inspectLocalGitRoot(root.path, { signal }), root)) fail()
    check()
    return output
  } catch { fail() }
  finally {
    lifetime.abort()
    if (staging) await rm(staging, { recursive: true, force: true })
  }
}
