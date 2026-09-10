import { IMAGE_MAX_CONTAINER_BYTES, IMAGE_MAX_DIMENSION, IMAGE_MAX_PIXELS, inspectImageBytes, type ImageMimeType } from '../../contract/imageInput.ts'

/** Raw local intake only. BMP/ICO never become durable image MIME types.
 * Container admission precedes the sandboxed browser codec; this is not a
 * replacement decoder. DIB layout follows Microsoft's BITMAPINFOHEADER and
 * icon resource formats. Compressed/embedded and OS/2-v2 DIBs are not admitted.
 * https://learn.microsoft.com/en-us/windows/win32/api/wingdi/ns-wingdi-bitmapinfoheader
 * https://learn.microsoft.com/en-us/windows/win32/menurc/resource-file-formats */
export interface LocalRasterInput {
  mimeType: ImageMimeType | 'image/bmp' | 'image/x-icon'
  width: number
  height: number
  bytes: Uint8Array
}

const dimensions = (width: number, height: number) => width > 0 && height > 0 &&
  width <= IMAGE_MAX_DIMENSION && height <= IMAGE_MAX_DIMENSION && width * height <= IMAGE_MAX_PIXELS
const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

function dib(bytes: Uint8Array, start: number, pixelOffset?: number, icon = false) {
  if (bytes.length - start < 12) return undefined
  const data = view(bytes)
  const size = data.getUint32(start, true)
  if (![12, 40, 52, 56, 108, 124].includes(size) || size > bytes.length - start) return undefined
  const core = size === 12
  const width = core ? data.getUint16(start + 4, true) : data.getInt32(start + 4, true)
  const storedHeight = core ? data.getUint16(start + 6, true) : data.getInt32(start + 8, true)
  if (icon && (storedHeight <= 0 || storedHeight % 2)) return undefined
  const height = Math.abs(storedHeight) / (icon ? 2 : 1)
  const planes = data.getUint16(start + (core ? 8 : 12), true)
  const depth = data.getUint16(start + (core ? 10 : 14), true)
  const compression = core ? 0 : data.getUint32(start + 16, true)
  if (!dimensions(width, height) || planes !== 1 || ![1, 4, 8, 16, 24, 32].includes(depth)) return undefined
  // BI_RGB and BI_BITFIELDS cover indexed, true-color and alpha-bearing DIBs.
  // Reject embedded JPEG/PNG, RLE and unknown extensions before any decoding.
  if (compression !== 0 && !(compression === 3 && [16, 32].includes(depth))) return undefined
  if (core && ![1, 4, 8, 24].includes(depth)) return undefined
  let endOfHeader = start + size
  if (compression === 3) {
    const masksAt = start + 40
    if (size === 40) endOfHeader += 12
    if (endOfHeader > bytes.length) return undefined
    const masks = [0, 1, 2].map((i) => data.getUint32(masksAt + i * 4, true))
    if (size >= 56) {
      const alpha = data.getUint32(masksAt + 12, true)
      if (alpha) masks.push(alpha)
    }
    let used = 0
    for (const mask of masks) {
      if (!mask || (depth === 16 && mask > 0xffff) || (used & mask) !== 0) return undefined
      const shifted = mask / ((mask & -mask) >>> 0)
      if ((shifted & (shifted + 1)) !== 0) return undefined
      used |= mask
    }
  }
  const colors = core ? 0 : data.getUint32(start + 32, true)
  if ((depth <= 8 && colors > 2 ** depth) || colors > 256) return undefined
  const palette = (depth <= 8 ? colors || 2 ** depth : colors) * (core ? 3 : 4)
  const pixelsAt = pixelOffset ?? endOfHeader + palette
  if (pixelsAt < endOfHeader + palette || pixelsAt > bytes.length) return undefined
  const pixelBytes = Math.ceil(width * depth / 32) * 4 * height
  const maskBytes = icon ? Math.ceil(width / 32) * 4 * height : 0
  const pixelsEnd = pixelsAt + pixelBytes + maskBytes
  if (pixelsEnd > bytes.length) return undefined
  // V5 profiles are inline file data, never external paths or new read authority.
  if (size === 124) {
    if (data.getUint32(start + 56, true) === 0x4c494e4b) return undefined // PROFILE_LINKED
    const profileAt = data.getUint32(start + 112, true)
    const profileSize = data.getUint32(start + 116, true)
    if ((profileAt === 0) !== (profileSize === 0)) return undefined
    if (profileSize && (start + profileAt < pixelsEnd || profileSize > bytes.length - start - profileAt)) return undefined
  }
  return { width, height, depth }
}

