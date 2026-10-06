import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildImageOcrHelper } from './ocrHelperBuild.mjs'
import { imageOcrFixture } from './imageOcrFixture.mjs'
import { createImageOcrRunner } from './imageOcr.mjs'
import { createImageOcrHost } from './imageOcrHost.mjs'

const operationA = '123e4567-e89b-42d3-a456-426614174000'
const operationB = '223e4567-e89b-42d3-a456-426614174000'
const png = Uint8Array.from([137, 80, 78, 71])
const temporaryDirectories: string[] = []
after(() => { for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true }) })

function makeHarness({ recognize, targetPlatform = 'darwin', closing = () => false, assertCaller } = {}) {
  const calls = []
  let disposeCalls = 0
  const sender = { mainFrame: {}, isDestroyed: () => false }
  const event = { sender, senderFrame: sender.mainFrame }
  const runner = {
    recognize(bytes, options) {
      calls.push({ bytes, options })
      return recognize ? recognize(bytes, options) : Promise.resolve({ status: 'ready', text: 'Cobalt garden 427' })
    },
    dispose() { disposeCalls += 1 },
  }
  const host = createImageOcrHost({
    targetPlatform, runner, isClosing: closing,
    assertCaller: assertCaller ?? ((candidate) => { if (candidate?.sender !== sender) throw new Error('untrusted') }),
  })
  return { host, calls, event, sender, runner, disposeCalls: () => disposeCalls }
}

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

test('authenticates before inspecting renderer input and accepts only canonical UUIDv4 IDs', async () => {
  let authorized = false
  let reads = 0
  const input = new Proxy({}, { get() { reads += 1; throw new Error('input touched') } })
  const harness = makeHarness({ assertCaller: () => { if (!authorized) throw new Error('untrusted') } })
  assert.deepEqual(await harness.host.recognize({}, operationA, input), { status: 'unavailable' })
  assert.equal(reads, 0)
  authorized = true
  for (const invalid of ['123E4567-E89B-42D3-A456-426614174000', '123e4567-e89b-12d3-a456-426614174000', '123e4567-e89b-42d3-c456-426614174000', `${operationA}x`]) {
    assert.deepEqual(await harness.host.recognize(harness.event, invalid, png), { status: 'invalid' })
  }
  assert.deepEqual(await harness.host.recognize(harness.event, operationA, png), { status: 'ready', text: 'Cobalt garden 427' })
  assert.deepEqual(await harness.host.recognize(harness.event, operationB, png, { path: '/not-an-option' }), { status: 'invalid' })
  assert.equal(harness.calls.length, 1)
})

test('bounds arguments and refuses browser/Linux OCR without starting the runner', async () => {
  const harness = makeHarness({ targetPlatform: 'linux' })
  assert.deepEqual(await harness.host.recognize(harness.event, operationA, new Uint8Array(3 * 1024 * 1024 + 1)), { status: 'unavailable' })
  assert.equal(harness.calls.length, 0)
  const mac = makeHarness()
  assert.deepEqual(await mac.host.recognize(mac.event, operationA, new Uint8Array(3 * 1024 * 1024 + 1)), { status: 'too-large' })
  assert.deepEqual(await mac.host.recognize(mac.event, operationA, new Uint8Array(new SharedArrayBuffer(4))), { status: 'invalid' })
  assert.equal(mac.calls.length, 0)
})

test('limits active work, rejects overlapping IDs, and only the exact sender/frame can cancel', async () => {
  const pending = new Map()
  const harness = makeHarness({
    assertCaller: () => {},
    recognize: (_bytes, { signal }) => {
      const job = deferred()
      pending.set(pending.size ? operationB : operationA, { ...job, signal })
      return job.promise
    },
  })
  const first = harness.host.recognize(harness.event, operationA, png)
  assert.deepEqual(await harness.host.recognize(harness.event, operationA, png), { status: 'busy' })
  const second = harness.host.recognize(harness.event, operationB, png)
  const third = await harness.host.recognize(harness.event, '323e4567-e89b-42d3-a456-426614174000', png)
  assert.deepEqual(third, { status: 'busy' })

  const otherSender = { sender: { mainFrame: harness.event.senderFrame }, senderFrame: harness.event.senderFrame }
  assert.equal(await harness.host.cancel(otherSender, operationA), false)
  assert.equal(await harness.host.cancel({ sender: harness.sender, senderFrame: {} }, operationA), false)
  assert.equal(pending.get(operationA).signal.aborted, false)
  assert.equal(await harness.host.cancel(harness.event, operationA), true)
  assert.equal(pending.get(operationA).signal.aborted, true)
  pending.get(operationA).resolve({ status: 'ready', text: 'must be fenced' })
  pending.get(operationB).resolve({ status: 'no-text' })
  assert.deepEqual(await first, { status: 'cancelled' })
  assert.deepEqual(await second, { status: 'no-text' })
})

