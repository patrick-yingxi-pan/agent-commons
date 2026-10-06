import { spawn } from 'node:child_process'
import { isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const IMAGE_OCR_MAX_INPUT_BYTES = 3 * 1024 * 1024
export const IMAGE_OCR_MAX_EDGE = 2_000
export const IMAGE_OCR_MAX_TEXT_BYTES = 64 * 1024
export const IMAGE_OCR_MAX_OUTPUT_BYTES = IMAGE_OCR_MAX_TEXT_BYTES * 6 + 128
export const IMAGE_OCR_TIMEOUT_MS = 30_000
export const IMAGE_OCR_CAPACITY = 2
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const FAILURE_STATUSES = new Set(['no-text', 'invalid', 'too-large', 'unavailable'])

export function imageOcrExecutable({ packaged = false, resourcesPath, targetPlatform = process.platform } = {}) {
  if (targetPlatform !== 'darwin') return null
  return packaged ? join(resourcesPath, 'agent-commons-image-ocr')
    : fileURLToPath(new URL('./bin/agent-commons-image-ocr', import.meta.url))
}

/** The helper independently performs complete ImageIO admission. This cheap
 * preflight bounds IPC-sized allocations before any process is started. */
function snapshotInput(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.buffer instanceof SharedArrayBuffer) return { status: 'invalid' }
  if (bytes.byteLength > IMAGE_OCR_MAX_INPUT_BYTES) return { status: 'too-large' }
  if (bytes.byteLength < 33) return { status: 'invalid' }
  const input = Buffer.from(bytes)
  if (!input.subarray(0, 8).equals(PNG_SIGNATURE) || input.readUInt32BE(8) !== 13 ||
      input.toString('ascii', 12, 16) !== 'IHDR') return { status: 'invalid' }
  const width = input.readUInt32BE(16)
  const height = input.readUInt32BE(20)
  if (!width || !height) return { status: 'invalid' }
  if (width > IMAGE_OCR_MAX_EDGE || height > IMAGE_OCR_MAX_EDGE) return { status: 'too-large' }
  return input
}

/** A closed, path-free publication; malformed/native diagnostics never become
 * editable text. Whole output is required, including valid UTF-8 and Unicode. */
export function parseImageOcrOutput(bytes) {
  try {
    if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > IMAGE_OCR_MAX_OUTPUT_BYTES) return { status: 'unavailable' }
    const result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    if (!result || typeof result !== 'object' || Array.isArray(result)) return { status: 'unavailable' }
    const keys = Object.keys(result).sort().join(',')
    if (keys === 'status' && FAILURE_STATUSES.has(result.status)) return { status: result.status }
    if (keys !== 'status,text' || result.status !== 'ready' || typeof result.text !== 'string' ||
        !result.text.trim() || !result.text.isWellFormed() ||
        /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(result.text) ||
        Buffer.byteLength(result.text, 'utf8') > IMAGE_OCR_MAX_TEXT_BYTES) return { status: 'unavailable' }
    return { status: 'ready', text: result.text }
  } catch {
    return { status: 'unavailable' }
  }
}

/** Internal engine only: no renderer IPC, file access, persistence, model call,
 * or automatic extraction. The eventual review workflow must explicitly call
 * it with already-normalized image bytes and separately adopt editable text.
 * Packaged hosts must supply imageOcrExecutable({ packaged: true, resourcesPath }).
 * Cancellation settles promptly, but retains capacity until the process closes. */
export function createImageOcrRunner({
  executable = imageOcrExecutable(),
  targetPlatform = process.platform,
  spawnProcess = spawn,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  const active = new Set()
  let disposed = false

  function recognize(bytes, { signal } = {}) {
    if (disposed || signal?.aborted) return Promise.resolve({ status: 'cancelled' })
    if (targetPlatform !== 'darwin' || typeof executable !== 'string' || !isAbsolute(executable)) {
      return Promise.resolve({ status: 'unavailable' })
    }
    if (active.size >= IMAGE_OCR_CAPACITY) return Promise.resolve({ status: 'busy' })
    const input = snapshotInput(bytes)
    if (!Buffer.isBuffer(input)) return Promise.resolve(input)

    return new Promise((resolve) => {
      let child
      try {
        child = spawnProcess(executable, [], {
          cwd: '/', env: { LC_ALL: 'C' }, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true,
        })
      } catch {
        resolve({ status: 'unavailable' })
        return
      }
      let settled = false
      let outputBytes = 0
      const chunks = []
      const settle = (result) => {
        if (settled) return
        settled = true
        clearTimer(timer)
        signal?.removeEventListener('abort', onAbort)
        chunks.length = 0
        resolve(result)
      }
      const stop = (status) => {
        if (settled) return
        settle({ status })
        // No shell or child-process tree is involved. Retain the slot until
        // close, even if kill reports a failure or the caller has gone away.
        try { child.kill('SIGKILL') } catch { /* process close owns release */ }
      }
      const onAbort = () => stop('cancelled')
      const job = { stop }
      active.add(job)
      const timer = setTimer(() => stop('timeout'), IMAGE_OCR_TIMEOUT_MS)
      child.once('error', () => stop('unavailable'))
      child.stdin.on('error', () => stop('unavailable'))
      child.stdout.on('error', () => stop('unavailable'))
      child.stdout.on('data', (chunk) => {
        if (settled) return
        outputBytes += chunk.length
        if (outputBytes > IMAGE_OCR_MAX_OUTPUT_BYTES) { stop('unavailable'); return }
        chunks.push(Buffer.from(chunk))
      })
      child.once('close', (code, childSignal) => {
        active.delete(job)
        if (settled) return
        settle(code === 0 && !childSignal ? parseImageOcrOutput(Buffer.concat(chunks, outputBytes)) : { status: 'unavailable' })
      })
      signal?.addEventListener('abort', onAbort, { once: true })
      if (signal?.aborted || disposed) onAbort()
      if (!settled) {
        try { child.stdin.end(input) } catch { stop('unavailable') }
      }
    })
  }

  return {
    recognize,
    dispose() {
      disposed = true
      for (const job of active) job.stop('cancelled')
    },
  }
}
