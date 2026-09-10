import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ImageImportError, importImage } from './imageImport.ts'
import { IMAGE_MAX_BYTES } from '../../contract/imageInput.ts'
import { imageFixture } from '../../tests/helpers/imageFixture.mjs'
import { bitmapFixture, iconFixture } from '../../tests/helpers/bitmapFixture.mjs'

const png = (): Uint8Array => new Uint8Array(imageFixture(2, 2))

test('normalizes a decoded image to a bounded PNG snapshot and closes the bitmap', async () => {
  let closed = false
  const source = png()
  const result = await importImage(source, undefined, {
    decode: async () => ({ width: 2, height: 2, close: () => { closed = true } }),
    canvas: () => ({ width: 2, height: 2, getContext: () => ({ drawImage: () => {} } as unknown as CanvasRenderingContext2D), toBlob: (cb: (blob: Blob | null) => void) => cb(new Blob([source], { type: 'image/png' })) }),
  })
  assert.equal(result.mimeType, 'image/png')
  assert.equal(result.width, 2)
  assert.equal(result.height, 2)
  assert.equal(result.byteLength, source.byteLength)
  assert.equal(closed, true)
})

test('rejects malformed, oversized, and aborted input before decoding', async () => {
  let decoded = false
  await assert.rejects(() => importImage(new Uint8Array([1, 2, 3]), undefined, { decode: async () => { decoded = true; return { width: 1, height: 1 } } }), (error: unknown) => error instanceof ImageImportError && error.reason === 'invalid')
  assert.equal(decoded, false)
  const controller = new AbortController(); controller.abort()
  await assert.rejects(() => importImage(png(), controller.signal), (error: unknown) => error instanceof ImageImportError && error.reason === 'aborted')
})

test('rejects BMP and ICO decoded dimensions that disagree with their admitted container headers', async () => {
  for (const source of [bitmapFixture(2, 2), iconFixture(2, 2, { png: true })]) {
    await assert.rejects(() => importImage(source, undefined, {
      decode: async () => ({ width: 3, height: 2 }),
    }), (error: unknown) => error instanceof ImageImportError && error.reason === 'invalid')
  }
})

test('ICO cancellation and deadline close late decoded bitmaps', async () => {
  for (const mode of ['abort', 'timeout'] as const) {
    let release!: (bitmap: { width: number; height: number; close: () => void }) => void
    let closed = false
    const pending = new Promise<{ width: number; height: number; close: () => void }>((resolve) => { release = resolve })
    const controller = new AbortController()
    const promise = importImage(iconFixture(2, 2, { png: true }), mode === 'abort' ? controller.signal : undefined, {
      timeoutMs: mode === 'timeout' ? 5 : 15_000,
      decode: async () => pending,
    })
    if (mode === 'abort') controller.abort()
    await assert.rejects(() => promise, (error: unknown) => error instanceof ImageImportError && error.reason === (mode === 'abort' ? 'aborted' : 'timeout'))
    release({ width: 2, height: 2, close: () => { closed = true } })
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(closed, true, mode)
  }
})

test('timeout and abort close late bitmaps and do not wait for an unabortable decoder', async () => {
  let release!: (bitmap: { width: number; height: number; close: () => void }) => void
  let closed = false
  const pending = new Promise<{ width: number; height: number; close: () => void }>((resolve) => { release = resolve })
  await assert.rejects(() => importImage(png(), undefined, { timeoutMs: 5, decode: async () => pending }), /too long/)
  release({ width: 2, height: 2, close: () => { closed = true } })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(closed, true)
})

test('abort during encoding wins and conversion is supported', async () => {
  const controller = new AbortController()
  let converted = false
  await assert.rejects(() => importImage(png(), controller.signal, {
    decode: async () => ({ width: 2, height: 2, close() {} }),
    canvas: () => ({ width: 2, height: 2, getContext: () => ({ drawImage() {} }), convertToBlob: async () => {
      converted = true; controller.abort(); return new Blob([png()], { type: 'image/png' })
    } }),
  }), (error: unknown) => error instanceof ImageImportError && error.reason === 'aborted')
  assert.equal(converted, true)
})

test('oversized output retries at smaller dimensions and unavailable decoder is explicit', async () => {
  const dimensions: Array<[number, number]> = []
  let attempt = 0
  const result = await importImage(png(8, 4), undefined, {
    decode: async () => ({ width: 8, height: 4, close() {} }),
    canvas: (width, height) => ({ width, height, getContext: () => ({ drawImage() { dimensions.push([width, height]) } }), toBlob: (cb) => {
      attempt++
      cb(attempt < 3 ? new Blob([new Uint8Array(IMAGE_MAX_BYTES + 1)], { type: 'image/png' }) : new Blob([imageFixture(width, height)], { type: 'image/png' }))
    } }),
  })
  assert.equal(result.width, dimensions.at(-1)?.[0])
  assert.ok(dimensions.length >= 3)
  const previous = globalThis.createImageBitmap
  try {
    delete globalThis.createImageBitmap
    await assert.rejects(() => importImage(png()), (error: unknown) => error instanceof ImageImportError && error.reason === 'decode-failed')
  } finally {
    globalThis.createImageBitmap = previous
  }
})
