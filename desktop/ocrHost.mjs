const OPERATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const unavailable = () => ({ status: 'unavailable' })

function isLive(job) {
  try { return !job.sender.isDestroyed?.() && job.sender.mainFrame === job.frame }
  catch { return false }
}

/** One sender-owned lifetime for byte-only OCR engines. Format admission and
 * result schemas remain supplied by the owning closed contract. */
export function createOcrHost({ runner, capacity, maxInputBytes, isResult,
  targetPlatform = process.platform, assertCaller = () => {}, isClosing = () => false,
}) {
  if (!runner || typeof runner.recognize !== 'function' || typeof runner.dispose !== 'function' ||
      !Number.isSafeInteger(capacity) || capacity < 1 || !Number.isSafeInteger(maxInputBytes) || maxInputBytes < 1 ||
      typeof isResult !== 'function' || typeof assertCaller !== 'function' || typeof isClosing !== 'function') {
    throw new Error('The OCR host is not configured.')
  }
  let disposed = false
  const active = new Map()
  const host = {
    async recognize(event, operationId, bytes, ...extra) {
      try { assertCaller(event) } catch { return unavailable() }
      if (disposed || isClosing() || targetPlatform !== 'darwin') return unavailable()
      if (extra.length || typeof operationId !== 'string' || !OPERATION_ID.test(operationId)) return { status: 'invalid' }
      if (active.has(operationId) || active.size >= capacity) return { status: 'busy' }
      if (!(bytes instanceof Uint8Array) || (typeof SharedArrayBuffer === 'function' && bytes.buffer instanceof SharedArrayBuffer)) return { status: 'invalid' }
      if (bytes.byteLength > maxInputBytes) return { status: 'too-large' }
      const sender = event.sender
      const frame = event.senderFrame
      if (!sender || !frame || sender.mainFrame !== frame || sender.isDestroyed?.()) return unavailable()
      const controller = new AbortController()
      const job = { sender, frame, controller }
      active.set(operationId, job)
      let result
      try { result = await runner.recognize(Buffer.from(bytes), { signal: controller.signal }) }
      catch { result = unavailable() }
      finally { if (active.get(operationId) === job) active.delete(operationId) }
      if (disposed || isClosing() || controller.signal.aborted || !isLive(job)) return { status: 'cancelled' }
      try {
        if (!isResult(result)) return unavailable()
        const copy = { ...result }
        return isResult(copy) ? copy : unavailable()
      } catch { return unavailable() }
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
      for (const job of active.values()) if (job.sender === sender) { job.controller.abort(); count++ }
      return count
    },
    dispose() {
      if (disposed) return
      disposed = true
      for (const job of active.values()) job.controller.abort()
      try { runner.dispose() } catch { /* closed even if the native process fails to stop */ }
    },
  }
  return Object.freeze(host)
}
