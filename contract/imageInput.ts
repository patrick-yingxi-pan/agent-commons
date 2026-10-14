/** Structural image intake boundary. This checks bounded container headers and
 * dimensions only; it is not a complete codec decoder. Browser intake may
 * raster-normalize separately, while the server independently applies these
 * bounds without fetching URLs or trusting MIME claims. */
import { IMAGE_FILE_MAX_BYTES } from './imageFile.mjs'
export const IMAGE_MAX_BYTES = 3 * 1024 * 1024
export const IMAGE_MAX_CONTAINER_BYTES = IMAGE_FILE_MAX_BYTES
export const IMAGE_MAX_DIMENSION = 8000
export const IMAGE_MAX_PIXELS = 32_000_000
export const IMAGE_TURN_MAX_BYTES = 8 * 1024 * 1024
export const IMAGE_MAX_COUNT = 8

export type ImageMimeType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
export interface ImageSnapshot {
  mimeType: ImageMimeType
  data: string
  width: number
  height: number
  byteLength: number
}

const mime = (value: string): value is ImageMimeType => ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(value)
const u16le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8)
const u32be = (b: Uint8Array, i: number) => b[i]! * 0x1000000 + (b[i + 1]! << 16) + (b[i + 2]! << 8) + b[i + 3]!
const u32le = (b: Uint8Array, i: number) => b[i]! + b[i + 1]! * 0x100 + b[i + 2]! * 0x10000 + b[i + 3]! * 0x1000000
const ascii = (b: Uint8Array, i: number, text: string) => text.split('').every((c, n) => b[i + n] === c.charCodeAt(0))
const dimensions = (width: number, height: number) => Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0 && width <= IMAGE_MAX_DIMENSION && height <= IMAGE_MAX_DIMENSION && width * height <= IMAGE_MAX_PIXELS

function png(b: Uint8Array) {
  if (b.length < 33 || !ascii(b, 0, '\x89PNG\r\n\x1a\n') || u32be(b, 8) !== 13 || !ascii(b, 12, 'IHDR')) return undefined
  const width = u32be(b, 16)
  const height = u32be(b, 20)
  const depths: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] }
  if (!dimensions(width, height) || !depths[b[25]!]?.includes(b[24]!) || b[26] !== 0 || b[27] !== 0 || ![0, 1].includes(b[28]!)) return undefined
  let at = 8
  let idat = false
  while (at + 12 <= b.length) {
    const length = u32be(b, at)
    if (length > b.length - at - 12) return undefined
    const type = String.fromCharCode(...b.subarray(at + 4, at + 8))
    if (type === 'IHDR' && at !== 8) return undefined
    if (type === 'IDAT' && length > 0) idat = true
    // APNG frame dimensions cannot widen the already bounded default canvas.
    if (type === 'fcTL') {
      if (length !== 26) return undefined
      const frameWidth = u32be(b, at + 12)
      const frameHeight = u32be(b, at + 16)
      if (!dimensions(frameWidth, frameHeight) || u32be(b, at + 20) + frameWidth > width || u32be(b, at + 24) + frameHeight > height) return undefined
    }
    at += 12 + length
    if (type === 'IEND') return length === 0 && at === b.length && idat ? { mimeType: 'image/png' as const, width, height } : undefined
  }
  return undefined
}

function jpeg(b: Uint8Array) {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8 || b[b.length - 2] !== 0xff || b[b.length - 1] !== 0xd9) return undefined
  let at = 2; let found: { width: number; height: number } | undefined; let sos = false
  while (at + 3 < b.length) {
    if (b[at] !== 0xff) return undefined
    while (at < b.length && b[at] === 0xff) at++
    const marker = b[at++]!
    if (marker === 0xd9) break
    if (marker === 0xda) { sos = true; break }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue
    if (at + 2 > b.length) return undefined
    const length = (b[at]! << 8) | b[at + 1]!; if (length < 2 || at + length > b.length) return undefined
    const sof = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)
    if (sof && length >= 8) { const components = b[at + 7]!; if (length !== 8 + components * 3) return undefined; const height = (b[at + 3]! << 8) | b[at + 4]!; const width = (b[at + 5]! << 8) | b[at + 6]!; if (!dimensions(width, height)) return undefined; found = { width, height } }
    at += length
  }
  return sos && found ? { mimeType: 'image/jpeg' as const, ...found } : undefined
}

function gif(b: Uint8Array) {
  if (b.length < 14 || (!ascii(b, 0, 'GIF87a') && !ascii(b, 0, 'GIF89a')) || b[b.length - 1] !== 0x3b) return undefined
  const width = u16le(b, 6)
  const height = u16le(b, 8)
  if (!dimensions(width, height)) return undefined
  let at = 13
  if (b[10]! & 0x80) at += 3 * (1 << ((b[10]! & 7) + 1))
  let image = false
  const skipSubBlocks = () => {
    while (at < b.length) {
      const size = b[at++]!
      if (!size) return true
      if (size > b.length - at) return false
      at += size
    }
    return false
  }
  while (at < b.length) {
    const marker = b[at++]!
    if (marker === 0x3b) return image && at === b.length ? { mimeType: 'image/gif' as const, width, height } : undefined
    if (marker === 0x21) {
      if (at >= b.length) return undefined
      at++ // Extension label; its data is length-delimited, not image authority.
      if (!skipSubBlocks()) return undefined
      continue
    }
    if (marker !== 0x2c || at + 9 > b.length) return undefined
    const frameWidth = u16le(b, at + 4)
    const frameHeight = u16le(b, at + 6)
    if (!dimensions(frameWidth, frameHeight) || u16le(b, at) + frameWidth > width || u16le(b, at + 2) + frameHeight > height) return undefined
    const packed = b[at + 8]!
    at += 9
    if (packed & 0x80) at += 3 * (1 << ((packed & 7) + 1))
    if (at >= b.length || b[at]! < 2 || b[at]! > 8) return undefined
    at++ // LZW minimum code size. Full decompression belongs to the sandbox.
    if (!skipSubBlocks()) return undefined
    image = true
  }
  return undefined
}

