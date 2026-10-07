import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import type { NativePdfOcrBridge, PdfOcrResult } from '../../contract/pdfOcr.mjs'
import { PDF_OCR_MAX_INPUT_BYTES } from '../../contract/pdfOcr.mjs'
import { refreshAccount } from './account.ts'
import { desktopPdfOcrAvailable, recognizeDesktopPdfText } from './desktopPdfOcr.ts'

const PDF = new TextEncoder().encode('%PDF-1.7\nminimal test input')
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
afterEach(() => refreshAccount(null))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => { resolve = yes })
  return { promise, resolve }
}
function fakeBridge(overrides: Partial<NativePdfOcrBridge> = {}, calls: unknown[][] = []): NativePdfOcrBridge {
  return {
    async recognize(operationId, pdf) { calls.push(['recognize', operationId, pdf]); return { status: 'ready', text: 'Cobalt garden 427', pages: 3, textPages: 2 } },
    async cancel(operationId) { calls.push(['cancel', operationId]); return true },
    ...overrides,
  }
}
const scopeFor = (pdfOcr: NativePdfOcrBridge) => ({ agentCommonsDesktop: { pdfOcr } })

test('optional capability forwards only a detached bounded PDF and UUIDv4', async () => {
  const calls: unknown[][] = []
  const input = PDF.slice()
  const scope = scopeFor(fakeBridge({}, calls))
  assert.equal(desktopPdfOcrAvailable(scope), true)
  assert.equal(desktopPdfOcrAvailable({}), false)
  assert.deepEqual(await recognizeDesktopPdfText(input, undefined, scope), { status: 'ready', text: 'Cobalt garden 427', pages: 3, textPages: 2 })
  assert.equal(calls.length, 1)
  assert.match(String(calls[0]?.[1]), UUID_V4)
  assert.notEqual(calls[0]?.[2], input)
  assert.deepEqual(calls[0]?.[2], input)
})

test('web, aborted, malformed and oversized inputs never reach native OCR', async () => {
  let invoked = 0
  const scope = scopeFor(fakeBridge({ recognize: async () => { invoked++; return { status: 'no-text', pages: 1, textPages: 0 } } }))
  assert.deepEqual(await recognizeDesktopPdfText(PDF), { status: 'unavailable' })
  assert.deepEqual(await recognizeDesktopPdfText(new Uint8Array(10), undefined, scope), { status: 'invalid' })
  assert.deepEqual(await recognizeDesktopPdfText(new Uint8Array(PDF_OCR_MAX_INPUT_BYTES + 1), undefined, scope), { status: 'too-large' })
  const controller = new AbortController()
  controller.abort()
  assert.deepEqual(await recognizeDesktopPdfText(PDF, controller.signal, scope), { status: 'cancelled' })
  assert.equal(invoked, 0)
})

test('abort and account changes cancel the same operation and suppress late results', async () => {
  const pending = deferred<PdfOcrResult>()
  const calls: unknown[][] = []
  const scope = scopeFor(fakeBridge({ recognize(operationId, pdf) { calls.push(['recognize', operationId, pdf]); return pending.promise } }, calls))
  const controller = new AbortController()
  const outcome = recognizeDesktopPdfText(PDF, controller.signal, scope)
  const id = calls[0]?.[1]
  controller.abort()
  assert.deepEqual(await outcome, { status: 'cancelled' })
  assert.deepEqual(calls.map(call => [call[0], call[1]]), [['recognize', id], ['cancel', id]])
  pending.resolve({ status: 'ready', text: 'late text', pages: 1, textPages: 1 })
  await Promise.resolve()
  assert.deepEqual(await outcome, { status: 'cancelled' })

  const held = deferred<PdfOcrResult>()
  const accountCalls: unknown[][] = []
  const switched = recognizeDesktopPdfText(PDF, undefined, scopeFor(fakeBridge({ recognize(op) { accountCalls.push(['recognize', op]); return held.promise }, cancel: async op => { accountCalls.push(['cancel', op]); return true } })))
  refreshAccount({ userId: 'other-user', tenantId: 'other-tenant' })
  assert.deepEqual(await switched, { status: 'cancelled' })
  assert.deepEqual(accountCalls[1], ['cancel', accountCalls[0]?.[1]])
})

test('closed results are validated and adapter deadline cancels a hung operation', async () => {
  for (const malformed of [
    { status: 'ready', text: 'ok', pages: 1, textPages: 1, path: '/private/file.pdf' },
    { status: 'ready', text: 'bad\u0000text', pages: 1, textPages: 1 },
    { status: 'ready', text: 'ok', pages: 0, textPages: 1 },
  ]) {
    assert.deepEqual(await recognizeDesktopPdfText(PDF, undefined, scopeFor(fakeBridge({ recognize: async () => malformed as PdfOcrResult }))), { status: 'unavailable' })
  }
  const calls: unknown[][] = []
  const hung = fakeBridge({ recognize(op) { calls.push(['recognize', op]); return new Promise<PdfOcrResult>(() => {}) }, cancel: async op => { calls.push(['cancel', op]); return true } })
  const original = globalThis.setTimeout
  globalThis.setTimeout = ((callback: TimerHandler, delay?: number, ...args: unknown[]) => original(callback, delay === 125_000 ? 0 : delay, ...args)) as typeof setTimeout
  try { assert.deepEqual(await recognizeDesktopPdfText(PDF, undefined, scopeFor(hung)), { status: 'timeout' }) }
  finally { globalThis.setTimeout = original }
  assert.deepEqual(calls[1], ['cancel', calls[0]?.[1]])
})