test('navigation, destruction, and shutdown cancel and fence late native results', async () => {
  const pending = deferred()
  const harness = makeHarness({ recognize: () => pending.promise })
  const result = harness.host.recognize(harness.event, operationA, png)
  assert.equal(harness.host.cancelSender(harness.sender), 1)
  pending.resolve({ status: 'ready', text: 'late result' })
  assert.deepEqual(await result, { status: 'cancelled' })

  const destroyedPending = deferred()
  const destroyed = makeHarness({ recognize: () => destroyedPending.promise })
  const destroyedResult = destroyed.host.recognize(destroyed.event, operationA, png)
  destroyed.sender.isDestroyed = () => true
  destroyedPending.resolve({ status: 'ready', text: 'late result' })
  assert.deepEqual(await destroyedResult, { status: 'cancelled' })

  const shutdownPending = deferred()
  const shutdown = makeHarness({ recognize: () => shutdownPending.promise })
  const shutdownResult = shutdown.host.recognize(shutdown.event, operationA, png)
  shutdown.host.dispose()
  shutdown.host.dispose()
  assert.equal(shutdown.disposeCalls(), 1)
  assert.deepEqual(await shutdown.host.recognize(shutdown.event, operationB, png), { status: 'unavailable' })
  shutdownPending.resolve({ status: 'ready', text: 'late result' })
  assert.deepEqual(await shutdownResult, { status: 'cancelled' })
})

test('validates results as closed text-only outcomes', async () => {
  for (const result of [
    { status: 'ready', text: 'ok', path: '/private/image.png' },
    { status: 'ready', text: 'bad\u0000text' },
    { status: 'ready', text: '   ' },
    { status: 'native-error', message: 'native detail' },
  ]) {
    const harness = makeHarness({ recognize: () => Promise.resolve(result) })
    assert.deepEqual(await harness.host.recognize(harness.event, operationA, png), { status: 'unavailable' })
  }
})

test('native fixture is recognized through the host and cancellation stays sender-owned', {
  skip: process.platform !== 'darwin',
}, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'agent-commons-image-ocr-host-test-'))
  temporaryDirectories.push(directory)
  const executable = buildImageOcrHelper({ targetArch: process.arch === 'x64' ? 'x64' : 'arm64', outputPath: join(directory, 'agent-commons-image-ocr') })
  const runner = createImageOcrRunner({ executable, targetPlatform: 'darwin' })
  const sender = { mainFrame: {}, isDestroyed: () => false }
  const event = { sender, senderFrame: sender.mainFrame }
  const host = createImageOcrHost({ targetPlatform: 'darwin', runner, assertCaller: (candidate) => assert.equal(candidate, event) })

  const textPng = await imageOcrFixture({ text: 'Cobalt garden 427' })
  const recognized = await host.recognize(event, operationA, textPng)
  assert.equal(recognized.status, 'ready')
  assert.match(recognized.text ?? '', /Cobalt\s+garden\s+427/i)
  assert.deepEqual(Object.keys(recognized).sort(), ['status', 'text'])

  const pending = host.recognize(event, operationB, textPng)
  const otherSender = { sender: { mainFrame: {} }, senderFrame: {} }
  assert.equal(await host.cancel(otherSender, operationB), false)
  assert.equal(await host.cancel(event, operationB), true)
  assert.deepEqual(await pending, { status: 'cancelled' })
  host.dispose()
})
