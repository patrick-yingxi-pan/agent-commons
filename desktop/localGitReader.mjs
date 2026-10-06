import { spawn } from 'node:child_process'
import { lstat, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { MAX_GIT_SNAPSHOT_FILE_BYTES, snapshotGitFiles } from '../contract/localGitSnapshot.mjs'
import { bundledGitProbeEnvironment } from './bundledGit.mjs'
import { parseGitIndexStages, prepareGitIndex } from './gitIndex.mjs'
import { readGitFile, listGitSharedIndexes } from './gitFileRead.mjs'
import { inspectLocalFolderRoot } from './localFolderReader.mjs'

export { parseGitIndexStages } from './gitIndex.mjs'

const FAILURE = 'The repository is unavailable or has changed. Your saved snapshots have not been changed.'
const MAX_METADATA_BYTES = 16 * 1024 * 1024
const fail = () => { throw new Error(FAILURE) }
const identityOf = (info) => ({ dev: String(info.dev), ino: String(info.ino) })
const checkSignal = (signal) => { if (signal?.aborted) fail() }

export function localGitCommandEnvironment() {
  return { ...bundledGitProbeEnvironment(), GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' }
}

/** Only fixed commands against generated private metadata are admitted by the
 * caller. In particular, ls-files must never touch a user's split index: Git
 * freshens the shared index's mtime even when optional locks are disabled. */
export function runLocalGit(executable, args, { cwd, signal, input } = {}) {
  return new Promise((resolveResult, reject) => {
    if (!isAbsolute(executable ?? '') || !isAbsolute(cwd ?? '') || signal?.aborted ||
      (input !== undefined && (!(input instanceof Uint8Array) || input.byteLength > 128 * 1024))) return reject(new Error(FAILURE))
    const child = spawn(executable, ['--no-pager', '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null',
      '-c', 'core.untrackedCache=false', '-c', 'core.excludesFile=/dev/null', ...args], {
      cwd, env: localGitCommandEnvironment(), detached: true, stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    })
    const chunks = []
    let bytes = 0
    let stderrBytes = 0
    let stopped = false
    const stop = () => {
      stopped = true
      if (child.pid) { try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') } }
    }
    signal?.addEventListener('abort', stop, { once: true })
    if (signal?.aborted) stop()
    const timer = setTimeout(stop, 10_000)
    child.stdout.on('data', (chunk) => { bytes += chunk.length; if (bytes > 2 * 1024 * 1024) stop(); else chunks.push(chunk) })
    child.stderr.on('data', (chunk) => { stderrBytes += chunk.length; if (stderrBytes > 64 * 1024) stop() })
    if (child.stdin) { child.stdin.on('error', () => {}); child.stdin.end(input) }
    const clean = () => { clearTimeout(timer); signal?.removeEventListener('abort', stop) }
    child.once('error', () => { clean(); reject(new Error(FAILURE)) })
    child.once('close', (status, exitSignal) => {
      clean()
      if (stopped || exitSignal || status === null) reject(new Error(FAILURE))
      else resolveResult({ status, stdout: Buffer.concat(chunks) })
    })
  })
}

export function parseGitIndexEntries(bytes) {
  const entries = new Map()
  for (const entry of parseGitIndexStages(bytes)) {
    const previous = entries.get(entry.name)
    entries.set(entry.name, { name: entry.name, mode: previous && previous.mode !== entry.mode ? 'mixed' : entry.mode })
  }
  return [...entries.values()].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
}

function pointer(bytes, prefix = '') {
  const value = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  if (!value.startsWith(prefix)) fail()
  const path = value.slice(prefix.length).replace(/\r?\n$/, '')
  if (!path || /[\x00-\x1f\x7f]/.test(path) || Buffer.byteLength(path) > 4096) fail()
  return path
}

const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === [...keys].sort().join(',')
const validIdentity = (value) => exactKeys(value, ['dev', 'ino']) && [value.dev, value.ino].every(n => typeof n === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(n))
const validPath = (value) => typeof value === 'string' && isAbsolute(value) && resolve(value) === value && Buffer.byteLength(value) <= 4096 && !/[\x00-\x1f\x7f]/.test(value)

/** This private record is encrypted by the connection store, never portable. */
export function isLocalGitRoot(value) {
  if (!exactKeys(value, ['path', 'identity', 'repository']) || !validPath(value.path) || !validIdentity(value.identity)) return false
  const repo = value.repository
  return exactKeys(repo, ['path', 'identity', 'commonPath', 'commonIdentity', 'marker']) && validPath(repo.path) &&
    validPath(repo.commonPath) && validIdentity(repo.identity) && validIdentity(repo.commonIdentity) &&
    (repo.marker === null || validIdentity(repo.marker))
}

export function createLocalGitReader({ gitExecutable, fileExecutable, readFile = readGitFile, listSharedIndexes = listGitSharedIndexes,
  runGit = (args, options) => runLocalGit(gitExecutable, args, options) } = {}) {
  const read = (root, name, maxBytes, signal) => readFile(root, name, { maxBytes, signal, executable: fileExecutable })

  async function inspectLocalGitRoot(selectedPath, { signal } = {}) {
    try {
      checkSignal(signal)
      const root = await inspectLocalFolderRoot(selectedPath)
      const marker = await lstat(join(root.path, '.git'), { bigint: true })
      let gitPath
      if (marker.isDirectory() && !marker.isSymbolicLink()) gitPath = join(root.path, '.git')
      else if (marker.isFile() && !marker.isSymbolicLink()) {
        const file = await read(root, '.git', 4096, signal)
        if (file.status !== 'file' || !file.bytes) fail()
        gitPath = resolve(root.path, pointer(file.bytes, 'gitdir: '))
      } else fail()
      const git = await inspectLocalFolderRoot(gitPath)
      const commonPointer = await read(git, 'commondir', 4096, signal)
      let common = git
      if (commonPointer.status === 'file' && commonPointer.bytes) {
        common = await inspectLocalFolderRoot(resolve(git.path, pointer(commonPointer.bytes)))
        // A linked worktree's private metadata must point back to this exact
        // selected root, not redirect an unrelated repository connection.
        if (resolve(git.path, '..', '..') !== common.path || basename(resolve(git.path, '..')) !== 'worktrees') fail()
        const backlink = await read(git, 'gitdir', 4096, signal)
        if (backlink.status !== 'file' || !backlink.bytes || resolve(git.path, pointer(backlink.bytes)) !== join(root.path, '.git')) fail()
      } else if (commonPointer.status !== 'missing') fail()
      const head = await read(git, 'HEAD', 4096, signal)
      if (head.status !== 'file' || !head.bytes?.length) fail()
      const pinned = { ...root, repository: { ...git, commonPath: common.path, commonIdentity: common.identity,
        marker: marker.isFile() ? identityOf(marker) : null } }
      if (!isLocalGitRoot(pinned)) fail()
      return pinned
    } catch { fail() }
  }

  async function readLocalGitSnapshot(root, { signal: callerSignal } = {}) {
    const signal = AbortSignal.any([AbortSignal.timeout(30_000), ...(callerSignal ? [callerSignal] : [])])
    let staging
    try {
      checkSignal(signal)
      if (!isLocalGitRoot(root) || !isDeepStrictEqual(await inspectLocalGitRoot(root.path, { signal }), root)) fail()
      staging = await mkdtemp(join(tmpdir(), 'agent-commons-git-capture-'))
      const metadata = join(staging, 'metadata')
      const worktree = join(staging, 'worktree')
      await mkdir(join(metadata, 'objects'), { recursive: true, mode: 0o700 })
      await mkdir(join(metadata, 'refs'), { mode: 0o700 })
      await mkdir(worktree, { mode: 0o700 })
      await writeFile(join(metadata, 'HEAD'), 'ref: refs/heads/main\n', { mode: 0o600 })
      const observed = new Map()
      let metadataBytes = 0
      const signature = (value) => [value.status === 'too-large' ? 'file' : value.status, value.sizeBytes, value.version]
      const load = async (base, name, maxBytes) => {
        checkSignal(signal)
        const value = await read(base, name, maxBytes, signal)
        const key = `${base.path}\0${name}`
        if (observed.has(key) && !isDeepStrictEqual(observed.get(key).signature, signature(value))) fail()
        observed.set(key, { base, name, signature: signature(value) })
        return value
      }
      const copyMetadata = async (base, name, destination, limit, optional = false) => {
        const value = await load(base, name, limit)
        if (optional && value.status === 'missing') return undefined
        if (value.status !== 'file' || !(value.bytes instanceof Uint8Array)) fail()
        metadataBytes += value.bytes.byteLength
        if (metadataBytes > MAX_METADATA_BYTES) fail()
        await writeFile(destination, value.bytes, { mode: 0o600 })
        return value.bytes
      }
      const git = { path: root.repository.path, identity: root.repository.identity }
      const common = { path: root.repository.commonPath, identity: root.repository.commonIdentity }
      const objectFormat = await prepareGitIndex({
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
      })
      const list = async (ignored = false) => {
        const result = await runGit([`--git-dir=${metadata}`, `--work-tree=${worktree}`, 'ls-files', '--cached', '--stage', '--sparse', '-z', '--full-name',
          ...(ignored ? ['--ignored', '--exclude-standard'] : []), '--'], { cwd: staging, signal })
        if (result.status !== 0) fail()
        return parseGitIndexEntries(result.stdout)
      }
      const entries = await list()
      const directories = new Set([''])
      for (const entry of entries) {
        const parts = entry.name.split('/')
        for (let i = 1; i < parts.length; i++) directories.add(parts.slice(0, i).join('/'))
        if (['160000', '040000'].includes(entry.mode)) directories.add(entry.name)
      }
      for (const directory of [...directories].sort()) if (directory) await mkdir(join(worktree, directory), { recursive: true, mode: 0o700 })
      for (const entry of entries) if (!['160000', '040000'].includes(entry.mode)) await writeFile(join(worktree, entry.name), '', { mode: 0o600, flag: 'wx' })
      // Ignore evaluation also stays private: copy only the bounded ignore
      // metadata for indexed paths. Git never sees the source working tree.
      for (const directory of directories) {
        const name = directory ? `${directory}/.gitignore` : '.gitignore'
        const value = await load(root, name, 64 * 1024)
        if (value.status === 'missing' || value.status === 'unsupported') continue
        if (value.status !== 'file' || !value.bytes) fail()
        metadataBytes += value.bytes.length
        if (metadataBytes > MAX_METADATA_BYTES) fail()
        await writeFile(join(worktree, name), value.bytes, { mode: 0o600 })
      }
      await mkdir(join(metadata, 'info'), { mode: 0o700 })
      const excludes = await load(common, 'info/exclude', 64 * 1024)
      if (excludes.status === 'file' && excludes.bytes) await writeFile(join(metadata, 'info', 'exclude'), excludes.bytes, { mode: 0o600 })
      else if (excludes.status !== 'missing') fail()
      const ignored = new Set((await list(true)).map(entry => entry.name))
      const files = []
      const omissions = []
      for (const entry of entries) {
        if (ignored.has(entry.name)) continue
        if (!['100644', '100755'].includes(entry.mode)) {
          omissions.push({ path: entry.name, sizeBytes: 0, snapshot: { omitted: 'unsupported' } })
          continue
        }
        const value = await load(root, entry.name, null)
        if (value.status !== 'file') {
          omissions.push({ path: entry.name, sizeBytes: 0, snapshot: { omitted: value.status === 'unsupported' ? 'unsupported' : 'unreadable' } })
        } else files.push({ path: entry.name, sizeBytes: value.sizeBytes })
      }
      let changed = false
      const snapshots = await snapshotGitFiles(files, async (file) => {
        try {
          const value = await load(root, file.path, MAX_GIT_SNAPSHOT_FILE_BYTES)
          if (value.status !== 'file' || !value.bytes) fail()
          return value.bytes
        } catch { changed = true; fail() }
      })
      if (changed) fail()
      for (const observation of observed.values()) {
        checkSignal(signal)
        const current = await read(observation.base, observation.name, null, signal)
        if (!isDeepStrictEqual(observation.signature, signature(current))) fail()
      }
      if (!isDeepStrictEqual(await inspectLocalGitRoot(root.path, { signal }), root)) fail()
      checkSignal(signal)
      return { name: basename(root.path), files: [...snapshots, ...omissions].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0) }
    } catch { fail() }
    finally { if (staging) await rm(staging, { recursive: true, force: true }) }
  }
  return { inspectLocalGitRoot, readLocalGitSnapshot }
}
