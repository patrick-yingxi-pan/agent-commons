import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { test } from 'node:test'
import {
  createImageOcrRunner, imageOcrExecutable, parseImageOcrOutput,
  IMAGE_OCR_CAPACITY, IMAGE_OCR_MAX_INPUT_BYTES, IMAGE_OCR_MAX_TEXT_BYTES,
  IMAGE_OCR_MAX_OUTPUT_BYTES, IMAGE_OCR_TIMEOUT_MS,
} from './imageOcr.mjs'

function pngHeader(width = 100, height = 100) {
  const input = Buffer.alloc(33)
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(input)
  input.writeUInt32BE(13, 8)
  input.write('IHDR', 12)
  input.writeUInt32BE(width, 16)
  input.writeUInt32BE(height, 20)
  return input // preflight fixture only; the native helper must refuse it
}

function harness() {
  const children = []
  const calls = []
  const timers = new Map()
  const engine = createImageOcrRunner({
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
    setTimer(fn, ms) { assert.equal(ms, IMAGE_OCR_TIMEOUT_MS); const id = {}; timers.set(id, fn); return id },
    clearTimer(id) { timers.delete(id) },
  })
  return { engine, children, calls, timers }
}

test('OCR output is a closed whole-text result, never native diagnostics or partial Unicode', () => {
  const parse = (value) => parseImageOcrOutput(Buffer.from(JSON.stringify(value)))
  assert.deepEqual(parse({ status: 'ready', text: 'Garden\n你好\t🙂' }), { status: 'ready', text: 'Garden\n你好\t🙂' })
  for (const status of ['no-text', 'invalid', 'too-large', 'unavailable']) assert.deepEqual(parse({ status }), { status })
  for (const value of [null, [], {}, { status: 'ready' }, { status: 'no-text', text: '' },
    { status: 'ready', text: ' ' }, { status: 'ready', text: '\ud800' }, { status: 'ready', text: 'hidden\0body' },
    { status: 'ready', text: 'secret', path: '/private/photo.png' }, { status: 'timeout' },
    { status: 'ready', text: 'é'.repeat(IMAGE_OCR_MAX_TEXT_BYTES / 2 + 1) }]) {
    assert.deepEqual(parse(value), { status: 'unavailable' })
  }
  assert.equal(parse({ status: 'ready', text: 'a'.repeat(IMAGE_OCR_MAX_TEXT_BYTES) }).text.length, IMAGE_OCR_MAX_TEXT_BYTES)
  for (const bytes of [Buffer.alloc(0), Buffer.from([0xff]), Buffer.from('{}{}'), Buffer.alloc(IMAGE_OCR_MAX_OUTPUT_BYTES + 1)]) {
    assert.deepEqual(parseImageOcrOutput(bytes), { status: 'unavailable' })
  }
})

test('OCR snapshots bounded PNG input and starts a fixed executable with no ambient credentials or paths', async () => {
  const { engine, children, calls, timers } = harness()
  const bytes = pngHeader()
  const expected = Buffer.from(bytes)
  const pending = engine.recognize(bytes)
  bytes.fill(0)
  assert.deepEqual(children[0].stdin.read(), expected)
  assert.deepEqual(calls[0], ['/private/helper', [], {
    cwd: '/', env: { LC_ALL: 'C' }, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true,
  }])
  children[0].reply({ status: 'ready', text: 'Cobalt garden' })
  assert.deepEqual(await pending, { status: 'ready', text: 'Cobalt garden' })
  assert.equal(timers.size, 0)
  assert.deepEqual(children[0].kills, [])
  engine.dispose()
  assert.deepEqual(await engine.recognize(pngHeader()), { status: 'cancelled' })
})

