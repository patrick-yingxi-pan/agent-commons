export type ParserPort = Pick<Worker, 'postMessage' | 'terminate' | 'onmessage' | 'onerror' | 'onmessageerror'>
export type WorkerLoader = () => Promise<() => ParserPort>
interface DocumentWorkerPolicy<Result> {
  format: 'docx' | 'xlsx' | 'xlsx-workbook' | 'pptx' | 'pptx-presentation' | 'svg'
  timeoutMs: number
  maxFileBytes: number
  maxSelectionBytes: number
  failure(status: 'file-too-large' | 'selection-limit' | 'unavailable' | 'timeout' | 'invalid'): Result
  acceptedResult(value: unknown): Result
}

/** One queue and one admission-to-completion deadline. Cancellation removes a
 * queued job immediately, or terminates its actual worker before releasing the
 * slot. Late module loads/results never create a new worker or attachment. */
export function createDocumentWorkerImporter<Result>(load: WorkerLoader, { format, timeoutMs, maxFileBytes, maxSelectionBytes, failure, acceptedResult }: DocumentWorkerPolicy<Result>) {
  interface Job { start(): void; finish(result: Result): void }
  const queue: Job[] = []
  let active: Job | undefined
  let queuedBytes = 0
  let count = 0
  const pump = () => {
    if (active) return
    active = queue.shift()
    active?.start()
  }
  return (bytes: Uint8Array, signal?: AbortSignal): Promise<Result> => {
    if (signal?.aborted) return Promise.resolve(failure('unavailable'))
    if (bytes.byteLength > maxFileBytes) return Promise.resolve(failure('file-too-large'))
    if (count >= 24 || queuedBytes + bytes.byteLength > maxSelectionBytes) return Promise.resolve(failure('selection-limit'))
    const size = bytes.byteLength
    const snapshot = bytes.slice()
    queuedBytes += size
    count += 1
    return new Promise((resolve) => {
      let settled = false
      let worker: ParserPort | undefined
      const abort = () => job.finish(failure('unavailable'))
      const timer = setTimeout(() => job.finish(failure('timeout')), timeoutMs)
      const job: Job = {
        start() {
          void Promise.resolve().then(load).then((create) => {
            if (settled) return
            worker = create()
            worker.onmessage = (event) => job.finish(acceptedResult(event.data))
            worker.onerror = (event) => { event.preventDefault?.(); job.finish(failure('invalid')) }
            worker.onmessageerror = () => job.finish(failure('invalid'))
            worker.postMessage({ format, bytes: snapshot }, [snapshot.buffer])
          }).catch(() => job.finish(failure('unavailable')))
        },
        finish(result) {
          if (settled) return
          settled = true
          clearTimeout(timer)
          signal?.removeEventListener('abort', abort)
          if (worker) {
            worker.onmessage = null
            worker.onerror = null
            worker.onmessageerror = null
            worker.terminate()
          }
          queuedBytes -= size
          count -= 1
          if (active === job) active = undefined
          else { const index = queue.indexOf(job); if (index !== -1) queue.splice(index, 1) }
          resolve(result)
          pump()
        },
      }
      signal?.addEventListener('abort', abort, { once: true })
      queue.push(job)
      pump()
    })
  }
}
