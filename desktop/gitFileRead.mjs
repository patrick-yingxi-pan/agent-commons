import { spawn } from 'node:child_process'
import { isAbsolute } from 'node:path'
import { gitFileExecutable } from './gitFilePaths.mjs'

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

/** List only exact Git shared-index filenames in a pinned metadata directory. */
export async function listGitSharedIndexes(root, { signal, executable = gitFileExecutable() } = {}) {
  if (!validRoot(root)) throw new Error('The Git source root identity is invalid.')
  if (typeof executable !== 'string' || !isAbsolute(executable)) {
    throw new Error('The macOS Git file helper is unavailable.')
  }
  const output = await runHelper(executable, [
    '--list-shared-indexes', root.path, root.identity.dev, root.identity.ino,
  ], { signal, outputLimit: MAX_LIST_OUTPUT_BYTES })
  const text = output.toString('ascii')
  if (text === 'C\n') throw genericChangedError()
  if (text === 'R\n') throw new Error('The Git source metadata is unreadable.')
  const lines = text.split('\n')
  if (!text.endsWith('\n') || !/^L (0|[1-9]\d*)$/.test(lines[0] ?? '')) {
    throw new Error('The Git file helper returned an invalid directory listing.')
  }
  const count = Number(lines[0].slice(2))
  const names = lines.slice(1, -1)
  if (!Number.isSafeInteger(count) || count > 64 || names.length !== count ||
    names.some((name) => !/^sharedindex\.(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(name)) ||
    new Set(names).size !== names.length) {
    throw new Error('The Git file helper returned an invalid directory listing.')
  }
  return names.sort()
}
