import { deflateSync } from 'node:zlib'

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}
function chunk(type, bytes) {
  const result = Buffer.alloc(bytes.length + 12)
  result.writeUInt32BE(bytes.length)
  result.write(type, 4)
  bytes.copy(result, 8)
  result.writeUInt32BE(crc32(result.subarray(4, -4)), result.length - 4)
  return result
}

/** Real RGB PNG with two colored halves, not an invalid header-only stand-in. */
export function imageFixture(width = 160, height = 80) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 16_000_000) throw new Error('Invalid image fixture dimensions')
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4)
  header[8] = 8; header[9] = 2
  const pixels = Buffer.alloc((1 + width * 3) * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * (1 + width * 3) + 1 + x * 3
    pixels[i] = x < width / 2 ? 240 : 30
    pixels[i + 1] = 70
    pixels[i + 2] = x < width / 2 ? 30 : 240
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))])
}
