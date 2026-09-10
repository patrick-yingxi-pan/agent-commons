import { imageFixture } from './imageFixture.mjs'

const BI_RGB = 0
const BI_BITFIELDS = 3

function assertDimensions(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 16_000_000) {
    throw new Error('Invalid bitmap fixture dimensions')
  }
}

function assertOptions(bitDepth, headerSize, compression, topDown) {
  if (![1, 4, 8, 16, 24, 32].includes(bitDepth)) throw new Error('Unsupported bitmap fixture depth')
  if (![12, 40, 52, 56, 108, 124].includes(headerSize)) throw new Error('Unsupported bitmap fixture header')
  if (headerSize === 12 && (topDown || compression !== BI_RGB || ![1, 4, 8, 24].includes(bitDepth))) throw new Error('Unsupported CORE bitmap fixture')
  if (compression !== BI_RGB && compression !== BI_BITFIELDS) throw new Error('Unsupported bitmap fixture compression')
  if (compression === BI_BITFIELDS && ![16, 32].includes(bitDepth)) throw new Error('Bitfields require 16 or 32 bits')
}

function colorAt(x, width) {
  return x < width / 2 ? [240, 70, 30] : [30, 70, 240]
}

function rowStride(width, bitDepth) {
  return Math.ceil((width * bitDepth) / 32) * 4
}

function writePixel(row, x, width, bitDepth) {
  const [red, green, blue] = colorAt(x, width)
  if (bitDepth === 1) {
    if (red > blue) row[x >> 3] |= 0x80 >> (x & 7)
    return
  }
  if (bitDepth === 4) {
    const value = red > blue ? 1 : 2
    const offset = x >> 1
    row[offset] |= (x & 1) ? value : value << 4
    return
  }
  if (bitDepth === 8) {
    row[x] = red > blue ? 1 : 2
    return
  }
  if (bitDepth === 16) {
    const value = ((red >> 3) << 10) | ((green >> 3) << 5) | (blue >> 3)
    row.writeUInt16LE(value, x * 2)
    return
  }
  const offset = x * (bitDepth / 8)
  row[offset] = blue
  row[offset + 1] = green
  row[offset + 2] = red
  if (bitDepth === 32) row[offset + 3] = 255
}

/** A real, deterministic two-color BMP with a populated DIB and pixel rows. */
export function bitmapFixture(width = 160, height = 80, { bitDepth = 24, topDown = false, headerSize = 40, compression = 0 } = {}) {
  assertDimensions(width, height)
  assertOptions(bitDepth, headerSize, compression, topDown)
  const core = headerSize === 12
  const paletteEntries = bitDepth <= 8 ? 1 << bitDepth : 0
  const paletteBytes = paletteEntries * (core ? 3 : 4)
  // BITMAPV4/V5 keep RGB(A) masks inside their extended header; only the
  // 40-byte BITMAPINFOHEADER appends them after the header.
  const masksBytes = compression === BI_BITFIELDS && headerSize === 40 ? 12 : 0
  const stride = rowStride(width, bitDepth)
  const pixelsBytes = stride * height
  const pixelOffset = 14 + headerSize + paletteBytes + masksBytes
  const result = Buffer.alloc(pixelOffset + pixelsBytes)

  result.write('BM', 0, 2, 'ascii')
  result.writeUInt32LE(result.length, 2)
  result.writeUInt32LE(pixelOffset, 10)
  result.writeUInt32LE(headerSize, 14)
  if (core) {
    result.writeUInt16LE(width, 18); result.writeUInt16LE(height, 20)
    result.writeUInt16LE(1, 22); result.writeUInt16LE(bitDepth, 24)
  } else {
    result.writeInt32LE(width, 18)
    result.writeInt32LE(topDown ? -height : height, 22)
    result.writeUInt16LE(1, 26)
    result.writeUInt16LE(bitDepth, 28)
    result.writeUInt32LE(compression, 30)
    result.writeUInt32LE(pixelsBytes, 34)
    result.writeInt32LE(2835, 38); result.writeInt32LE(2835, 42)
    result.writeUInt32LE(paletteEntries, 46)
    result.writeUInt32LE(paletteEntries, 50)
  }

  if (paletteEntries) {
    const palette = [[30, 70, 240], [240, 70, 30], [30, 70, 240]]
    for (let i = 0; i < paletteEntries; i++) {
      const [r, g, b] = palette[i] ?? [i, i, i]
      const offset = 14 + headerSize + i * (core ? 3 : 4)
      result[offset] = b; result[offset + 1] = g; result[offset + 2] = r
    }
  }
  if (compression === BI_BITFIELDS) {
    const maskOffset = 14 + 40
    result.writeUInt32LE(bitDepth === 16 ? 0x7c00 : 0x00ff0000, maskOffset)
    result.writeUInt32LE(bitDepth === 16 ? 0x03e0 : 0x0000ff00, maskOffset + 4)
    result.writeUInt32LE(bitDepth === 16 ? 0x001f : 0x000000ff, maskOffset + 8)
  }
  for (let y = 0; y < height; y++) {
    const row = result.subarray(pixelOffset + y * stride, pixelOffset + (y + 1) * stride)
    for (let x = 0; x < width; x++) writePixel(row, x, width, bitDepth)
  }
  return result
}

