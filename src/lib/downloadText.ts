import type { ArtifactDocumentExport } from '../../contract/index.ts'

export type DownloadBlobDescriptor = { filename: string; mediaType: string; content: BlobPart }

/** Shared browser save flow for text and binary exports. */
export function downloadBlob(file: DownloadBlobDescriptor): void {
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
    setTimeout(() => URL.revokeObjectURL(url), 30_000)
  }
}

/** Request the browser's normal save flow. No native path or persistent file
 * authority crosses this boundary, and success does not assert a disk save. */
export function downloadText(file: Pick<ArtifactDocumentExport, 'content' | 'mediaType' | 'filename'>): void {
  downloadBlob(file)
}
