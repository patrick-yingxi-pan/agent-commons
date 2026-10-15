import {
  MAX_XLSX_FILE_BYTES, MAX_XLSX_SELECTION_BYTES, XLSX_IMPORT_TIMEOUT_MS,
  xlsxImportFailure, type XlsxImportOutcome,
} from '../../contract/xlsxImport.mjs'
import {
  MAX_PPTX_FILE_BYTES, MAX_PPTX_SELECTION_BYTES, PPTX_IMPORT_TIMEOUT_MS,
  pptxImportFailure, type PptxImportOutcome,
} from '../../contract/pptxImport.mjs'
import { createDocumentWorkerImporter, type WorkerLoader } from './documentWorkerImport.ts'
import { parseLocalOfficeImportResult, type LocalOfficeImportResult } from './localOfficeImportResult.ts'

function failed(format: 'xlsx' | 'pptx', status: Parameters<typeof xlsxImportFailure>[0]): LocalOfficeImportResult {
  return format === 'xlsx'
    ? { documentImport: xlsxImportFailure(status).documentImport as XlsxImportOutcome,
        workbookImport: { documentImport: xlsxImportFailure(status).documentImport as XlsxImportOutcome } }
    : { documentImport: pptxImportFailure(status).documentImport as PptxImportOutcome,
        presentationImport: { documentImport: pptxImportFailure(status).documentImport as PptxImportOutcome } }
}

function createLocalOfficeImporter(format: 'xlsx' | 'pptx', load: WorkerLoader, timeoutMs: number) {
  const isXlsx = format === 'xlsx'
  return createDocumentWorkerImporter<LocalOfficeImportResult>(load, {
    format: isXlsx ? 'xlsx-preview' : 'pptx-preview',
    timeoutMs,
    maxFileBytes: isXlsx ? MAX_XLSX_FILE_BYTES : MAX_PPTX_FILE_BYTES,
    maxSelectionBytes: isXlsx ? MAX_XLSX_SELECTION_BYTES : MAX_PPTX_SELECTION_BYTES,
    failure: (status) => failed(format, status),
    acceptedResult: (value) => parseLocalOfficeImportResult(value, format),
  })
}

export function createLocalXlsxImporter(load: WorkerLoader, { timeoutMs = XLSX_IMPORT_TIMEOUT_MS } = {}) {
  return createLocalOfficeImporter('xlsx', load, timeoutMs)
}

export function createLocalPptxImporter(load: WorkerLoader, { timeoutMs = PPTX_IMPORT_TIMEOUT_MS } = {}) {
  return createLocalOfficeImporter('pptx', load, timeoutMs)
}

const loadOfficeWorker: WorkerLoader = async () => {
  const { default: ParserWorker } = await import('./officeParser.worker.ts?worker')
  return () => new ParserWorker()
}

export const importLocalXlsx = createLocalXlsxImporter(loadOfficeWorker)
export const importLocalPptx = createLocalPptxImporter(loadOfficeWorker)

/** Name-based adapter for the selected Folder/Git preview path. */
export function importLocalOffice(name: string, bytes: Uint8Array, signal?: AbortSignal): Promise<LocalOfficeImportResult> {
  if (/\.xlsx$/i.test(name)) return importLocalXlsx(bytes, signal)
  if (/\.pptx$/i.test(name)) return importLocalPptx(bytes, signal)
  return Promise.resolve(failed('xlsx', 'invalid'))
}
