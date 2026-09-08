import type { ArtifactDocumentExport } from '../../contract/index.ts'

/** Request the browser's normal save flow. No native path or persistent file
 * authority crosses this boundary, and success does not assert a disk save. */
export function downloadText(file: Pick<ArtifactDocumentExport, 'content' | 'mediaType' | 'filename'>): void {
  const url = URL.createObjectURL(new Blob([file.content], { type: file.mediaType }))
  const anchor = document.createElement('a')
  try {
    anchor.href = url
    anchor.download = file.filename
    anchor.hidden = true
    document.body.append(anchor)
    anchor.click()
  } finally {
    anchor.remove()
    // Chromium may consume the URL after click returns. A bounded grace period
    // releases its retained bytes without racing that handoff.
    setTimeout(() => URL.revokeObjectURL(url), 30_000)
  }
}
