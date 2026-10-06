import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import type { ImageOcrResult, NativeImageOcrBridge } from '../../contract/imageOcr.mjs'
import { IMAGE_OCR_MAX_INPUT_BYTES } from '../../contract/imageOcr.mjs'
import { refreshAccount } from './account.ts'
import { desktopImageOcrAvailable, recognizeDesktopImageText } from './desktopImageOcr.ts'

const PNG = new Uint8Array(33)
PNG.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82])
new DataView(PNG.buffer).setUint32(16, 1000, false)
new DataView(PNG.buffer).setUint32(20, 240, false)
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

afterEach(() => refreshAccount(null))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function scopeFor(port: NativeImageOcrBridge) {
  return { agentCommonsDesktop: { imageOcr: port } }
}

function fakeBridge(overrides: Partial<NativeImageOcrBridge> = {}, calls: unknown[][] = []): NativeImageOcrBridge {
  return {
    async recognize(operationId, png) { calls.push(['recognize', operationId, png]); return { status: 'ready', text: 'Cobalt garden 427' } },
    async cancel(operationId) { calls.push(['cancel', operationId]); return true },
    ...overrides,
  }
}

test('native capability is optional and recognize forwards only a detached bounded PNG plus UUIDv4', async () => {
  const calls: unknown[][] = []
  const port = fakeBridge({}, calls)
  const scope = scopeFor(port)
  assert.equal(desktopImageOcrAvailable(scope), true)
  assert.equal(desktopImageOcrAvailable({}), false)

  const input = PNG.slice()
  const result = await recognizeDesktopImageText(input, undefined, scope)
  assert.deepEqual(result, { status: 'ready', text: 'Cobalt garden 427' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.[0], 'recognize')
  assert.match(String(calls[0]?.[1]), UUID_V4)
  assert.notEqual(calls[0]?.[2], input)
  assert.deepEqual(calls[0]?.[2], input)
  assert.equal((calls[0]?.[2] as Uint8Array).byteLength, input.length)
})

test('web, pre-aborted, malformed and oversized input never reaches the bridge', async () => {
  let invocations = 0
  const scope = scopeFor(fakeBridge({ recognize: async () => { invocations++; return { status: 'no-text' } } }))
  assert.deepEqual(await recognizeDesktopImageText(PNG), { status: 'unavailable' })
  const controller = new AbortController()
  controller.abort()
  assert.deepEqual(await recognizeDesktopImageText(PNG, controller.signal, scope), { status: 'cancelled' })
  assert.deepEqual(await recognizeDesktopImageText(new Uint8Array(8), undefined, scope), { status: 'invalid' })
  assert.deepEqual(await recognizeDesktopImageText(new Uint8Array(IMAGE_OCR_MAX_INPUT_BYTES + 1), undefined, scope), { status: 'too-large' })
  if (typeof SharedArrayBuffer === 'function') {
    assert.deepEqual(await recognizeDesktopImageText(new Uint8Array(new SharedArrayBuffer(PNG.length)), undefined, scope), { status: 'invalid' })
  }
  assert.equal(invocations, 0)
})

test('abort immediately sends one same-operation cancel and fences late resolve or reject', async () => {
  const pending = deferred<ImageOcrResult>()
  const calls: unknown[][] = []
  const port = fakeBridge({
    recognize(operationId, png) { calls.push(['recognize', operationId, png]); return pending.promise },
    async cancel(operationId) { calls.push(['cancel', operationId]); throw new Error('/private/native detail') },
  }, calls)
  const controller = new AbortController()
  const result = recognizeDesktopImageText(PNG, controller.signal, scopeFor(port))
  const operationId = String(calls[0]?.[1])
  controller.abort()
  assert.deepEqual(await result, { status: 'cancelled' })
  assert.deepEqual(calls.map((call) => [call[0], call[1]]), [['recognize', operationId], ['cancel', operationId]])
  pending.resolve({ status: 'ready', text: 'late private text' })
  await Promise.resolve()
  assert.deepEqual(await result, { status: 'cancelled' })

  const lateReject = deferred<ImageOcrResult>()
  const rejecting = fakeBridge({ recognize: () => lateReject.promise })
  const anotherController = new AbortController()
  const fenced = recognizeDesktopImageText(PNG, anotherController.signal, scopeFor(rejecting))
  anotherController.abort()
  assert.deepEqual(await fenced, { status: 'cancelled' })
  lateReject.reject(new Error('native rejection after cancellation'))
  await Promise.resolve()
})

test('account switch immediately cancels the active operation and suppresses stale text', async () => {
  const pending = deferred<ImageOcrResult>()
  const calls: unknown[][] = []
  const port = fakeBridge({
    recognize(operationId, png) { calls.push(['recognize', operationId, png]); return pending.promise },
    async cancel(operationId) { calls.push(['cancel', operationId]); return true },
  }, calls)
  const result = recognizeDesktopImageText(PNG, undefined, scopeFor(port))
  const operationId = String(calls[0]?.[1])
  refreshAccount({ userId: 'next-user', tenantId: 'next-tenant' })
  assert.deepEqual(await result, { status: 'cancelled' })
  assert.deepEqual(calls.map((call) => [call[0], call[1]]), [['recognize', operationId], ['cancel', operationId]])
  pending.resolve({ status: 'ready', text: 'old-account result' })
  await Promise.resolve()
  assert.deepEqual(await result, { status: 'cancelled' })
})

test('bridge outcomes are validated and the adapter deadline cancels a hung native call', async () => {
  for (const bad of [
    { status: 'ready', text: 'ok', path: '/private/source.png' },
    { status: 'ready', text: 'bad\u0000text' },
    { status: 'failed', message: 'native diagnostic' },
  ]) {
    assert.deepEqual(await recognizeDesktopImageText(PNG, undefined, scopeFor(fakeBridge({ recognize: async () => bad as ImageOcrResult }))), { status: 'unavailable' })
  }
  assert.deepEqual(await recognizeDesktopImageText(PNG, undefined, scopeFor(fakeBridge({ recognize: async () => ({ status: 'busy' }) }))), { status: 'busy' })

  const calls: unknown[][] = []
  const hanging = fakeBridge({
    recognize(operationId, png) { calls.push(['recognize', operationId, png]); return new Promise<ImageOcrResult>(() => {}) },
    async cancel(operationId) { calls.push(['cancel', operationId]); return true },
  }, calls)
  const originalSetTimeout = globalThis.setTimeout
  globalThis.setTimeout = ((callback: TimerHandler, delay?: number, ...args: unknown[]) =>
    originalSetTimeout(callback, delay === 35_000 ? 0 : delay, ...args)) as typeof setTimeout
  try {
    assert.deepEqual(await recognizeDesktopImageText(PNG, undefined, scopeFor(hanging)), { status: 'timeout' })
  } finally { globalThis.setTimeout = originalSetTimeout }
  assert.equal(calls[1]?.[0], 'cancel')
  assert.equal(calls[1]?.[1], calls[0]?.[1], 'the deadline cancels only the operation that timed out')
})
