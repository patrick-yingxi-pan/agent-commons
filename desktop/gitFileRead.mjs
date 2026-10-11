import { spawn } from 'node:child_process'
import { isAbsolute } from 'node:path'
import { gitFileExecutable } from './gitFilePaths.mjs'
import {
  isFolderTreePath, MAX_FOLDER_TREE_DEPTH, MAX_FOLDER_TREE_DIRECTORIES,
  MAX_FOLDER_TREE_ENTRIES, MAX_FOLDER_TREE_PATH_BYTES,
} from '../contract/localFolderTree.mjs'

export { gitFileExecutable } from './gitFilePaths.mjs'

export const MAX_GIT_FILE_BYTES = 16 * 1024 * 1024
const MAX_PATH_BYTES = 64 * 1024
const MAX_OUTPUT_HEADER_BYTES = 512
const MAX_LIST_OUTPUT_BYTES = 8 * 1024
const READ_TIMEOUT_MS = 10_000

function validRelativePath(relativePath) {
  if (typeof relativePath !== 'string' || relativePath.length === 0 || Buffer.byteLength(relativePath, 'utf8') > MAX_PATH_BYTES) return false
  if (relativePath.startsWith('/') || relativePath.includes('\\')) return false
  if ([...relativePath].some((character) => {
    const code = character.codePointAt(0)
    return code <= 0x1f || code === 0x7f
  })) return false
  const components = relativePath.split('/')
  return components.length <= 256 && components.every((component) => component && component !== '.' && component !== '..')
}

function validRoot(root) {
  return root && typeof root.path === 'string' && isAbsolute(root.path) &&
    root.identity && typeof root.identity.dev === 'string' && /^\d+$/.test(root.identity.dev) &&
    typeof root.identity.ino === 'string' && /^\d+$/.test(root.identity.ino)
}

function genericChangedError() {
  return new Error('The Git source changed during capture.')
}

function parseResult(output, maxBytes) {
  const newline = output.indexOf(0x0a)
  if (newline < 0 || newline > MAX_OUTPUT_HEADER_BYTES) throw new Error('The Git file helper returned an invalid response.')
  const header = output.subarray(0, newline).toString('ascii')
  const payload = output.subarray(newline + 1)
  if (header === 'M' || header === 'U' || header === 'R' || header === 'C') {
    if (payload.length !== 0) throw new Error('The Git file helper returned an invalid response.')
    if (header === 'M') return { status: 'missing' }
    if (header === 'U') return { status: 'unsupported' }
    if (header === 'R') return { status: 'unreadable' }
    throw genericChangedError()
  }
  const file = /^F (0|[1-9]\d*) ([0-9]+:[0-9]+:[0-9]+:-?\d+:-?\d+:-?\d+:-?\d+:-?\d+)$/.exec(header)
  const oversized = /^T (0|[1-9]\d*) ([0-9]+:[0-9]+:[0-9]+:-?\d+:-?\d+:-?\d+:-?\d+:-?\d+)$/.exec(header)
  if (oversized) {
    if (payload.length !== 0) throw new Error('The Git file helper returned an invalid response.')
    const sizeBytes = Number(oversized[1])
    return Number.isSafeInteger(sizeBytes) ? { status: 'too-large', sizeBytes, version: oversized[2] } : { status: 'unreadable' }
  }
  if (!file) throw new Error('The Git file helper returned an invalid response.')
  const sizeBytes = Number(file[1])
  if (!Number.isSafeInteger(sizeBytes) || payload.length !== (maxBytes === null ? 0 : sizeBytes)) {
    throw new Error('The Git file helper returned an invalid response.')
  }
  if (maxBytes !== null && sizeBytes > maxBytes) throw new Error('The Git file helper returned an invalid response.')
  return {
    status: 'file',
    sizeBytes,
    version: file[2],
    ...(maxBytes === null ? {} : { bytes: new Uint8Array(payload) }),
  }
}

function terminateGroup(child) {
  if (!child.pid) return
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    child.kill('SIGKILL')
  }
}

function runHelper(executable, args, { signal, outputLimit }) {
  if (signal?.aborted) return Promise.reject(new Error('The Git file read was cancelled.'))
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: '/',
      detached: true,
      env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' },
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    })
    const chunks = []
    let outputLength = 0
    let settled = false
    const cleanup = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
    const finishError = (error) => {
      if (settled) return
      settled = true
      cleanup()
      terminateGroup(child)
      reject(error)
    }
    const onAbort = () => finishError(new Error('The Git file read was cancelled.'))
    const timer = setTimeout(() => finishError(new Error('The Git file read exceeded its time limit.')), READ_TIMEOUT_MS)
    child.once('error', () => finishError(new Error('The Git file helper could not be started.')))
    child.stdout.on('data', (chunk) => {
      if (settled) return
      outputLength += chunk.length
      if (outputLength > outputLimit) {
        finishError(new Error('The Git file helper exceeded its output limit.'))
        return
      }
      chunks.push(chunk)
    })
    child.once('close', (code, childSignal) => {
      if (settled) return
      settled = true
      cleanup()
      if (code !== 0 || childSignal) {
        reject(new Error('The Git file helper did not complete successfully.'))
        return
      }
      resolve(Buffer.concat(chunks))
    })
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) onAbort()
  })
}

