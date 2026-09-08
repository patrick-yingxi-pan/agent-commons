import { IMAGE_MAX_BYTES, IMAGE_MAX_DIMENSION, IMAGE_MAX_PIXELS, type ImageSnapshot } from './imageInput.ts'

/** Durable immutable content reference. Neither this id nor a preview URL is
 * authority: each read and attachment resolves through the session/tenant wall. */
export interface ImageAssetRef extends Omit<ImageSnapshot, 'data'> { id: string }

/** A single bounded snapshot plus JSON/MCP framing; ordinary JSON stays 1 MiB. */
export const IMAGE_UPLOAD_BODY_BYTES = Math.ceil(IMAGE_MAX_BYTES / 3) * 4 + 16 * 1024

export function isImageAssetRef(value: unknown): value is ImageAssetRef {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const ref = value as Record<string, unknown>
  return Object.keys(ref).length === 5 &&
    typeof ref.id === 'string' && /^img-[a-f0-9]{64}$/.test(ref.id) &&
    ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(ref.mimeType as string) &&
    typeof ref.width === 'number' && Number.isSafeInteger(ref.width) && ref.width > 0 && ref.width <= IMAGE_MAX_DIMENSION &&
    typeof ref.height === 'number' && Number.isSafeInteger(ref.height) && ref.height > 0 && ref.height <= IMAGE_MAX_DIMENSION &&
    ref.width * ref.height <= IMAGE_MAX_PIXELS &&
    typeof ref.byteLength === 'number' && Number.isSafeInteger(ref.byteLength) && ref.byteLength > 0 && ref.byteLength <= IMAGE_MAX_BYTES
}

export function imageAssetRef(id: string, image: ImageSnapshot): ImageAssetRef {
  return { id, mimeType: image.mimeType, width: image.width, height: image.height, byteLength: image.byteLength }
}

export function imageAssetRefMatches(ref: ImageAssetRef, image: ImageSnapshot): boolean {
  return ref.mimeType === image.mimeType && ref.width === image.width && ref.height === image.height && ref.byteLength === image.byteLength
}