function iconDib(width, height) {
  const stride = width * 4
  const xor = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const [r, g, b] = colorAt(x, width)
    const offset = (height - 1 - y) * stride + x * 4
    xor[offset] = b; xor[offset + 1] = g; xor[offset + 2] = r; xor[offset + 3] = 255
  }
  const andStride = Math.ceil(width / 32) * 4
  return Buffer.concat([(() => {
    const dib = Buffer.alloc(40)
    dib.writeUInt32LE(40, 0); dib.writeInt32LE(width, 4); dib.writeInt32LE(height * 2, 8)
    dib.writeUInt16LE(1, 12); dib.writeUInt16LE(32, 14); dib.writeUInt32LE(0, 16)
    dib.writeUInt32LE(xor.length, 20); dib.writeInt32LE(2835, 24); dib.writeInt32LE(2835, 28)
    return dib
  })(), xor, Buffer.alloc(andStride * height)])
}

function icoEntry(bytes, width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || width > 256 || height < 1 || height > 256) {
    throw new Error('Invalid icon fixture dimensions')
  }
  const entry = Buffer.alloc(16)
  entry[0] = width >= 256 ? 0 : width; entry[1] = height >= 256 ? 0 : height
  entry[2] = 0; entry[3] = 0; entry.writeUInt16LE(1, 4); entry.writeUInt16LE(32, 6)
  entry.writeUInt32LE(bytes.length, 8); return entry
}

/** A real ICO containing either a PNG image or a DIB with XOR pixels and an AND mask. */
export function iconFixture(width = 32, height = 32, { png = false } = {}) {
  return multiIconFixture([{ width, height, png }])
}

/** Build a deterministic ICO containing one or more PNG/DIB entries. */
export function multiIconFixture(entries) {
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > 20) throw new Error('Invalid icon fixture entries')
  const bodies = entries.map((entry) => {
    const width = entry?.width ?? 32; const height = entry?.height ?? 32
    assertDimensions(width, height)
    return entry?.png ? imageFixture(width, height) : iconDib(width, height)
  })
  const header = Buffer.alloc(6); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(bodies.length, 4)
  let offset = 6 + bodies.length * 16
  const directory = Buffer.concat(entries.map((entry, index) => {
    const width = entry?.width ?? 32; const height = entry?.height ?? 32
    const item = icoEntry(bodies[index], width, height); item.writeUInt32LE(offset, 12); offset += bodies[index].length; return item
  }))
  return Buffer.concat([header, directory, ...bodies])
}
