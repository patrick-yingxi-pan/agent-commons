import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  IMAGE_MAX_BYTES, IMAGE_MAX_COUNT, IMAGE_MAX_DIMENSION, IMAGE_MAX_PIXELS, IMAGE_TURN_MAX_BYTES,
  inspectImageBytes, isImageSnapshot,
} from './imageInput.ts'

const fromBase64 = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0))
const toBase64 = (value: Uint8Array) => btoa(String.fromCharCode(...value))
const PNG = fromBase64('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=')
const GIF = fromBase64('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==')
const WEBP = fromBase64('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v89WAAAAA==').subarray(0, 42)

function jpeg(width = 1, height = 1) {
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0, 0x11, 8, height >> 8, height & 255, width >> 8, width & 255, 3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0, 0xff, 0xda, 0, 8, 3, 1, 0, 2, 0, 3, 0, 0xff, 0xd9])
}

test('image inspection recognizes bounded PNG, JPEG, GIF, and WebP fixtures', () => {
  assert.deepEqual(inspectImageBytes(PNG), { mimeType: 'image/png', width: 1, height: 1 })
  assert.deepEqual(inspectImageBytes(jpeg()), { mimeType: 'image/jpeg', width: 1, height: 1 })
  assert.deepEqual(inspectImageBytes(GIF), { mimeType: 'image/gif', width: 1, height: 1 })
  assert.deepEqual(inspectImageBytes(WEBP), { mimeType: 'image/webp', width: 1, height: 1 })
})

test('image snapshots require canonical base64, matching magic, dimensions, and byte length', () => {
  const snapshot = { mimeType: 'image/png', data: toBase64(PNG), width: 1, height: 1, byteLength: PNG.byteLength }
  assert.equal(isImageSnapshot(snapshot), true)
  for (const bad of [
    { ...snapshot, data: `${snapshot.data} ` },
    { ...snapshot, data: snapshot.data.toLowerCase() },
    { ...snapshot, mimeType: 'image/jpeg' },
    { ...snapshot, width: 2 },
    { ...snapshot, byteLength: snapshot.byteLength + 1 },
    { ...snapshot, data: toBase64(GIF) },
  ]) assert.equal(isImageSnapshot(bad), false)
})

test('image inspection rejects truncation, malformed containers, oversized dimensions, and limits are explicit', () => {
  assert.equal(inspectImageBytes(PNG.subarray(0, PNG.length - 1)), undefined)
  assert.equal(inspectImageBytes(Uint8Array.from([0, 1, 2, 3])), undefined)
  const huge = PNG.slice(); huge[16] = 0x80; huge[17] = 0x00; huge[18] = 0x00; huge[19] = 0x00
  assert.equal(inspectImageBytes(huge), undefined)
  assert.equal(IMAGE_MAX_BYTES, 3 * 1024 * 1024)
  assert.equal(IMAGE_MAX_DIMENSION, 8000)
  assert.equal(IMAGE_MAX_PIXELS, 32_000_000)
  assert.equal(IMAGE_TURN_MAX_BYTES, 8 * 1024 * 1024)
  assert.equal(IMAGE_MAX_COUNT, 8)
})

test('PNG bit depth and interlace flags are structural variants, not rejection reasons', () => {
  const sixteenBit = PNG.slice()
  sixteenBit[24] = 16
  sixteenBit[28] = 1
  assert.deepEqual(inspectImageBytes(sixteenBit), { mimeType: 'image/png', width: 1, height: 1 })
})

test('malformed GIF dimensions cannot be hidden by a later valid frame descriptor', () => {
  const malformed = GIF.slice()
  malformed[6] = 0; malformed[7] = 0
  assert.equal(inspectImageBytes(malformed), undefined)
  const laterBrokenFrame = new Uint8Array(GIF.length + 5)
  laterBrokenFrame.set(GIF.subarray(0, -1), 0)
  laterBrokenFrame.set([0x2c, 0, 0, 0], GIF.length - 1)
  laterBrokenFrame[laterBrokenFrame.length - 1] = 0x3b
  assert.equal(inspectImageBytes(laterBrokenFrame), undefined)
})

test('a VP8X canvas header without an image payload is not a decodable WebP', () => {
  const chunk = new Uint8Array(18)
  chunk.set([0x56, 0x50, 0x38, 0x58, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
  const webp = new Uint8Array(12 + chunk.length)
  webp.set([0x52, 0x49, 0x46, 0x46, 22, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])
  webp.set(chunk, 12)
  assert.equal(inspectImageBytes(webp), undefined)
})

test('an oversized VP8X canvas cannot be hidden by a later small VP8 frame', () => {
  const vp8x = new Uint8Array(18)
  vp8x.set([0x56, 0x50, 0x38, 0x58, 10, 0, 0, 0, 0, 0, 0, 0, 0x27, 0x23, 0, 0, 0, 0])
  const vp8 = new Uint8Array(30)
  vp8.set([0x56, 0x50, 0x38, 0x20, 22, 0, 0, 0, 0x9d, 0x01, 0x2a, 0, 0, 0, 1, 0, 1, 0])
  const webp = new Uint8Array(12 + vp8x.length + vp8.length)
  webp.set([0x52, 0x49, 0x46, 0x46, webp.length - 8, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])
  webp.set(vp8x, 12); webp.set(vp8, 12 + vp8x.length)
  assert.equal(inspectImageBytes(webp), undefined)
})
