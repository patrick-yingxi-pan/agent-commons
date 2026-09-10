import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decodeSvgImage } from './svgImage.ts'

type Fake = FakeImage
class FakeImage {
  static instances: FakeImage[] = []
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  naturalWidth = 0
  naturalHeight = 0
  src = ''
  removed = 0
  constructor() { FakeImage.instances.push(this) }
  removeAttribute(name: string) { if (name === 'src') { this.removed++; this.src = '' } }
}

async function withFakeImage<T>(body: (state: { created: Blob[]; revoked: string[] }) => Promise<T>): Promise<T> {
  const oldImage = globalThis.Image
  const oldCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
  const oldRevoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
  const created: Blob[] = []
  const revoked: string[] = []
  FakeImage.instances = []
  Object.defineProperty(globalThis, 'Image', { configurable: true, writable: true, value: FakeImage })
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: (blob: Blob) => { created.push(blob); return `blob:svg-${created.length}` } })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: (url: string) => { revoked.push(url) } })
  try { return await body({ created, revoked }) } finally {
    if (oldImage === undefined) delete (globalThis as { Image?: unknown }).Image
    else Object.defineProperty(globalThis, 'Image', { configurable: true, writable: true, value: oldImage })
    if (oldCreate) Object.defineProperty(URL, 'createObjectURL', oldCreate)
    else delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL
    if (oldRevoke) Object.defineProperty(URL, 'revokeObjectURL', oldRevoke)
    else delete (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL
  }
}

const blob = () => new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="2" height="3"/>'], { type: 'image/svg+xml' })

test('successful SVG decoding retains its drawable source until close, then releases once', async () => {
  await withFakeImage(async ({ revoked }) => {
    const controller = new AbortController()
    const pending = decodeSvgImage(blob(), controller.signal)
    const image = FakeImage.instances[0]!
    assert.equal(image.src, 'blob:svg-1')
    image.naturalWidth = 160; image.naturalHeight = 80; image.onload?.()
    const decoded = await pending
    assert.equal(decoded.source, image)
    assert.equal(image.removed, 0)
    decoded.close(); decoded.close()
    assert.equal(image.removed, 1)
    assert.deepEqual(revoked, ['blob:svg-1'])
  })
})

test('abort releases a pending image once and a late load cannot resolve it', async () => {
  await withFakeImage(async () => {
    const controller = new AbortController()
    const pending = decodeSvgImage(blob(), controller.signal)
    const image = FakeImage.instances[0]!
    controller.abort()
    await assert.rejects(pending, /cancelled|failed/i)
    image.naturalWidth = 2; image.naturalHeight = 2; image.onload?.()
    assert.equal(image.removed, 1)
  })
})

test('image errors and zero natural dimensions reject and release their object URLs', async () => {
  await withFakeImage(async () => {
    const error = decodeSvgImage(blob(), new AbortController().signal)
    FakeImage.instances[0]!.onerror?.()
    await assert.rejects(error, /failed/i)
    assert.equal(FakeImage.instances[0]!.removed, 1)

    const zero = decodeSvgImage(blob(), new AbortController().signal)
    FakeImage.instances[1]!.onload?.()
    await assert.rejects(zero, /failed/i)
    assert.equal(FakeImage.instances[1]!.removed, 1)
  })
})

test('already-aborted input allocates neither Image nor object URL', async () => {
  await withFakeImage(async () => {
    const controller = new AbortController(); controller.abort()
    await assert.rejects(decodeSvgImage(blob(), controller.signal), /cancelled/i)
    assert.equal(FakeImage.instances.length, 0)
  })
})

test('successful close and aborted failure each revoke their exact object URL once', async () => {
  await withFakeImage(async ({ revoked }) => {
    const controller = new AbortController()
    const pending = decodeSvgImage(blob(), controller.signal)
    const image = FakeImage.instances[0]!
    image.naturalWidth = 1; image.naturalHeight = 1; image.onload?.()
    const decoded = await pending
    decoded.close(); decoded.close()
    assert.equal(image.removed, 1)

    const secondController = new AbortController()
    const second = decodeSvgImage(blob(), secondController.signal)
    secondController.abort()
    await assert.rejects(second)
    assert.equal(FakeImage.instances[1]!.removed, 1)
    assert.deepEqual(revoked, ['blob:svg-1', 'blob:svg-2'])
  })
})
