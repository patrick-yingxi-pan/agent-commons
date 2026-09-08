import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isImageAssetRef } from './imageAssets.ts'

const valid = { id: `img-${'a'.repeat(64)}`, mimeType: 'image/png', width: 1, height: 1, byteLength: 68 }

test('image asset refs are strict five-field metadata and opaque ids', () => {
  assert.equal(isImageAssetRef(valid), true)
  for (const bad of [
    { ...valid, extra: true },
    { ...valid, id: `img-${'g'.repeat(64)}` },
    { ...valid, byteLength: 0 },
    { ...valid, width: 1.5 },
    { ...valid, mimeType: 'image/svg+xml' },
  ]) assert.equal(isImageAssetRef(bad), false)
})
