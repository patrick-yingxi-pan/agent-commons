import { IMAGE_MAX_CONTAINER_BYTES } from '../../contract/imageInput.ts'
import { parseSvgPreparation, svgFailure, type SvgPreparation } from './svgInput.ts'
import { createDocumentWorkerImporter, type WorkerLoader } from './documentWorkerImport.ts'

export const SVG_IMPORT_TIMEOUT_MS = 15_000
export const MAX_SVG_FILE_BYTES = IMAGE_MAX_CONTAINER_BYTES
export const MAX_SVG_SELECTION_BYTES = 24 * 1024 * 1024

/** Queue SVG XML preparation in the same terminable worker boundary as Office imports. */
export function createSvgImporter(load: WorkerLoader, { timeoutMs = SVG_IMPORT_TIMEOUT_MS } = {}) {
  return createDocumentWorkerImporter<SvgPreparation>(load, {
    format: 'svg',
    timeoutMs,
    maxFileBytes: MAX_SVG_FILE_BYTES,
    maxSelectionBytes: MAX_SVG_SELECTION_BYTES,
    failure: (status) => svgFailure(status),
    acceptedResult: parseSvgPreparation,
  })
}

export const prepareSvg = createSvgImporter(async () => {
  const { default: ParserWorker } = await import('./officeParser.worker.ts?worker')
  return () => new ParserWorker()
})
