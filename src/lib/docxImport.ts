import {
  DOCX_IMPORT_TIMEOUT_MS, MAX_DOCX_FILE_BYTES, MAX_DOCX_SELECTION_BYTES, MAX_DOCX_TEXT_BYTES,
  docxImportFailure, isDocxImportOutcome, type DocxImportResult,
} from '../../contract/docxImport.mjs'

type ParserPort = Pick<Worker, 'postMessage' | 'terminate' | 'onmessage' | 'onerror' | 'onmessageerror'>
type WorkerLoader = () => Promise<() => ParserPort>

function acceptedResult(value: unknown): DocxImportResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return docxImportFailure('invalid')
  const result = value as Record<string, unknown>
  if (Object.keys(result).some((key) => !['text', 'documentImport'].includes(key)) || !isDocxImportOutcome(result.documentImport)) return docxImportFailure('invalid')
  if (result.documentImport.status === 'ready') {
    if (typeof result.text !== 'string' || !result.text.trim() || result.text.length > MAX_DOCX_TEXT_BYTES || new TextEncoder().encode(result.text).byteLength > MAX_DOCX_TEXT_BYTES) return docxImportFailure('invalid')
    return { text: result.text, documentImport: result.documentImport }
  }
  return result.text === undefined ? { documentImport: result.documentImport } : docxImportFailure('invalid')
}

/** One queue and one admission-to-completion deadline. Cancellation removes a
 * queued job immediately, or terminates its actual worker before releasing the
 * slot. Late module loads/results never create a new worker or attachment. */
export function createDocxImporter(load: WorkerLoader, { timeoutMs = DOCX_IMPORT_TIMEOUT_MS } = {}) {
  interface Job { start(): void; finish(result: DocxImportResult): void }
  const queue: Job[] = []
  let active: Job | undefined
  let queuedBytes = 0
  let count = 0
  const pump = () => {
    if (active) return
    active = queue.shift()
    active?.start()
  }
  return (bytes: Uint8Array, signal?: AbortSignal): Promise<DocxImportResult> => {
    if (signal?.aborted) return Promise.resolve(docxImportFailure('unavailable'))
    if (bytes.byteLength > MAX_DOCX_FILE_BYTES) return Promise.resolve(docxImportFailure('file-too-large'))
    if (count >= 24 || queuedBytes + bytes.byteLength > MAX_DOCX_SELECTION_BYTES) return Promise.resolve(docxImportFailure('selection-limit'))
    const size = bytes.byteLength
    const snapshot = bytes.slice()
    queuedBytes += size
    count += 1
    return new Promise((resolve) => {
      let settled = false
      let worker: ParserPort | undefined
      const abort = () => job.finish(docxImportFailure('unavailable'))
      const timer = setTimeout(() => job.finish(docxImportFailure('timeout')), timeoutMs)
      const job: Job = {
        start() {
          void Promise.resolve().then(load).then((create) => {
            if (settled) return
            worker = create()
            worker.onmessage = (event) => job.finish(acceptedResult(event.data))
            worker.onerror = (event) => { event.preventDefault?.(); job.finish(docxImportFailure('invalid')) }
            worker.onmessageerror = () => job.finish(docxImportFailure('invalid'))
            worker.postMessage(snapshot, [snapshot.buffer])
          }).catch(() => job.finish(docxImportFailure('unavailable')))
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

export const importDocx = createDocxImporter(async () => {
  const { default: ParserWorker } = await import('./docxParser.worker.ts?worker')
  return () => new ParserWorker()
})
