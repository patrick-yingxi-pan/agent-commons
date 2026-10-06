import { isImageOriginal } from '../../contract/imageOriginal.ts'
import type { ImageAssetRef } from '../../contract/imageAssets.ts'
import type { DownloadBlobDescriptor } from './downloadText.ts'

export const IMAGE_ORIGINAL_PRIVACY_COPY = 'Shared views and conversation image input use the preview copy. Original downloads, including MCP, stay private to the owning account.'

export function matchesImageOriginalInfo(value: unknown, ref: ImageAssetRef): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const info = value as Record<string, unknown>
  return Object.keys(info).length === 3 && info.id === ref.id &&
    typeof info.name === 'string' && info.name.length > 0 && info.name.length <= 255 &&
    !/[\\/\u0000-\u001f\u007f]/.test(info.name) && info.name !== '.' && info.name !== '..' &&
    ref.originalByteLength !== undefined && info.byteLength === ref.originalByteLength
}

/** Original containers are download-only, including SVG: never inline markup. */
export function decodeImageOriginalDownload(value: unknown, ref: ImageAssetRef): DownloadBlobDescriptor {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Unexpected original image')
  const file = value as Record<string, unknown>
  if (Object.keys(file).length !== 2 || file.id !== ref.id || !isImageOriginal(file.original) || file.original.byteLength !== ref.originalByteLength) {
    throw new Error('The original image did not match the selected copy.')
  }
  return { filename: file.original.name, mediaType: 'application/octet-stream', content: Uint8Array.from(atob(file.original.data), (char) => char.charCodeAt(0)) }
}
