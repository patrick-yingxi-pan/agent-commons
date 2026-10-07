import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { test } from 'node:test'
import {
  createPdfOcrRunner, parsePdfOcrOutput, pdfOcrExecutable,
  PDF_OCR_CAPACITY, PDF_OCR_MAX_INPUT_BYTES, PDF_OCR_MAX_OUTPUT_BYTES, PDF_OCR_TIMEOUT_MS,
} from './pdfOcr.mjs'

function pdfHeader() { return Buffer.from('%PDF-1.7\nfixture') }

function harness() {
  const children = []
  const calls = []
  const timers = new Map()
  const engine = createPdfOcrRunner({
    targetPlatform: 'darwin', executable: '/private/helper',
    spawnProcess(...args) {
      calls.push(args)
      const child = new EventEmitter()
      child.stdin = new PassThrough()
      child.stdout = new PassThrough()
      child.kills = []
      child.kill = (signal) => { child.kills.push(signal); return true }
      child.reply = (body, code = 0, signal = null) => {
        child.stdout.write(typeof body === 'string' ? body : JSON.stringify(body))
        child.emit('close', code, signal)
      }
      children.push(child)
      return child
    },
    setTimer(fn, ms) { assert.equal(ms, PDF_OCR_TIMEOUT_MS); const id = {}; timers.set(id, fn); return id },
    clearTimer(id) { timers.delete(id) },
  })
  return { engine, children, calls, timers }
}

test('PDF OCR output is closed, bounded and complete', () => {
  const parse = (value) => parsePdfOcrOutput(Buffer.from(JSON.stringify(value)))
  assert.deepEqual(parse({ status: 'ready', text: '[Page 1]\nInvoice', pages: 2, textPages: 1 }),
    { status: 'ready', text: '[Page 1]\nInvoice', pages: 2, textPages: 1 })
  assert.deepEqual(parse({ status: 'no-text', pages: 3, textPages: 0 }), { status: 'no-text', pages: 3, textPages: 0 })
  for (const status of ['invalid', 'too-large', 'page-limit', 'protected', 'unavailable']) assert.deepEqual(parse({ status }), { status })
  for (const value of [null, [], {}, { status: 'ready', text: 'body', pages: 1 },
    { status: 'ready', text: ' ', pages: 1, textPages: 1 }, { status: 'no-text', pages: 1, textPages: 1 },
    { status: 'ready', text: 'secret', pages: 1, textPages: 1, path: '/private/a.pdf' },
    { status: 'busy' }, { status: 'timeout' }, { status: 'ready', text: 'é'.repeat(32_769), pages: 1, textPages: 1 }]) {
    assert.deepEqual(parse(value), { status: 'unavailable' })
  }
  for (const bytes of [Buffer.alloc(0), Buffer.from([0xff]), Buffer.from('{}{}'), Buffer.alloc(PDF_OCR_MAX_OUTPUT_BYTES + 1)]) {
    assert.deepEqual(parsePdfOcrOutput(bytes), { status: 'unavailable' })
  }
})

test('PDF OCR snapshots bytes and starts a fixed path-free helper', async () => {
  const { engine, children, calls, timers } = harness()
  const pdf = pdfHeader()
  const expected = Buffer.from(pdf)
  const pending = engine.recognize(pdf)
  pdf.fill(0)
  assert.deepEqual(children[0].stdin.read(), expected)
  assert.deepEqual(calls[0], ['/private/helper', [], {
    cwd: '/', env: { LC_ALL: 'C' }, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true,
  }])
  children[0].reply({ status: 'ready', text: '[Page 1]\nInvoice', pages: 1, textPages: 1 })
  assert.deepEqual(await pending, { status: 'ready', text: '[Page 1]\nInvoice', pages: 1, textPages: 1 })
  assert.equal(timers.size, 0)
  engine.dispose()
  assert.deepEqual(await engine.recognize(pdfHeader()), { status: 'cancelled' })
})

test('PDF OCR preflight rejects malformed, oversized, unsupported and shared input without spawning', async () => {
  const { engine, calls } = harness()
  for (const value of ['https://example.test/a.pdf', new ArrayBuffer(16), Buffer.alloc(0), Buffer.from('not-pdf'), new Uint8Array(new SharedArrayBuffer(16))]) {
    assert.deepEqual(await engine.recognize(value), { status: 'invalid' })
  }
  assert.deepEqual(await engine.recognize(Buffer.concat([pdfHeader(), Buffer.alloc(PDF_OCR_MAX_INPUT_BYTES)])), { status: 'too-large' })
  assert.equal(calls.length, 0)
  assert.deepEqual(await engine.recognize(pdfHeader(), { signal: AbortSignal.abort() }), { status: 'cancelled' })
  for (const options of [{ targetPlatform: 'linux' }, { targetPlatform: 'darwin', executable: 'relative' }]) {
    const other = createPdfOcrRunner({ ...options, spawnProcess: () => assert.fail('must not spawn') })
    assert.deepEqual(await other.recognize(pdfHeader()), { status: 'unavailable' })
  }
  assert.equal(pdfOcrExecutable({ targetPlatform: 'linux' }), null)
  assert.equal(pdfOcrExecutable({ targetPlatform: 'darwin', packaged: true, resourcesPath: '/bundle/Resources' }), '/bundle/Helpers/Agent Commons PDF OCR.app/Contents/MacOS/agent-commons-pdf-ocr')
  assert.equal(PDF_OCR_CAPACITY, 1)
})

test('cancelled and timed-out PDF OCR retains its single slot until close', async () => {
  const { engine, children, timers } = harness()
  const abort = new AbortController()
  const first = engine.recognize(pdfHeader(), { signal: abort.signal })
  assert.deepEqual(await engine.recognize(pdfHeader()), { status: 'busy' })
  abort.abort()
  assert.deepEqual(await first, { status: 'cancelled' })
  assert.deepEqual(children[0].kills, ['SIGKILL'])
  assert.deepEqual(await engine.recognize(pdfHeader()), { status: 'busy' })
  children[0].emit('close', null, 'SIGKILL')
  const second = engine.recognize(pdfHeader())
  ;[...timers.values()][0]()
  assert.deepEqual(await second, { status: 'timeout' })
  assert.deepEqual(await engine.recognize(pdfHeader()), { status: 'busy' })
  children[1].emit('close', null, 'SIGKILL')
  assert.equal(timers.size, 0)
})

test('malformed protocol, nonzero exits and output overflow are unavailable', async () => {
  for (const finish of [
    (child) => child.reply({ status: 'ready', text: 'partial', pages: 1, textPages: 1 }, 1),
    (child) => child.reply('{"status":"ready",'),
    (child) => child.stdout.write(Buffer.alloc(PDF_OCR_MAX_OUTPUT_BYTES + 1)),
  ]) {
    const { engine, children } = harness()
    const pending = engine.recognize(pdfHeader())
    finish(children[0])
    assert.deepEqual(await pending, { status: 'unavailable' })
    children[0].emit('close', 1)
  }
})
