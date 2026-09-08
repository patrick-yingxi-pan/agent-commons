import {
  PPTX_IMPORT_TIMEOUT_MS, MAX_PPTX_FILE_BYTES, MAX_PPTX_SELECTION_BYTES, MAX_PPTX_TEXT_BYTES,
  pptxImportFailure, isPptxImportOutcome, type PptxImportResult,
} from '../../contract/pptxImport.mjs'
import { createDocumentWorkerImporter, type WorkerLoader } from './documentWorkerImport.ts'

function acceptedResult(value: unknown): PptxImportResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return pptxImportFailure('invalid')
  const result = value as Record<string, unknown>
  if (Object.keys(result).some((key) => !['text', 'documentImport'].includes(key)) || !isPptxImportOutcome(result.documentImport)) return pptxImportFailure('invalid')
  if (result.documentImport.status === 'ready') {
    if (typeof result.text !== 'string' || !result.text.trim() || result.text.length > MAX_PPTX_TEXT_BYTES || new TextEncoder().encode(result.text).byteLength > MAX_PPTX_TEXT_BYTES) return pptxImportFailure('invalid')
    return { text: result.text, documentImport: result.documentImport }
  }
  return result.text === undefined ? { documentImport: result.documentImport } : pptxImportFailure('invalid')
}

export function createPptxImporter(load: WorkerLoader, { timeoutMs = PPTX_IMPORT_TIMEOUT_MS } = {}) {
  return createDocumentWorkerImporter(load, {
    format: 'pptx',
    timeoutMs, maxFileBytes: MAX_PPTX_FILE_BYTES, maxSelectionBytes: MAX_PPTX_SELECTION_BYTES,
    failure: pptxImportFailure, acceptedResult,
  })
}

export const importPptx = createPptxImporter(async () => {
  const { default: ParserWorker } = await import('./officeParser.worker.ts?worker')
  return () => new ParserWorker()
})
