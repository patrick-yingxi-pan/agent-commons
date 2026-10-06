import { test } from 'node:test'
import assert from 'node:assert/strict'
import { imageOriginal, isImageOriginal, parseImageAssetUpload } from './imageOriginal.ts'
import { isImageAssetRef, imageAssetRef, imageAssetRefMatches } from './imageAssets.ts'
const data = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
const image = { mimeType: 'image/png' as const, data, width: 1, height: 1, byteLength: 68 }
const original = imageOriginal('source.svg', new TextEncoder().encode('<svg/>'))

test('original bytes are closed, bounded opaque downloads, never normalized image input', () => {
  assert.equal(isImageOriginal(original), true)
  assert.deepEqual(parseImageAssetUpload(image), { image })
  assert.deepEqual(parseImageAssetUpload({ image, original }), { image, original })
  for (const bad of [{ ...original, extra: true }, { ...original, name: '../source.svg' }, { ...original, name: 'x\ny' }, { ...original, byteLength: 9_000_000 }, { ...original, data: '!!!!' }, { ...original, byteLength: 1 }]) assert.equal(isImageOriginal(bad), false)
  assert.equal(parseImageAssetUpload({ image, original: null }), undefined)
  assert.equal(parseImageAssetUpload({ image, original, extra: true }), undefined)
})

test('public image references disclose only original size and bind it to immutable content', () => {
  const ref = imageAssetRef(`img-${'a'.repeat(64)}`, image, original)
  assert.equal(ref.originalByteLength, original.byteLength)
  assert.equal(isImageAssetRef(ref), true)
  assert.equal(imageAssetRefMatches(ref, image, original), true)
  assert.equal(imageAssetRefMatches(ref, image), false)
  assert.equal(imageAssetRefMatches({ ...ref, originalByteLength: 99 }, image, original), false)
  assert.equal(isImageAssetRef({ ...ref, originalByteLength: 0 }), false)
  assert.equal('data' in ref, false)
  assert.equal('name' in ref, false)
})
