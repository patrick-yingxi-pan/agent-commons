import {
  XLSX_IMPORT_TIMEOUT_MS, MAX_XLSX_FILE_BYTES, MAX_XLSX_SELECTION_BYTES,
  xlsxImportFailure,
} from '../../contract/xlsxImport.mjs'
import { parseWorkbookImportResult, type WorkbookImportResult } from '../../contract/workbookImport.ts'
import { createDocumentWorkerImporter, type WorkerLoader } from './documentWorkerImport.ts'

export function createWorkbookImporter(load: WorkerLoader, { timeoutMs = XLSX_IMPORT_TIMEOUT_MS } = {}) {
  return createDocumentWorkerImporter<WorkbookImportResult>(load, {
    format: 'xlsx-workbook',
    timeoutMs, maxFileBytes: MAX_XLSX_FILE_BYTES, maxSelectionBytes: MAX_XLSX_SELECTION_BYTES,
    failure: xlsxImportFailure, acceptedResult: parseWorkbookImportResult,
  })
}

export const importWorkbook = createWorkbookImporter(async () => {
  const { default: ParserWorker } = await import('./officeParser.worker.ts?worker')
  return () => new ParserWorker()
})