/** Bounded metadata-only enumeration. Descriptors and paths stay native; this
 * internal result is never the renderer snapshot or reusable read authority. */
export async function listLocalFolderTree(root, { signal, executable = gitFileExecutable() } = {}) {
  const invalid = () => new Error('The folder helper returned an invalid tree.')
  if (!validRoot(root) || typeof executable !== 'string' || !isAbsolute(executable)) throw invalid()
  const output = await runHelper(executable, ['--list-folder-tree', root.path, root.identity.dev, root.identity.ino], {
    signal, outputLimit: MAX_OUTPUT_HEADER_BYTES + MAX_FOLDER_TREE_ENTRIES * (MAX_FOLDER_TREE_PATH_BYTES + MAX_OUTPUT_HEADER_BYTES),
  })
  if (output.equals(Buffer.from('C\n'))) throw new Error('The folder source changed during capture or exceeded its traversal limits.')
  let text
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(output) } catch { throw invalid() }
  const lines = text.split('\n')
  if (lines.pop() !== '') throw invalid()
  const versionPattern = '[0-9]+:[0-9]+:[0-9]+:-?\\d+:-?\\d+:-?\\d+:-?\\d+:-?\\d+'
  const header = new RegExp(`^D (0|[1-9]\\d*) (0|[1-9]\\d*) (0|[1-9]\\d*) (${versionPattern})$`).exec(lines.shift() ?? '')
  if (!header) throw invalid()
  const count = Number(header[1]), visited = Number(header[2]), directoryCount = Number(header[3])
  if (!Number.isSafeInteger(visited) || visited > MAX_FOLDER_TREE_ENTRIES || count > visited || count !== lines.length ||
      directoryCount > MAX_FOLDER_TREE_DIRECTORIES || directoryCount > count) throw invalid()
  const names = new Set(), directories = new Set(), entries = []
  const entryPattern = new RegExp(`^([FDU]) (0|[1-9]\\d*) (${versionPattern})\\t(.+)$`)
  for (const line of lines) {
    const record = entryPattern.exec(line)
    if (!record) throw invalid()
    const [, kind, size, version, name] = record
    const sizeBytes = Number(size)
    if (!isFolderTreePath(name) || names.has(name) || !Number.isSafeInteger(sizeBytes) ||
        (kind === 'D' && name.split('/').length > MAX_FOLDER_TREE_DEPTH)) throw invalid()
    names.add(name)
    if (kind === 'D') directories.add(name)
    entries.push({ kind, name, sizeBytes, version })
  }
  if (directories.size !== directoryCount) throw invalid()
  for (const entry of entries) {
    const parent = entry.name.slice(0, entry.name.lastIndexOf('/'))
    if (entry.name.includes('/') && !directories.has(parent)) throw invalid()
  }
  entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
  return { rootVersion: header[4], visited, directoryCount, entries }
}

/** Read one regular file beneath a pinned directory without following path symlinks. */
export async function readGitFile(root, relativePath, {
  maxBytes = MAX_GIT_FILE_BYTES,
  signal,
  executable = gitFileExecutable(),
} = {}) {
  if (!validRoot(root)) throw new Error('The Git source root identity is invalid.')
  if (!validRelativePath(relativePath)) return { status: 'unsupported' }
  if (maxBytes !== null && (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > MAX_GIT_FILE_BYTES)) {
    throw new Error(`Git file reads are limited to ${MAX_GIT_FILE_BYTES} bytes.`)
  }
  if (typeof executable !== 'string' || !isAbsolute(executable)) {
    throw new Error('The macOS Git file helper is unavailable.')
  }
  const output = await runHelper(executable, [
      root.path,
      root.identity.dev,
      root.identity.ino,
      relativePath,
      maxBytes === null ? 'meta' : String(maxBytes),
    ], { signal, outputLimit: MAX_OUTPUT_HEADER_BYTES + (maxBytes ?? 0) + 1 })
  return parseResult(output, maxBytes)
}

const OBJECT_PATH = /^objects\/(?:[a-f0-9]{2}\/(?:[a-f0-9]{38}|[a-f0-9]{62})|pack\/pack-(?:[a-f0-9]{40}|[a-f0-9]{64})\.(?:pack|idx))$/

