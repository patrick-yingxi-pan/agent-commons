import {
  XLSX_IMPORT_TIMEOUT_MS, MAX_XLSX_FILE_BYTES, MAX_XLSX_SELECTION_BYTES, MAX_XLSX_TEXT_BYTES,
  xlsxImportFailure, isXlsxImportOutcome, type XlsxImportResult,
} from '../../contract/xlsxImport.mjs'

import { createDocumentWorkerImporter, type WorkerLoader } from './documentWorkerImport.ts'

function acceptedResult(value: unknown): XlsxImportResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return xlsxImportFailure('invalid')
  const result = value as Record<string, unknown>
  if (Object.keys(result).some((key) => !['text', 'documentImport'].includes(key)) || !isXlsxImportOutcome(result.documentImport)) return xlsxImportFailure('invalid')
  if (result.documentImport.status === 'ready') {
    if (typeof result.text !== 'string' || !result.text.trim() || result.text.length > MAX_XLSX_TEXT_BYTES || new TextEncoder().encode(result.text).byteLength > MAX_XLSX_TEXT_BYTES) return xlsxImportFailure('invalid')
    return { text: result.text, documentImport: result.documentImport }
  }
  return result.text === undefined ? { documentImport: result.documentImport } : xlsxImportFailure('invalid')
}

export function createXlsxImporter(load: WorkerLoader, { timeoutMs = XLSX_IMPORT_TIMEOUT_MS } = {}) {
  return createDocumentWorkerImporter(load, {
    format: 'xlsx',
    timeoutMs, maxFileBytes: MAX_XLSX_FILE_BYTES, maxSelectionBytes: MAX_XLSX_SELECTION_BYTES,
    failure: xlsxImportFailure, acceptedResult,
  })
}

export const importXlsx = createXlsxImporter(async () => {
  const { default: ParserWorker } = await import('./officeParser.worker.ts?worker')
  return () => new ParserWorker()
})
