import {
  createImageOcrRunner,
  IMAGE_OCR_CAPACITY,
  IMAGE_OCR_MAX_INPUT_BYTES,
  imageOcrExecutable,
} from './imageOcr.mjs'
import { isImageOcrResult } from '../contract/imageOcr.mjs'

const OPERATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const unavailable = () => ({ status: 'unavailable' })

function closedResult(result) {
  try {
    if (!isImageOcrResult(result)) return unavailable()
    if (result.status === 'ready') return { status: 'ready', text: result.text }
    return { status: result.status }
  } catch {
    return unavailable()
  }
}

function isLive(job) {
  try {
    return !job.sender.isDestroyed?.() && job.sender.mainFrame === job.frame
  } catch {
    return false
  }
}

/** Main-process OCR facade. Callers are authenticated before even inspecting
 * renderer-provided bytes; ownership is the exact WebContents + main frame. */
export function createImageOcrHost({
  targetPlatform = process.platform,
  packaged = false,
  resourcesPath,
  executable = imageOcrExecutable({ packaged, resourcesPath, targetPlatform }),
  runner = createImageOcrRunner({ executable, targetPlatform }),
  assertCaller = () => {},
  isClosing = () => false,
} = {}) {
  if (!runner || typeof runner.recognize !== 'function' || typeof runner.dispose !== 'function' ||
      typeof assertCaller !== 'function' || typeof isClosing !== 'function') {
    throw new Error('The image OCR host is not configured.')
  }

  let disposed = false
  const active = new Map()
  const host = {
    async recognize(event, operationId, png, ...extra) {
      try { assertCaller(event) } catch { return unavailable() }
      if (disposed || isClosing() || targetPlatform !== 'darwin') return unavailable()
      if (extra.length) return { status: 'invalid' }
      if (typeof operationId !== 'string' || !OPERATION_ID.test(operationId)) return { status: 'invalid' }
      if (active.has(operationId)) return { status: 'busy' }
      if (active.size >= IMAGE_OCR_CAPACITY) return { status: 'busy' }
      if (!(png instanceof Uint8Array) || (typeof SharedArrayBuffer === 'function' && png.buffer instanceof SharedArrayBuffer)) return { status: 'invalid' }
      if (png.byteLength > IMAGE_OCR_MAX_INPUT_BYTES) return { status: 'too-large' }

      const sender = event.sender
      const frame = event.senderFrame
      if (!sender || !frame || sender.mainFrame !== frame || sender.isDestroyed?.()) return unavailable()
      const controller = new AbortController()
      const job = { sender, frame, controller }
      active.set(operationId, job)
      let result
      try {
        result = await runner.recognize(Buffer.from(png), { signal: controller.signal })
      } catch {
        result = unavailable()
      } finally {
        if (active.get(operationId) === job) active.delete(operationId)
      }
      if (disposed || isClosing() || controller.signal.aborted || !isLive(job)) return { status: 'cancelled' }
      return closedResult(result)
    },

    async cancel(event, operationId, ...extra) {
      try { assertCaller(event) } catch { return false }
      if (disposed || isClosing() || extra.length || typeof operationId !== 'string' || !OPERATION_ID.test(operationId)) return false
      const job = active.get(operationId)
      if (!job || job.sender !== event.sender || job.frame !== event.senderFrame) return false
      job.controller.abort()
      return true
    },

    cancelSender(sender) {
      let count = 0
      for (const job of active.values()) {
        if (job.sender === sender) {
          job.controller.abort()
          count += 1
        }
      }
      return count
    },

    dispose() {
      if (disposed) return
      disposed = true
      for (const job of active.values()) job.controller.abort()
      try { runner.dispose() } catch { /* shutdown remains closed even if the native process fails to stop */ }
    },
  }
  return Object.freeze(host)
}