function webp(b: Uint8Array) {
  if (b.length < 16 || !ascii(b, 0, 'RIFF') || !ascii(b, 8, 'WEBP') || u32le(b, 4) + 8 !== b.length) return undefined
  const u24 = (at: number) => b[at]! + (b[at + 1]! << 8) + (b[at + 2]! << 16)
  type Size = { width: number; height: number }
  let canvas: Size | undefined
  let payload: Size | undefined
  let animated = false
  let frames = 0
  const bitstreamSize = (at: number, size: number): Size | undefined => {
    if (ascii(b, at, 'VP8 ') && size >= 10 && (b[at + 8]! & 1) === 0 && ascii(b, at + 11, '\x9d\x01\x2a')) return { width: u16le(b, at + 14) & 0x3fff, height: u16le(b, at + 16) & 0x3fff }
    if (ascii(b, at, 'VP8L') && size >= 5 && b[at + 8] === 0x2f && (b[at + 12]! >> 5) === 0) {
      const bits = u32le(b, at + 9)
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
    }
    return undefined
  }
  let at = 12
  while (at + 8 <= b.length) {
    const size = u32le(b, at + 4)
    const end = at + 8 + size
    const next = end + (size & 1)
    if (end > b.length || next > b.length) return undefined
    if (ascii(b, at, 'VP8X')) {
      if (at !== 12 || canvas || size !== 10) return undefined
      canvas = { width: 1 + u24(at + 12), height: 1 + u24(at + 15) }
      if (!dimensions(canvas.width, canvas.height)) return undefined
      animated = (b[at + 8]! & 2) !== 0
    } else if (ascii(b, at, 'VP8 ') || ascii(b, at, 'VP8L')) {
      if (payload || animated) return undefined
      payload = bitstreamSize(at, size)
      if (!payload || !dimensions(payload.width, payload.height)) return undefined
      if (canvas && (canvas.width !== payload.width || canvas.height !== payload.height)) return undefined
    } else if (ascii(b, at, 'ANMF')) {
      if (!canvas || !animated || size < 24) return undefined
      const frame = { width: 1 + u24(at + 14), height: 1 + u24(at + 17) }
      if (!dimensions(frame.width, frame.height) || u24(at + 8) * 2 + frame.width > canvas.width || u24(at + 11) * 2 + frame.height > canvas.height) return undefined
      let part = at + 24
      let pixels = false
      while (part + 8 <= end) {
        const partSize = u32le(b, part + 4)
        if (partSize > end - part - 8) return undefined
        if (ascii(b, part, 'VP8 ') || ascii(b, part, 'VP8L')) {
          const decoded = bitstreamSize(part, partSize)
          if (pixels || !decoded || decoded.width !== frame.width || decoded.height !== frame.height) return undefined
          pixels = true
        }
        part += 8 + partSize + (partSize & 1)
      }
      if (!pixels || part !== end) return undefined
      frames++
    }
    at = next
  }
  const found = canvas ?? payload
  return at === b.length && found && (animated ? frames > 0 : !!payload) ? { mimeType: 'image/webp' as const, ...found } : undefined
}

export function inspectImageBytes(bytes: Uint8Array): { mimeType: ImageMimeType; width: number; height: number } | undefined {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > IMAGE_MAX_CONTAINER_BYTES) return undefined
  return png(bytes) ?? jpeg(bytes) ?? gif(bytes) ?? webp(bytes)
}

function decodeBase64(data: string): Uint8Array | undefined {
  if (typeof data !== 'string' || !data.length || data.length > Math.ceil(IMAGE_MAX_BYTES / 3) * 4 || data.length % 4 !== 0) return undefined
  try {
    const binary = atob(data); if (btoa(binary) !== data || binary.length > IMAGE_MAX_BYTES) return undefined
    return Uint8Array.from(binary, (c) => c.charCodeAt(0))
  } catch { return undefined }
}

export function isImageSnapshot(value: unknown): value is ImageSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const v = value as Record<string, unknown>
  if (Object.keys(v).length !== 5 || !mime(v.mimeType as string) || typeof v.data !== 'string' || !Number.isSafeInteger(v.width) || !Number.isSafeInteger(v.height) || !Number.isSafeInteger(v.byteLength) || (v.byteLength as number) < 1 || (v.byteLength as number) > IMAGE_MAX_BYTES) return false
  const bytes = decodeBase64(v.data); if (!bytes || bytes.byteLength !== v.byteLength) return false
  const found = inspectImageBytes(bytes)
  return !!found && found.mimeType === v.mimeType && found.width === v.width && found.height === v.height
}