/** Internal object-store primitive, not renderer authority. The complete source
 * version accompanies every exact bounded slice so callers can fence multiple
 * reads. A range crossing EOF is never silently shortened. */
export async function readGitFileRange(root, relativePath, {
  offset, length, signal, executable = gitFileExecutable(),
} = {}) {
  if (!validRoot(root)) throw new Error('The Git source root identity is invalid.')
  if (typeof relativePath !== 'string' || !OBJECT_PATH.test(relativePath)) return { status: 'unsupported' }
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 1 ||
    length > MAX_GIT_FILE_BYTES || !Number.isSafeInteger(offset + length)) {
    throw new Error('The Git object range is invalid or exceeds its byte limit.')
  }
  if (typeof executable !== 'string' || !isAbsolute(executable)) throw new Error('The macOS Git file helper is unavailable.')
  const output = await runHelper(executable, [
    '--read-range', root.path, root.identity.dev, root.identity.ino, relativePath, String(offset), String(length),
  ], { signal, outputLimit: MAX_OUTPUT_HEADER_BYTES + length + 1 })
  const newline = output.indexOf(0x0a)
  if (newline < 0 || newline > MAX_OUTPUT_HEADER_BYTES) throw new Error('The Git file helper returned an invalid range.')
  const header = output.subarray(0, newline).toString('utf8')
  const payload = output.subarray(newline + 1)
  if (['M', 'U', 'R', 'C'].includes(header)) return parseResult(output, 0)
  const outside = /^E (0|[1-9]\d*) ([0-9]+:[0-9]+:[0-9]+:-?\d+:-?\d+:-?\d+:-?\d+:-?\d+)$/.exec(header)
  if (outside) {
    const sizeBytes = Number(outside[1])
    if (payload.length || !Number.isSafeInteger(sizeBytes) || offset + length <= sizeBytes) {
      throw new Error('The Git file helper returned an invalid range.')
    }
    return { status: 'out-of-range', sizeBytes, version: outside[2] }
  }
  const match = /^B (0|[1-9]\d*) (0|[1-9]\d*) (0|[1-9]\d*) ([0-9]+:[0-9]+:[0-9]+:-?\d+:-?\d+:-?\d+:-?\d+:-?\d+)$/.exec(header)
  const sizeBytes = Number(match?.[1])
  if (!match || !Number.isSafeInteger(sizeBytes) || offset + length > sizeBytes || Number(match[2]) !== offset ||
    Number(match[3]) !== length || payload.length !== length) throw new Error('The Git file helper returned an invalid range.')
  return { status: 'file', sizeBytes, version: match[4], offset, bytes: new Uint8Array(payload) }
}

async function listMetadataNames(root, command, pattern, { signal, executable = gitFileExecutable() } = {}) {
  if (!validRoot(root)) throw new Error('The Git source root identity is invalid.')
  if (typeof executable !== 'string' || !isAbsolute(executable)) {
    throw new Error('The macOS Git file helper is unavailable.')
  }
  const output = await runHelper(executable, [
    command, root.path, root.identity.dev, root.identity.ino,
  ], { signal, outputLimit: MAX_LIST_OUTPUT_BYTES })
  const text = output.toString('utf8')
  if (text === 'C\n') throw genericChangedError()
  if (text === 'R\n') throw new Error('The Git source metadata is unreadable.')
  if (command === '--list-pack-indexes' && text === 'M\n') return []
  const lines = text.split('\n')
  if (!text.endsWith('\n') || !/^L (0|[1-9]\d*)$/.test(lines[0] ?? '')) {
    throw new Error('The Git file helper returned an invalid directory listing.')
  }
  const count = Number(lines[0].slice(2))
  const names = lines.slice(1, -1)
  if (!Number.isSafeInteger(count) || count > 64 || names.length !== count ||
    names.some((name) => !pattern.test(name)) ||
    new Set(names).size !== names.length) {
    throw new Error('The Git file helper returned an invalid directory listing.')
  }
  return names.sort()
}

/** List only exact Git shared-index filenames in a pinned metadata directory. */
export function listGitSharedIndexes(root, options) {
  return listMetadataNames(root, '--list-shared-indexes', /^sharedindex\.(?:[a-f0-9]{40}|[a-f0-9]{64})$/, options)
}

/** Internal fixed-depth discovery; alternates, config and unrelated files are
 * not opened. Object reads still require their own pinned version checks. */
export function listGitPackIndexes(root, options) {
  return listMetadataNames(root, '--list-pack-indexes', /^pack-(?:[a-f0-9]{40}|[a-f0-9]{64})\.idx$/, options)
}
