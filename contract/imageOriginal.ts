import { IMAGE_MAX_CONTAINER_BYTES, isImageSnapshot, type ImageSnapshot } from './imageInput.ts'

/** Opaque source bytes, never a renderable image or model-input authority. */
export interface ImageOriginal { name: string; data: string; byteLength: number }
export interface ImageAssetUpload { image: ImageSnapshot; original: ImageOriginal }
export interface ImageOriginalDownload { id: string; original: ImageOriginal }
export interface ImageOriginalInfo { id: string; name: string; byteLength: number }

export function isImageOriginal(value: unknown): value is ImageOriginal {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const v = value as Record<string, unknown>
  if (Object.keys(v).length !== 3 || typeof v.name !== 'string' || !v.name.trim() || v.name.length > 255 ||
      /[\\/\u0000-\u001f\u007f]/.test(v.name) || v.name === '.' || v.name === '..' ||
      !Number.isSafeInteger(v.byteLength) || (v.byteLength as number) < 1 || (v.byteLength as number) > IMAGE_MAX_CONTAINER_BYTES ||
      typeof v.data !== 'string' || v.data.length !== Math.ceil((v.byteLength as number) / 3) * 4) return false
  try {
    const binary = atob(v.data)
    return binary.length === v.byteLength && btoa(binary) === v.data
  } catch { return false }
}

/** Legacy normalized-only uploads remain valid; present originals are strict. */
export function parseImageAssetUpload(value: unknown): { image: ImageSnapshot; original?: ImageOriginal } | undefined {
  if (isImageSnapshot(value)) return { image: value }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const v = value as Record<string, unknown>
  return Object.keys(v).length === 2 && isImageSnapshot(v.image) && isImageOriginal(v.original)
    ? { image: v.image, original: v.original } : undefined
}

export function imageOriginal(name: string, bytes: Uint8Array): ImageOriginal {
  if (bytes.byteLength < 1 || bytes.byteLength > IMAGE_MAX_CONTAINER_BYTES) throw new Error('Choose images up to 8 MB each.')
  let binary = ''
  for (let at = 0; at < bytes.length; at += 8192) binary += String.fromCharCode(...bytes.subarray(at, at + 8192))
  const original = { name, data: btoa(binary), byteLength: bytes.length }
  if (!isImageOriginal(original)) throw new Error('The image filename is not supported. Rename the file and try again.')
  return original
}
