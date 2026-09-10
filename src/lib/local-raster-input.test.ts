import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bitmapFixture, iconFixture, multiIconFixture } from '../../tests/helpers/bitmapFixture.mjs'
import { isImageSnapshot } from '../../contract/imageInput.ts'
import { inspectLocalRaster } from './localRasterInput.ts'

const copy = (bytes: Uint8Array) => new Uint8Array(bytes)
const u16 = (bytes: Uint8Array, at: number) => bytes[at]! | (bytes[at + 1]! << 8)
const setU16 = (bytes: Uint8Array, at: number, value: number) => { bytes[at] = value & 255; bytes[at + 1] = value >>> 8 }
const setU32 = (bytes: Uint8Array, at: number, value: number) => {
  bytes[at] = value & 255; bytes[at + 1] = (value >>> 8) & 255; bytes[at + 2] = (value >>> 16) & 255; bytes[at + 3] = (value >>> 24) & 255
}

test('admits supported BMP depths, orientations, and V4/V5 bitfields', () => {
  for (const bitDepth of [1, 4, 8, 24]) {
    assert.equal(inspectLocalRaster(bitmapFixture(17, 9, { bitDepth, headerSize: 12 }))?.width, 17)
  }
  for (const bitDepth of [1, 4, 8, 16, 24, 32]) {
    const found = inspectLocalRaster(bitmapFixture(17, 9, { bitDepth }))
    assert.deepEqual(found && { mimeType: found.mimeType, width: found.width, height: found.height }, { mimeType: 'image/bmp', width: 17, height: 9 })
  }
  for (const headerSize of [40, 52, 56, 108, 124]) {
    const found = inspectLocalRaster(bitmapFixture(17, 9, { bitDepth: 32, compression: 3, headerSize, topDown: true }))
    assert.deepEqual(found && { mimeType: found.mimeType, width: found.width, height: found.height }, { mimeType: 'image/bmp', width: 17, height: 9 })
  }
})

test('admits DIB, PNG, and mixed ICOs while selecting the largest frame', () => {
  for (const bytes of [iconFixture(32, 24), iconFixture(32, 24, { png: true })]) {
    const found = inspectLocalRaster(bytes)
    assert.deepEqual(found && { mimeType: found.mimeType, width: found.width, height: found.height }, { mimeType: 'image/x-icon', width: 32, height: 24 })
    assert.equal(u16(found!.bytes, 4), 1)
  }
  const mixed = inspectLocalRaster(multiIconFixture([
    { width: 16, height: 16, png: true },
    { width: 48, height: 32 },
    { width: 32, height: 32, png: true },
  ]))
  assert.deepEqual(mixed && { width: mixed.width, height: mixed.height }, { width: 48, height: 32 })
  assert.equal(u16(mixed!.bytes, 4), 1)
  assert.equal(new DataView(mixed!.bytes.buffer, mixed!.bytes.byteOffset, mixed!.bytes.byteLength).getUint32(18, true), 22)
})

test('ICO ties prefer actual color depth, then directory order regardless of body offset', () => {
  const mixed = multiIconFixture([{ width: 16, height: 16, png: true }, { width: 16, height: 16 }])
  // The PNG is RGB (24-bit), although its directory declares 32 bits.
  assert.deepEqual(inspectLocalRaster(mixed)?.bytes, copy(iconFixture(16, 16)))

  const tied = copy(multiIconFixture([{ width: 16, height: 16 }, { width: 16, height: 16 }]))
  const data = new DataView(tied.buffer)
  const firstOffset = data.getUint32(18, true)
  const secondOffset = data.getUint32(34, true)
  const length = data.getUint32(14, true)
  tied[secondOffset + 40] ^= 0xff // Distinct, still valid pixel data in the second DIB.
  assert.deepEqual(inspectLocalRaster(tied)?.bytes.subarray(22), tied.subarray(firstOffset, firstOffset + length))
  const directory = tied.slice(6, 38)
  tied.set(directory.subarray(16), 6)
  tied.set(directory.subarray(0, 16), 22)
  assert.deepEqual(inspectLocalRaster(tied)?.bytes.subarray(22), tied.subarray(secondOffset, secondOffset + length))
})

