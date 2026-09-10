import {
  PPTX_IMPORT_TIMEOUT_MS, MAX_PPTX_FILE_BYTES, MAX_PPTX_SELECTION_BYTES,
  pptxImportFailure,
} from '../../contract/pptxImport.mjs'
import { parsePresentationImportResult, type PresentationImportResult } from '../../contract/presentationImport.ts'
import { createDocumentWorkerImporter, type WorkerLoader } from './documentWorkerImport.ts'

export function createPresentationImporter(load: WorkerLoader, { timeoutMs = PPTX_IMPORT_TIMEOUT_MS } = {}) {
  return createDocumentWorkerImporter<PresentationImportResult>(load, {
    format: 'pptx-presentation',
    timeoutMs, maxFileBytes: MAX_PPTX_FILE_BYTES, maxSelectionBytes: MAX_PPTX_SELECTION_BYTES,
    failure: pptxImportFailure, acceptedResult: parsePresentationImportResult,
  })
}

export const importPresentation = createPresentationImporter(async () => {
  const { default: ParserWorker } = await import('./officeParser.worker.ts?worker')
  return () => new ParserWorker()
})
