import { isImageSnapshot } from '../../contract/imageInput.ts'
import { IMAGE_OCR_MAX_EDGE } from '../../contract/imageOcr.mjs'
import type { LocalBrowsePreview } from './localFilePreview.ts'
import type { UiHostFile } from './uiHostFs.ts'

/** OCR takes the already reviewed normalized pixels, never the private
 * original, a path capability, or permission to reread the selected file. */
export function localPreviewImageImport(preview: LocalBrowsePreview | null): UiHostFile | null {
  const image = preview?.snapshot.image
  if (!preview || !isImageSnapshot(image) || image.mimeType !== 'image/png' || image.width > IMAGE_OCR_MAX_EDGE || image.height > IMAGE_OCR_MAX_EDGE) return null
  return {
    id: 'reviewed-local-image', name: preview.path.split('/').at(-1) ?? '', kind: 'photo',
    imageInput: { mimeType: image.mimeType, data: image.data, width: image.width, height: image.height, byteLength: image.byteLength },
  }
}
