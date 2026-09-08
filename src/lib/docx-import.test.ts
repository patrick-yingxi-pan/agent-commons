import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createDocxImporter } from './docxImport.ts'
import { MAX_DOCX_FILE_BYTES, MAX_DOCX_TEXT_BYTES } from '../../contract/docxImport.mjs'

const tick = () => new Promise((resolve) => setImmediate(resolve))
class Port {
  onmessage = null
  onerror = null
  onmessageerror = null
  stopped = 0
  sent = []
  postMessage(bytes) { this.sent.push(bytes) }
  terminate() { this.stopped++ }
  answer(value) { this.onmessage?.({ data: value }) }
}

test('Word workers are serial, text outcomes bounded, and each worker terminated', async () => {
  const ports: Port[] = []
  const run = createDocxImporter(async () => () => { const p = new Port(); ports.push(p); return p })
  const first = run(new Uint8Array([1]))
  const second = run(new Uint8Array([2]))
  await tick()
  assert.equal(ports.length, 1)
  assert.deepEqual(ports[0].sent, [{ format: 'docx', bytes: new Uint8Array([1]) }])
  ports[0].answer({ text: 'body', documentImport: { format: 'docx', status: 'ready' } })
  assert.equal((await first).text, 'body')
  await tick()
  assert.equal(ports[0].stopped, 1)
  assert.equal(ports.length, 2)
  ports[1].answer({ documentImport: { format: 'docx', status: 'no-text' } })
  assert.equal((await second).documentImport.status, 'no-text')
  assert.equal(ports[1].stopped, 1)
})

test('queued cancellation settles immediately; running cancellation terminates and releases intake', async () => {
  const ports: Port[] = []
  const run = createDocxImporter(async () => () => { const p = new Port(); ports.push(p); return p })
  const active = new AbortController(), queued = new AbortController()
  const first = run(new Uint8Array([1]), active.signal)
  const second = run(new Uint8Array([2]), queued.signal)
  await tick()
  queued.abort()
  assert.equal((await second).documentImport.status, 'unavailable')
  active.abort()
  assert.equal((await first).documentImport.status, 'unavailable')
  assert.equal(ports[0].stopped, 1)
  const next = run(new Uint8Array([3]))
  await tick()
  assert.equal(ports.length, 2)
  ports[1].answer({ text: 'next', documentImport: { format: 'docx', status: 'ready' } })
  assert.equal((await next).text, 'next')
})

test('one deadline covers a stalled module load and prevents a late worker from starting', async () => {
  let release
  const loading = new Promise((resolve) => { release = resolve })
  const port = new Port()
  const run = createDocxImporter(() => loading, { timeoutMs: 20 })
  const result = await run(new Uint8Array([1]))
  assert.equal(result.documentImport.status, 'timeout')
  release(() => port)
  await tick()
  assert.equal(port.sent.length, 0)
})

test('a stalled worker is terminated at the same deadline without accepting a late answer', async () => {
  const port = new Port()
  const run = createDocxImporter(async () => () => port, { timeoutMs: 20 })
  const result = await run(new Uint8Array([1]))
  assert.equal(result.documentImport.status, 'timeout')
  assert.equal(port.stopped, 1)
  port.answer({ text: 'too late', documentImport: { format: 'docx', status: 'ready' } })
  assert.equal(result.text, undefined)
})

test('raw bytes, queued item count and worker-returned payloads cannot bypass import bounds', async () => {
  const port = new Port()
  const run = createDocxImporter(async () => () => port)
  assert.equal((await run(new Uint8Array(MAX_DOCX_FILE_BYTES + 1))).documentImport.status, 'file-too-large')
  const controller = new AbortController()
  const pending = Array.from({ length: 24 }, () => run(new Uint8Array(), controller.signal))
  assert.equal((await run(new Uint8Array())).documentImport.status, 'selection-limit')
  controller.abort()
  await Promise.all(pending)
  for (const value of [
    { text: 'not ready', documentImport: { format: 'docx', status: 'invalid' } },
    { text: 'x'.repeat(MAX_DOCX_TEXT_BYTES + 1), documentImport: { format: 'docx', status: 'ready' } },
    { text: '😀'.repeat(MAX_DOCX_TEXT_BYTES / 2), documentImport: { format: 'docx', status: 'ready' } },
    { text: '', documentImport: { format: 'docx', status: 'ready' } },
    { text: 'body', documentImport: { format: 'docx', status: 'ready' }, path: '/private/document.docx' },
  ]) {
    const result = run(new Uint8Array([1]))
    await tick()
    port.answer(value)
    assert.equal((await result).documentImport.status, 'invalid')
  }
})