function bitmap(bytes: Uint8Array): LocalRasterInput | undefined {
  if (bytes.length < 26 || bytes[0] !== 0x42 || bytes[1] !== 0x4d) return undefined
  const data = view(bytes)
  if (data.getUint32(2, true) !== bytes.length || data.getUint32(6, true) !== 0) return undefined
  const header = dib(bytes, 14, data.getUint32(10, true))
  return header ? { mimeType: 'image/bmp', width: header.width, height: header.height, bytes } : undefined
}

function icon(bytes: Uint8Array): LocalRasterInput | undefined {
  if (bytes.length < 22) return undefined
  const data = view(bytes)
  const count = data.getUint16(4, true)
  if (data.getUint16(0, true) !== 0 || data.getUint16(2, true) !== 1 || count < 1 || count > 256) return undefined
  const directoryEnd = 6 + count * 16
  if (directoryEnd > bytes.length) return undefined
  const entries: Array<{ at: number; offset: number; length: number; width: number; height: number; depth: number }> = []
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 16
    const width = bytes[at] || 256
    const height = bytes[at + 1] || 256
    const offset = data.getUint32(at + 12, true)
    const length = data.getUint32(at + 8, true)
    if (bytes[at + 3] !== 0 || data.getUint16(at + 4, true) > 1 || !length || offset < directoryEnd || length > bytes.length - offset) return undefined
    entries.push({ at, offset, length, width, height, depth: data.getUint16(at + 6, true) })
  }
  // Check ranges before inspecting any body: aliased entries must not multiply
  // an 8 MiB container walk by the directory count on the renderer thread.
  const ranges = [...entries].sort((a, b) => a.offset - b.offset)
  if (ranges.some((entry, i) => i > 0 && entry.offset < ranges[i - 1]!.offset + ranges[i - 1]!.length)) return undefined
  for (const entry of entries) {
    const { offset, length, width, height } = entry
    const body = bytes.subarray(offset, offset + length)
    const png = inspectImageBytes(body)
    const channels: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }
    const header = png?.mimeType === 'image/png' ? { ...png, depth: body[24]! * channels[body[25]!]! } : dib(body, 0, undefined, true)
    if (!header || header.width !== width || header.height !== height) return undefined
    // PNG's own IHDR owns its depth; icon writers commonly declare 32 here
    // even for an RGB PNG payload. DIB entries must agree with their header.
    if (png?.mimeType !== 'image/png' && entry.depth && entry.depth !== header.depth) return undefined
    entry.depth = header.depth
  }
  // One deterministic preview: largest area, then color depth, then file order.
  // Rebuild a single-entry ICO so the browser cannot choose a different frame.
  entries.sort((a, b) => b.width * b.height - a.width * a.height || b.depth - a.depth || a.at - b.at)
  const selected = entries[0]!
  const output = new Uint8Array(22 + selected.length)
  output.set(bytes.subarray(0, 6))
  output.set(bytes.subarray(selected.at, selected.at + 16), 6)
  output.set(bytes.subarray(selected.offset, selected.offset + selected.length), 22)
  const outputView = view(output)
  outputView.setUint16(4, 1, true)
  outputView.setUint32(18, 22, true)
  return { mimeType: 'image/x-icon', width: selected.width, height: selected.height, bytes: output }
}

export function inspectLocalRaster(bytes: Uint8Array): LocalRasterInput | undefined {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > IMAGE_MAX_CONTAINER_BYTES) return undefined
  const existing = inspectImageBytes(bytes)
  return existing ? { ...existing, bytes } : bitmap(bytes) ?? icon(bytes)
}
