import { IMAGE_MAX_BYTES, IMAGE_MAX_CONTAINER_BYTES, IMAGE_MAX_DIMENSION, IMAGE_MAX_PIXELS, inspectImageBytes, type ImageSnapshot } from '../../contract/imageInput.ts'

export type ImageImportFailure = 'invalid' | 'too-large' | 'decode-failed' | 'timeout' | 'aborted' | 'canvas-unavailable'
const FAILURE_COPY: Record<ImageImportFailure, string> = {
  invalid: 'Choose a valid PNG, JPEG, GIF, or WebP image, up to 8,000 pixels per side and 32 megapixels.',
  'too-large': 'Choose an image up to 8 MB. Its saved preview must fit within 3 MB.',
  'decode-failed': 'This image could not be opened. Try exporting it as PNG or JPEG.',
  timeout: 'This image took too long to import. Try a smaller image.',
  aborted: 'Image import cancelled.',
  'canvas-unavailable': 'Image conversion is unavailable. Try reopening the app.',
}
export class ImageImportError extends Error {
  readonly reason: ImageImportFailure
  constructor(reason: ImageImportFailure) { super(FAILURE_COPY[reason]); this.name = 'ImageImportError'; this.reason = reason }
}

type Bitmap = { width: number; height: number; close?: () => void }
type Canvas = {
  width: number; height: number
  getContext(kind: '2d'): { drawImage(image: CanvasImageSource, x: number, y: number, width: number, height: number): void } | null
  toBlob?: (callback: (blob: Blob | null) => void, type?: string) => void
  convertToBlob?: (options: { type: string }) => Promise<Blob>
}
export interface ImageImportDeps {
  decode?: (blob: Blob, signal: AbortSignal) => Promise<Bitmap>
  canvas?: (width: number, height: number) => Canvas | null
  timeoutMs?: number
}

function base64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}
function defaultCanvas(width: number, height: number): Canvas | null {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height)
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = width; canvas.height = height
  return canvas
}
function encode(canvas: Canvas): Promise<Blob> {
  if (canvas.convertToBlob) return canvas.convertToBlob({ type: 'image/png' })
  return new Promise((resolve, reject) => {
    if (!canvas.toBlob) return reject(new ImageImportError('canvas-unavailable'))
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new ImageImportError('canvas-unavailable')), 'image/png')
  })
}

/** Decode only structurally bounded raster inputs, then save a first-frame PNG.
 * A single deadline covers decode and every encode attempt. Cancellation wins
 * immediately even when the browser codec is not abortable; late bitmaps close. */
export async function importImage(bytes: Uint8Array, signal?: AbortSignal, deps: ImageImportDeps = {}): Promise<ImageSnapshot> {
  if (signal?.aborted) throw new ImageImportError('aborted')
  if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > IMAGE_MAX_CONTAINER_BYTES) throw new ImageImportError('too-large')
  const header = inspectImageBytes(bytes)
  if (!header) throw new ImageImportError('invalid')
  const controller = new AbortController()
  let reason: ImageImportFailure = 'aborted'
  let bitmap: Bitmap | undefined
  let closed = false
  const close = () => { if (bitmap && !closed) { closed = true; try { bitmap.close?.() } catch { /* preserve primary outcome */ } } }
  const check = () => { if (controller.signal.aborted) throw new ImageImportError(reason) }
  let rejectCancelled!: (error: Error) => void
  const cancelled = new Promise<never>((_, reject) => { rejectCancelled = reject })
  const cancel = (failure: ImageImportFailure) => {
    if (controller.signal.aborted) return
    reason = failure
    controller.abort()
    rejectCancelled(new ImageImportError(failure))
  }
  const onAbort = () => cancel('aborted')
  signal?.addEventListener('abort', onAbort, { once: true })
  const timeout = deps.timeoutMs ?? 15_000
  const timer = setTimeout(() => cancel('timeout'), Number.isFinite(timeout) && timeout > 0 ? timeout : 15_000)
  const work = async (): Promise<ImageSnapshot> => {
    const blob = new Blob([new Uint8Array(bytes)], { type: header.mimeType })
    const decode = deps.decode ?? ((input: Blob) => {
      if (typeof createImageBitmap !== 'function') throw new ImageImportError('decode-failed')
      return createImageBitmap(input)
    })
    bitmap = await decode(blob, controller.signal)
    if (controller.signal.aborted) { close(); check() }
    const { width, height } = bitmap
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
        width > IMAGE_MAX_DIMENSION || height > IMAGE_MAX_DIMENSION || width * height > IMAGE_MAX_PIXELS) throw new ImageImportError('invalid')
    const scale = Math.min(1, 2000 / Math.max(width, height), Math.sqrt(4_000_000 / (width * height)))
    let targetWidth = Math.max(1, Math.floor(width * scale))
    let targetHeight = Math.max(1, Math.floor(height * scale))
    for (let attempt = 0; attempt < 24; attempt++) {
      check()
      const canvas = (deps.canvas ?? defaultCanvas)(targetWidth, targetHeight)
      const context = canvas?.getContext('2d')
      if (!canvas || !context) throw new ImageImportError('canvas-unavailable')
      context.drawImage(bitmap as CanvasImageSource, 0, 0, targetWidth, targetHeight)
      const output = await encode(canvas)
      check()
      if (output.size <= IMAGE_MAX_BYTES) {
        const normalized = new Uint8Array(await output.arrayBuffer())
        check()
        const verified = inspectImageBytes(normalized)
        if (!verified || verified.mimeType !== 'image/png' || verified.width !== targetWidth || verified.height !== targetHeight) throw new ImageImportError('decode-failed')
        return { ...verified, data: base64(normalized), byteLength: normalized.byteLength }
      }
      if (targetWidth === 1 && targetHeight === 1) break
      targetWidth = Math.max(1, Math.floor(targetWidth * 0.75))
      targetHeight = Math.max(1, Math.floor(targetHeight * 0.75))
    }
    throw new ImageImportError('too-large')
  }
  try {
    return await Promise.race([work(), cancelled])
  } catch (error) {
    if (error instanceof ImageImportError) throw error
    throw new ImageImportError('decode-failed')
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
    controller.abort()
    close()
  }
}
