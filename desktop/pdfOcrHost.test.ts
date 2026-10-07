import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createPdfOcrHost } from './pdfOcrHost.mjs'
import channels from './pdf-ocr-channels.cjs'

const id = '123e4567-e89b-42d3-a456-426614174000'
const secondId = '223e4567-e89b-42d3-a456-426614174000'
const pdf = new TextEncoder().encode('%PDF-1.7\nfixture')
const ready = { status: 'ready', text: '[Page 1]\nActual text', pages: 2, textPages: 1 }
function harness() {
  const sender = { mainFrame: {}, isDestroyed: () => false }
  const event = { sender, senderFrame: sender.mainFrame }
  const calls = []
  let resolve
  let disposed = 0
  const host = createPdfOcrHost({ targetPlatform: 'darwin',
    assertCaller: candidate => { if (candidate?.sender !== sender) throw new Error('untrusted') },
    runner: { recognize(bytes, options) { calls.push({ bytes, options }); return new Promise(done => { resolve = done }) }, dispose() { disposed++ } },
  })
  return { host, sender, event, calls, finish: value => resolve(value), disposed: () => disposed }
}

test('PDF OCR authenticates before bytes, bounds input, and retains one exact sender-owned job', async () => {
  const h = harness()
  const hostile = new Proxy({}, { get() { assert.fail('untrusted input was inspected') } })
  assert.deepEqual(await h.host.recognize({}, id, hostile), { status: 'unavailable' })
  assert.deepEqual(await h.host.recognize(h.event, 'not-a-uuid', pdf), { status: 'invalid' })
  assert.deepEqual(await h.host.recognize(h.event, id, new Uint8Array(8 * 1024 * 1024 + 1)), { status: 'too-large' })
  assert.deepEqual(await h.host.recognize(h.event, id, new Uint8Array(new SharedArrayBuffer(20))), { status: 'invalid' })
  assert.deepEqual(await h.host.recognize(h.event, id, pdf, { path: '/not-an-option' }), { status: 'invalid' })
  const pending = h.host.recognize(h.event, id, pdf)
  assert.deepEqual(await h.host.recognize(h.event, secondId, pdf), { status: 'busy' })
  assert.equal(h.calls.length, 1)
  assert.notEqual(h.calls[0].bytes.buffer, pdf.buffer)
  assert.equal(await h.host.cancel({ sender: h.sender, senderFrame: {} }, id), false)
  assert.equal(await h.host.cancel(h.event, id), true)
  assert.equal(h.calls[0].options.signal.aborted, true)
  h.finish(ready)
  assert.deepEqual(await pending, { status: 'cancelled' })
})

test('PDF OCR rejects unknown result fields and invalid coverage without publishing partial text', async () => {
  for (const result of [ready, { status: 'no-text', pages: 2, textPages: 0 },
    { ...ready, path: '/private/source.pdf' }, { ...ready, textPages: 3 }, { ...ready, pages: 0 }, { status: 'ready', text: 'partial' }]) {
    const h = harness()
    const pending = h.host.recognize(h.event, id, pdf)
    h.finish(result)
    assert.deepEqual(await pending, result === ready || result.status === 'no-text' ? result : { status: 'unavailable' })
  }
})

test('PDF OCR navigation, replaced frames and shutdown fence late output', async () => {
  for (const transition of ['navigate', 'replace', 'shutdown']) {
    const h = harness()
    const pending = h.host.recognize(h.event, id, pdf)
    if (transition === 'navigate') assert.equal(h.host.cancelSender(h.sender), 1)
    if (transition === 'replace') h.sender.mainFrame = {}
    if (transition === 'shutdown') { h.host.dispose(); h.host.dispose(); assert.equal(h.disposed(), 1) }
    h.finish(ready)
    assert.deepEqual(await pending, { status: 'cancelled' })
  }
})

function checkWiring(main, preload) {
  for (const channel of Object.values(channels)) assert.ok(preload.includes(channel))
  assert.match(preload, /process\.platform === 'darwin' \? \{ pdfOcr: Object\.freeze/)
  assert.match(main, /function installPdfOcrIpc\(\) \{\s*if \(process\.platform !== 'darwin'\) return/)
  const installation = main.slice(main.indexOf('function installPdfOcrIpc()'), main.indexOf('function pipeLines('))
  assert.ok(installation.includes('assertCaller: assertTrustedOcrCaller'))
  assert.ok(installation.includes('isClosing: () => quitting || !backendReady || !mainWindow || mainWindow.isDestroyed()'))
  assert.ok(installation.includes('ipcMain.handle(pdfOcrChannels.recognize'))
  assert.ok(installation.includes('ipcMain.handle(pdfOcrChannels.cancel'))
  assert.match(main, /'did-start-navigation'[^]*if \(isMainFrame\) pdfOcrHost\?\.cancelSender/)
  assert.match(main, /'render-process-gone'[^]*pdfOcrHost\?\.cancelSender/)
  assert.match(main, /win\.on\('closed'[^]*pdfOcrHost\?\.cancelSender/)
  assert.match(main, /function beginShutdown\(\)[^]*pdfOcrHost\?\.dispose\(\)/)
  assert.ok(main.indexOf('installPdfOcrIpc()') < main.indexOf('await createMainWindow(rendererUrl'))
}
test('PDF OCR wiring is fixed-channel, main-frame guarded and owned by the native lifetime', () => {
  const main = readFileSync(new URL('./main.mjs', import.meta.url), 'utf8')
  const preload = readFileSync(new URL('./preload.cjs', import.meta.url), 'utf8')
  checkWiring(main, preload)
  const broken = main.replaceAll('assertCaller: assertTrustedOcrCaller', 'assertCaller: () => {}')
  assert.notEqual(broken, main)
  assert.throws(() => checkWiring(broken, preload), assert.AssertionError)
})
