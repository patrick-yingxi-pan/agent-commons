import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPptxImporter } from './pptxImport.ts'
import { MAX_PPTX_FILE_BYTES, MAX_PPTX_SELECTION_BYTES, MAX_PPTX_TEXT_BYTES } from '../../contract/pptxImport.mjs'

const tick = () => new Promise((resolve) => setImmediate(resolve))
class Port {
  onmessage = null
  onerror = null
  onmessageerror = null
  stopped = 0
  sent: unknown[] = []
  postMessage(value: unknown) { this.sent.push(value) }
  terminate() { this.stopped += 1 }
  answer(value: unknown) { this.onmessage?.({ data: value })
  }
}

test('PPTX worker requests are bounded, serialized and preserve the exact format', async () => {
  const ports: Port[] = []
  const run = createPptxImporter(async () => () => { const port = new Port(); ports.push(port); return port })
  const first = run(new Uint8Array([1]))
  const second = run(new Uint8Array([2]))
  await tick()
  assert.deepEqual(ports[0]?.sent, [{ format: 'pptx', bytes: new Uint8Array([1]) }])
  ports[0]?.answer({ text: 'slide', documentImport: { format: 'pptx', status: 'ready' } })
  assert.equal((await first).text, 'slide')
  await tick()
  ports[1]?.answer({ documentImport: { format: 'pptx', status: 'no-text' } })
  assert.equal((await second).documentImport.status, 'no-text')
  assert.equal(ports[0]?.stopped, 1)
  assert.equal(ports[1]?.stopped, 1)
})

test('PPTX importer rejects oversized files and forged worker text', async () => {
  const port = new Port()
  const run = createPptxImporter(async () => () => port)
  assert.equal((await run(new Uint8Array(MAX_PPTX_FILE_BYTES + 1))).documentImport.status, 'file-too-large')
  for (const value of [
    { text: 'x'.repeat(MAX_PPTX_TEXT_BYTES + 1), documentImport: { format: 'pptx', status: 'ready' } },
    { text: 'body', documentImport: { format: 'docx', status: 'ready' } },
    { text: 'body', documentImport: { format: 'pptx', status: 'ready' }, path: '/tmp/deck.pptx' },
  ]) {
    const result = run(new Uint8Array([1]))
    await tick()
    port.answer(value)
    assert.equal((await result).documentImport.status, 'invalid')
  }
})

test('queued and running cancellation do not accept late PPTX worker results', async () => {
  const port = new Port()
  const run = createPptxImporter(async () => () => port)
  const controller = new AbortController()
  const result = run(new Uint8Array([1]), controller.signal)
  await tick()
  controller.abort()
  assert.equal((await result).documentImport.status, 'unavailable')
  assert.equal(port.stopped, 1)
  port.answer({ text: 'late', documentImport: { format: 'pptx', status: 'ready' } })
})

test('PPTX selection count and aggregate byte limits are enforced before worker admission', async () => {
  const port = new Port()
  const run = createPptxImporter(async () => () => port)
  const controller = new AbortController()
  const chunk = new Uint8Array(1024 * 1024)
  const pending = Array.from({ length: 24 }, () => run(chunk, controller.signal))
  assert.equal((await run(new Uint8Array())).documentImport.status, 'selection-limit')
  controller.abort()
  await Promise.all(pending)
  assert.equal(MAX_PPTX_SELECTION_BYTES, 24 * 1024 * 1024)
})
