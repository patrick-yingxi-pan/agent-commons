import test from 'node:test'
import assert from 'node:assert/strict'
import { createPresentationImporter } from './presentationImport.ts'

function workerHarness(result: unknown, seen: { request?: unknown } = {}) {
  return async () => () => {
    const worker = {
      postMessage(request: unknown) { seen.request = request; queueMicrotask(() => worker.onmessage?.({ data: result })) },
      terminate() {}, onmessage: undefined as ((event: MessageEvent) => void) | null, onerror: null, onmessageerror: null,
    }
    return worker as unknown as Worker
  }
}

test('presentation importer sends a distinct structural worker job and validates the detached result', async () => {
  const seen: { request?: unknown } = {}
  const result = await createPresentationImporter(workerHarness({
    documentImport: { format: 'pptx', status: 'ready' },
    presentation: { totalSlides: 2, hiddenSlides: 0, slides: [{ sourceSlide: 1, paragraphs: ['Title'] }, { sourceSlide: 2, paragraphs: [] }] },
  }, seen))(new Uint8Array([1, 2, 3]))
  assert.equal((seen.request as { format: string }).format, 'pptx-presentation')
  assert.deepEqual(result.presentation?.slides[1]?.paragraphs, [])
})

test('cancellation and malformed late worker results fail closed', async () => {
  const controller = new AbortController()
  controller.abort()
  assert.equal((await createPresentationImporter(workerHarness({}))(new Uint8Array([1]), controller.signal)).documentImport.status, 'unavailable')
  const malformed = await createPresentationImporter(workerHarness({ documentImport: { format: 'pptx', status: 'text-limit' }, presentation: { totalSlides: 1, hiddenSlides: 0, slides: [] } }))(new Uint8Array([1]))
  assert.equal(malformed.documentImport.status, 'invalid')
})

test('a worker result arriving after cancellation cannot replace the unavailable result', async () => {
  let worker: Worker | undefined
  const load = async () => () => {
    const created = { postMessage() {}, terminate() {}, onmessage: null, onerror: null, onmessageerror: null } as unknown as Worker
    worker = created
    return created
  }
  const controller = new AbortController()
  const pending = createPresentationImporter(load)(new Uint8Array([1]), controller.signal)
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  controller.abort()
  const result = await pending
  worker?.onmessage?.({ data: { documentImport: { format: 'pptx', status: 'ready' }, presentation: { totalSlides: 1, hiddenSlides: 0, slides: [{ sourceSlide: 1, paragraphs: ['late'] }] } } } as MessageEvent)
  assert.equal(result.documentImport.status, 'unavailable')
})
