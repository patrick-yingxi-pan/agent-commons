import { isArtifactDocumentFileName, reviewArtifactDocumentImport } from './artifactDocumentImport.ts'
import type { LocalBrowsePreview } from './localFilePreview.ts'

/** A connected-source path names a preview, not a native handle. The ordinary
 * file importer validates leaf filenames; keep the relative path for UI
 * provenance without treating it as a filename or rereading the source. */
export function localPreviewDocumentImport(preview: LocalBrowsePreview | null) {
  if (!preview || typeof preview.snapshot.text !== 'string') return null
  const name = preview.path.split('/').at(-1) ?? ''
  if (!isArtifactDocumentFileName(name)) return null
  return reviewArtifactDocumentImport([{ name, kind: 'file', text: preview.snapshot.text, documentImport: preview.documentImport }])
}
