import { test } from 'node:test'
import assert from 'node:assert/strict'
import { imageFixture } from '../../tests/helpers/imageFixture.mjs'
import { imageOriginal } from '../../contract/imageOriginal.ts'
import { isImageSnapshot } from '../../contract/imageInput.ts'
import { localPreviewImageImport } from './localPreviewImageImport.ts'
import { reviewArtifactImageImport } from './artifactImageImport.ts'

const png = imageFixture(160, 80)
const image = { mimeType: 'image/png' as const, width: 160, height: 80, byteLength: png.length, data: png.toString('base64') }
const preview = { version: 1 as const, path: 'private/scan.notes.png', sizeBytes: 3,
  snapshot: { image, original: imageOriginal('scan.notes.png', new Uint8Array([1, 2, 3])) } }

test('connected image review detaches only the normalized PNG and leaf name, never source authority or original', async () => {
  const seed = localPreviewImageImport(preview)!
  assert.ok(seed)
  assert.deepEqual(Object.keys(seed).sort(), ['id', 'imageInput', 'kind', 'name'])
  assert.equal(seed.name, 'scan.notes.png')
  assert.notEqual(seed.imageInput, image)
  assert.deepEqual(seed.imageInput, image)
  const result = await reviewArtifactImageImport([seed], new AbortController().signal, async bytes => {
    assert.deepEqual(Buffer.from(bytes), png)
    return { status: 'ready', text: 'Captured text\nSecond line' }
  })
  assert.equal(result.status, 'ready')
  assert.equal(result.name, 'scan.notes.md')
  assert.equal(result.text, 'Captured text\nSecond line')
  assert.equal(JSON.stringify(result).includes(image.data), false)
})

test('only normalized bounded PNG previews can seed image OCR', () => {
  const oversizedPng = imageFixture(2001, 80)
  const oversized = { mimeType: 'image/png' as const, width: 2001, height: 80,
    byteLength: oversizedPng.length, data: oversizedPng.toString('base64') }
  assert.equal(isImageSnapshot(oversized), true, 'a valid source image can exceed the normalized OCR edge bound')
  assert.equal(localPreviewImageImport(null), null)
  for (const snapshot of [{ text: 'text is not an image' }, { omitted: 'image-import' },
    { ...preview.snapshot, image: { ...image, data: 'invalid' } },
    { ...preview.snapshot, image: { ...image, mimeType: 'image/jpeg' } },
    { ...preview.snapshot, image: oversized },
  ]) assert.equal(localPreviewImageImport({ ...preview, snapshot } as never), null)
})
