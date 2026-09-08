import {
  DOCX_IMPORT_TIMEOUT_MS, MAX_DOCX_FILE_BYTES, MAX_DOCX_SELECTION_BYTES, MAX_DOCX_TEXT_BYTES,
  docxImportFailure, isDocxImportOutcome, type DocxImportResult,
} from '../../contract/docxImport.mjs'

import { createDocumentWorkerImporter, type WorkerLoader } from './documentWorkerImport.ts'

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

export function createDocxImporter(load: WorkerLoader, { timeoutMs = DOCX_IMPORT_TIMEOUT_MS } = {}) {
  return createDocumentWorkerImporter(load, {
    format: 'docx',
    timeoutMs, maxFileBytes: MAX_DOCX_FILE_BYTES, maxSelectionBytes: MAX_DOCX_SELECTION_BYTES,
    failure: docxImportFailure, acceptedResult,
  })
}

export const importDocx = createDocxImporter(async () => {
  const { default: ParserWorker } = await import('./officeParser.worker.ts?worker')
  return () => new ParserWorker()
})