test('V5 profiles stay inline and bounded, and linked color spaces are rejected', () => {
  const base = bitmapFixture(2, 2, { headerSize: 124 })
  const embedded = new Uint8Array(base.length + 8)
  embedded.set(base)
  setU32(embedded, 2, embedded.length)
  // bV5CSType is offset 56; bV5Intent at 108 is a separate rendering intent.
  // https://learn.microsoft.com/en-us/windows/win32/api/wingdi/ns-wingdi-bitmapv5header
  setU32(embedded, 14 + 56, 0x4d424544) // PROFILE_EMBEDDED, not raw ASCII bytes.
  setU32(embedded, 14 + 108, 4)
  setU32(embedded, 14 + 112, base.length - 14)
  setU32(embedded, 14 + 116, 8)
  assert.equal(inspectLocalRaster(embedded)?.width, 2, 'container bounds only; the codec validates the ICC body')
  const linked = copy(embedded); setU32(linked, 14 + 56, 0x4c494e4b)
  assert.equal(inspectLocalRaster(linked), undefined)
  const overlap = copy(embedded); setU32(overlap, 14 + 112, base.length - 15)
  assert.equal(inspectLocalRaster(overlap), undefined)
  const overflow = copy(embedded); setU32(overflow, 14 + 116, 9)
  assert.equal(inspectLocalRaster(overflow), undefined)
  const missingOffset = copy(embedded); setU32(missingOffset, 14 + 112, 0)
  assert.equal(inspectLocalRaster(missingOffset), undefined)
})

test('rejects truncated and structurally malformed BMP containers', () => {
  const valid = bitmapFixture(8, 8, { bitDepth: 24 })
  assert.equal(inspectLocalRaster(valid.subarray(0, valid.length - 1)), undefined)

  const badDimensions = copy(valid); setU32(badDimensions, 18, 8001)
  assert.equal(inspectLocalRaster(badDimensions), undefined)
  const badCompression = copy(valid); setU32(badCompression, 30, 2)
  assert.equal(inspectLocalRaster(badCompression), undefined)

  const badPalette = bitmapFixture(8, 8, { bitDepth: 4 })
  setU32(badPalette, 46, 17)
  assert.equal(inspectLocalRaster(badPalette), undefined)

  const badMasks = copy(bitmapFixture(8, 8, { bitDepth: 32, compression: 3, headerSize: 108 }))
  setU32(badMasks, 54, 0x00ff0000)
  setU32(badMasks, 58, 0x00ff0000)
  assert.equal(inspectLocalRaster(badMasks), undefined)
})

test('rejects malformed ICO directories, cursors, overlap, dimensions, and bodies', () => {
  const valid = multiIconFixture([{ width: 16, height: 16 }, { width: 32, height: 24, png: true }])
  assert.equal(inspectLocalRaster(valid.subarray(0, valid.length - 1)), undefined)

  const cursor = copy(valid); setU16(cursor, 2, 2)
  assert.equal(inspectLocalRaster(cursor), undefined)
  const mismatch = copy(valid); mismatch[6] = 15
  assert.equal(inspectLocalRaster(mismatch), undefined)
  const overlap = copy(multiIconFixture([{ width: 16, height: 16, png: true }, { width: 16, height: 16, png: true }]))
  setU32(overlap, 34, 38) // Two individually valid entries address the same PNG.
  assert.equal(inspectLocalRaster(overlap), undefined)
  const badLength = copy(valid); setU32(badLength, 22, badLength.length)
  assert.equal(inspectLocalRaster(badLength), undefined)
  const badDirectory = copy(valid); setU32(badDirectory, 18, 5)
  assert.equal(inspectLocalRaster(badDirectory), undefined)
})

test('rejects oversized containers and keeps BMP/ICO outside durable image snapshots', () => {
  const bmp = bitmapFixture(2, 2)
  const oversized = new Uint8Array(8 * 1024 * 1024 + 1)
  assert.equal(inspectLocalRaster(oversized), undefined)
  assert.equal(isImageSnapshot({ mimeType: 'image/bmp', data: bmp.toString('base64'), width: 2, height: 2, byteLength: bmp.length }), false)
  const ico = iconFixture(2, 2)
  assert.equal(isImageSnapshot({ mimeType: 'image/x-icon', data: ico.toString('base64'), width: 2, height: 2, byteLength: ico.length }), false)
})
