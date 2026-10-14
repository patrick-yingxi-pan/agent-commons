import { test } from 'node:test'
import assert from 'node:assert/strict'
import { IMAGE_MAX_BYTES } from '../../contract/imageInput.ts'
import { imageOriginal } from '../../contract/imageOriginal.ts'
import { imageFixture } from '../../tests/helpers/imageFixture.mjs'
import { prepareLocalFilePreview } from './localFilePreview.ts'

const png = new Uint8Array(imageFixture(2, 2))
const normalized = {
  mimeType: 'image/png', data: Buffer.from(png).toString('base64'), width: 2, height: 2, byteLength: png.byteLength,
}
const imageNative = (bytes = new Uint8Array([9, 8, 7])) => ({
  version: 1 as const, path: 'assets/source.png', sizeBytes: bytes.byteLength, snapshot: { image: { bytes } },
})

test('selected image alone loads the lazy importer and publishes a detached PNG plus exact basename-only original', async () => {
  let loads = 0
  const importer = async () => {
    loads++
    return async () => normalized
  }
  const signal = new AbortController().signal
  const text = await prepareLocalFilePreview({ version: 1, path: 'notes.txt', sizeBytes: 0, snapshot: { text: '' } }, signal, undefined, importer)
  assert.deepEqual(text.snapshot, { text: '' })
  assert.equal(loads, 0)
  const image = await prepareLocalFilePreview(imageNative(), signal, undefined, importer)
  assert.deepEqual(image.snapshot, { image: normalized, original: imageOriginal('source.png', new Uint8Array([9, 8, 7])) })
  assert.equal(loads, 1)
  assert.equal(image.imageFailure, undefined)
  assert.equal(image.snapshot.original.name.includes('/'), false)
  assert.equal('bytes' in image.snapshot, false)
})

test('only closed, clone-stable normalized PNG snapshots within byte and edge bounds enter preview state', async () => {
  const malformed = [
    { ...normalized, extra: true },
    Object.defineProperty({ ...normalized }, 'data', { enumerable: true, get: () => normalized.data }),
    { ...normalized, mimeType: 'image/jpeg' },
    { ...normalized, width: 2001 },
    { ...normalized, byteLength: IMAGE_MAX_BYTES + 1 },
    { ...normalized, data: 'not base64' },
  ]
  for (const candidate of malformed) {
    const result = await prepareLocalFilePreview(imageNative(), new AbortController().signal, undefined,
      async () => async () => candidate)
    assert.deepEqual(result.snapshot, { omitted: 'image-import' })
    assert.equal(result.imageFailure, 'invalid')
  }
  const result = await prepareLocalFilePreview(imageNative(), new AbortController().signal, undefined,
    async () => async () => normalized)
  assert.notEqual(result.snapshot.image, normalized)
})

test('image import failures disclose closed reasons and never turn raw bytes into a preview', async () => {
  for (const [reason, expected] of [
    ['too-large', 'too-large'], ['invalid', 'invalid'], ['decode-failed', 'decode-failed'],
    ['timeout', 'timeout'], ['unavailable', 'unavailable'], ['mystery', 'unavailable'],
  ] as const) {
    const error = Object.assign(new Error('private details'), { name: 'ImageImportError', reason })
    const result = await prepareLocalFilePreview(imageNative(), new AbortController().signal, undefined,
      async () => async () => { throw error })
    assert.deepEqual(result.snapshot, { omitted: 'image-import' })
    assert.equal(result.imageFailure, expected)
    assert.equal(JSON.stringify(result).includes('private details'), false)
  }
})

test('native image size and read omissions become explicit image failures without loading the importer', async () => {
  let loads = 0
  const importer = async () => { loads++; return async () => normalized }
  for (const [omitted, expected] of [['too-large', 'too-large'], ['unreadable', 'unavailable']] as const) {
    const result = await prepareLocalFilePreview({
      version: 1, path: 'assets/source.png', sizeBytes: IMAGE_MAX_BYTES + 1, snapshot: { omitted },
    }, new AbortController().signal, undefined, importer)
    assert.deepEqual(result.snapshot, { omitted: 'image-import' })
    assert.equal(result.imageFailure, expected)
  }
  assert.equal(loads, 0)
})

test('abort before or during lazy image loading settles immediately and prevents late decoder work', async () => {
  const before = new AbortController(); before.abort()
  await assert.rejects(prepareLocalFilePreview(imageNative(), before.signal, undefined,
    async () => { assert.fail('aborted selection must not load the importer') }))

  const controller = new AbortController()
  let finish!: (value: (bytes: Uint8Array, signal?: AbortSignal) => Promise<unknown>) => void
  let decoded = false
  const operation = prepareLocalFilePreview(imageNative(), controller.signal, undefined,
    () => new Promise(resolve => { finish = resolve }))
  controller.abort()
  const settled = await Promise.race([operation.then(() => 'resolved', () => 'aborted'), new Promise(resolve => setImmediate(() => resolve('pending')))])
  finish(async () => { decoded = true; return normalized })
  await assert.rejects(operation)
  assert.equal(settled, 'aborted')
  assert.equal(decoded, false)
})

test('abort during image normalization cannot publish a late snapshot', async () => {
  const controller = new AbortController()
  const operation = prepareLocalFilePreview(imageNative(), controller.signal, undefined,
    async () => async () => new Promise(resolve => { controller.abort(); resolve(normalized) }))
  await assert.rejects(operation)
})

test('the projection has no upload path', async () => {
  const source = await import('node:fs/promises').then(fs => fs.readFile(new URL('./localFilePreview.ts', import.meta.url), 'utf8'))
  assert.equal(source.includes('uploadImageSnapshot'), false)
})
