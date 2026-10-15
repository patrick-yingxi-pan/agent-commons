import { parseWorkbookImportResult } from '../../contract/workbookImport.ts'
import { parsePresentationImportResult } from '../../contract/presentationImport.ts'
import { localBrowseDocumentFormat } from '../../contract/localFileBrowse.mjs'
import type { LocalBrowsePreview } from './localFilePreview.ts'
import type { UiHostFile } from './uiHostFs.ts'

export interface LocalStructuredImport {
  kind: 'sheet' | 'slide'
  file: UiHostFile
}

/** A path is provenance only. Structured review takes the detached source
 * projection, never attachment text, original bytes, or a read capability. */
export function localPreviewStructuredImport(preview: LocalBrowsePreview | null): LocalStructuredImport | null {
  if (!preview) return null
  const name = preview.path.split('/').at(-1) ?? ''
  const format = localBrowseDocumentFormat(name)
  if (format === 'xlsx' && preview.workbookImport) return {
    kind: 'sheet', file: { id: 'reviewed-local-workbook', name, kind: 'file', ...parseWorkbookImportResult(preview.workbookImport) },
  }
  if (format === 'pptx' && preview.presentationImport) return {
    kind: 'slide', file: { id: 'reviewed-local-presentation', name, kind: 'file', ...parsePresentationImportResult(preview.presentationImport) },
  }
  return null
}
