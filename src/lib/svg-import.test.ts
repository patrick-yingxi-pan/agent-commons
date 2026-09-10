import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSvgImporter, MAX_SVG_FILE_BYTES, MAX_SVG_SELECTION_BYTES } from './svgImport.ts'

const tick = () => new Promise((resolve) => setImmediate(resolve))
const ready = (xml = '<svg/>') => ({ status: 'ready', xml, width: 160, height: 80 })

class Port {
  onmessage = null
  onerror = null
  onmessageerror = null
  stopped = 0
  sent: unknown[] = []
  postMessage(value: unknown) { this.sent.push(value) }
  terminate() { this.stopped++ }
  answer(value: unknown) { this.onmessage?.({ data: value } as MessageEvent) }
}

test('SVG workers validate closed preparation results and terminate after success/error', async () => {
  const ports: Port[] = []
  const run = createSvgImporter(async () => () => { const port = new Port(); ports.push(port); return port })
  const first = run(new Uint8Array([1]))
  await tick()
  assert.deepEqual(ports[0]!.sent, [{ format: 'svg', bytes: new Uint8Array([1]) }])
  ports[0]!.answer(ready())
  assert.deepEqual(await first, ready())
  assert.equal(ports[0]!.stopped, 1)

  const invalid = run(new Uint8Array([2]))
  await tick()
  ports[1]!.answer({ status: 'ready', xml: '<svg/>', width: 0, height: 80 })
  assert.deepEqual(await invalid, { status: 'invalid' })
  assert.equal(ports[1]!.stopped, 1)

  const errored = run(new Uint8Array([3]))
  await tick()
  ports[2]!.onerror?.({ preventDefault() {} } as ErrorEvent)
  assert.deepEqual(await errored, { status: 'invalid' })
  assert.equal(ports[2]!.stopped, 1)
})

test('SVG worker terminates on abort/deadline and ignores late results', async () => {
  const ports: Port[] = []
  const run = createSvgImporter(async () => () => { const port = new Port(); ports.push(port); return port }, { timeoutMs: 15 })
  const controller = new AbortController()
  const aborted = run(new Uint8Array([1]), controller.signal)
  await tick()
  controller.abort()
  assert.deepEqual(await aborted, { status: 'unavailable' })
  assert.equal(ports[0]!.stopped, 1)
  ports[0]!.answer(ready('late'))

  const stalled = run(new Uint8Array([2]))
  await new Promise((resolve) => setTimeout(resolve, 25))
  assert.deepEqual(await stalled, { status: 'timeout' })
  assert.equal(ports[1]!.stopped, 1)
  ports[1]!.answer(ready('late'))
})

test('late worker loader does not create or post to a worker after cancellation/deadline', async () => {
  let release!: (factory: () => Port) => void
  const loading = new Promise<() => Port>((resolve) => { release = resolve })
  let created = 0
  const run = createSvgImporter(() => loading, { timeoutMs: 15 })
  const controller = new AbortController()
  const result = run(new Uint8Array([1]), controller.signal)
  controller.abort()
  assert.deepEqual(await result, { status: 'unavailable' })
  release(() => { created++; return new Port() })
  await tick()
  assert.equal(created, 0)
})

test('SVG queue serializes workers and enforces file/count/selection bounds', async () => {
  const ports: Port[] = []
  const run = createSvgImporter(async () => () => { const port = new Port(); ports.push(port); return port })
  const first = run(new Uint8Array([1]))
  const second = run(new Uint8Array([2]))
  await tick()
  assert.equal(ports.length, 1)
  ports[0]!.answer({ status: 'no-text' })
  assert.deepEqual(await first, { status: 'invalid' })
  await tick()
  assert.equal(ports.length, 2)
  ports[1]!.answer({ status: 'unsupported' })
  assert.deepEqual(await second, { status: 'unsupported' })

  assert.deepEqual(await run(new Uint8Array(MAX_SVG_FILE_BYTES + 1)), { status: 'file-too-large' })
  const controller = new AbortController()
  const queued = Array.from({ length: 24 }, () => run(new Uint8Array(1), controller.signal))
  assert.deepEqual(await run(new Uint8Array(1)), { status: 'selection-limit' })
  controller.abort()
  await Promise.all(queued)

  const bytePorts: Port[] = []
  const byteRun = createSvgImporter(async () => () => { const port = new Port(); bytePorts.push(port); return port })
  const byteController = new AbortController()
  const big = new Uint8Array(MAX_SVG_FILE_BYTES)
  const bigJobs = [byteRun(big, byteController.signal), byteRun(big, byteController.signal), byteRun(big, byteController.signal)]
  assert.equal(MAX_SVG_SELECTION_BYTES, MAX_SVG_FILE_BYTES * 3)
  assert.deepEqual(await byteRun(new Uint8Array(1), byteController.signal), { status: 'selection-limit' })
  byteController.abort()
  await Promise.all(bigJobs)
})