test('OCR preflight refuses URLs, malformed/oversized input, shared memory and unsupported hosts without spawning', async () => {
  const { engine, calls } = harness()
  for (const bytes of ['https://private.example/image', new ArrayBuffer(33), Buffer.alloc(0), Buffer.alloc(33), pngHeader(0), new Uint8Array(new SharedArrayBuffer(33))]) {
    assert.deepEqual(await engine.recognize(bytes), { status: 'invalid' })
  }
  for (const bytes of [Buffer.alloc(IMAGE_OCR_MAX_INPUT_BYTES + 1), pngHeader(2001), pngHeader(1, 2001)]) {
    assert.deepEqual(await engine.recognize(bytes), { status: 'too-large' })
  }
  assert.equal(calls.length, 0)
  const aborted = AbortSignal.abort()
  assert.deepEqual(await engine.recognize(pngHeader(), { signal: aborted }), { status: 'cancelled' })
  assert.equal(calls.length, 0)
  for (const options of [{ targetPlatform: 'linux' }, { targetPlatform: 'darwin', executable: 'relative' }]) {
    const other = createImageOcrRunner({ ...options, spawnProcess: () => assert.fail('must not spawn') })
    assert.deepEqual(await other.recognize(pngHeader()), { status: 'unavailable' })
  }
  assert.equal(imageOcrExecutable({ targetPlatform: 'linux' }), null)
  assert.equal(imageOcrExecutable({ targetPlatform: 'darwin', packaged: true, resourcesPath: '/bundle/Resources' }), '/bundle/Resources/agent-commons-image-ocr')
})

test('cancelled and timed-out OCR retain admission until process close; dispose permanently fences work', async () => {
  const { engine, children, timers } = harness()
  const abort = new AbortController()
  const first = engine.recognize(pngHeader(), { signal: abort.signal })
  const second = engine.recognize(pngHeader())
  assert.equal(children.length, IMAGE_OCR_CAPACITY)
  assert.deepEqual(await engine.recognize(pngHeader()), { status: 'busy' })
  abort.abort()
  assert.deepEqual(await first, { status: 'cancelled' })
  assert.deepEqual(children[0].kills, ['SIGKILL'])
  const whileCancelled = engine.recognize(pngHeader())
  assert.equal(children.length, IMAGE_OCR_CAPACITY, 'cancelled child still occupies admission until close')
  assert.deepEqual(await whileCancelled, { status: 'busy' })
  ;[...timers.values()][0]()
  assert.deepEqual(await second, { status: 'timeout' })
  assert.deepEqual(children[1].kills, ['SIGKILL'])
  assert.deepEqual(await engine.recognize(pngHeader()), { status: 'busy' })
  children[0].reply({ status: 'ready', text: 'late private text' })
  const third = engine.recognize(pngHeader())
  assert.equal(children.length, 3)
  engine.dispose()
  assert.deepEqual(await third, { status: 'cancelled' })
  assert.deepEqual(children[2].kills, ['SIGKILL'])
  assert.deepEqual(await engine.recognize(pngHeader()), { status: 'cancelled' })
  children[1].emit('close', null, 'SIGKILL')
  children[2].emit('close', null, 'SIGKILL')
  assert.equal(timers.size, 0)
})

test('OCR rejects partial replies, abnormal exits, spawn/stream failure and output overflow without leaking details', async () => {
  for (const fail of [
    (child) => child.reply({ status: 'ready', text: 'partial' }, 1),
    (child) => child.reply({ status: 'ready', text: 'partial' }, 0, 'SIGTERM'),
    (child) => child.emit('error', new Error('/private/source.png: secret')),
    (child) => child.stdin.emit('error', new Error('EPIPE secret')),
    (child) => child.stdout.emit('error', new Error('private diagnostic')),
    (child) => child.stdout.write(Buffer.alloc(IMAGE_OCR_MAX_OUTPUT_BYTES + 1)),
    (child) => child.reply('{"status":"ready",'),
  ]) {
    const { engine, children } = harness()
    const pending = engine.recognize(pngHeader())
    fail(children[0])
    assert.deepEqual(await pending, { status: 'unavailable' })
    children[0].emit('close', 1)
    const next = engine.recognize(pngHeader())
    children[1].reply({ status: 'no-text' })
    assert.deepEqual(await next, { status: 'no-text' })
  }
  const broken = createImageOcrRunner({ targetPlatform: 'darwin', executable: '/private/helper', spawnProcess: () => { throw new Error('private') } })
  assert.deepEqual(await broken.recognize(pngHeader()), { status: 'unavailable' })
})
