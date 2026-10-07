import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import channels from './pdf-ocr-channels.cjs'

const source = readFileSync(new URL('./preload.cjs', import.meta.url), 'utf8')
const json = value => JSON.parse(JSON.stringify(value))
function load(replies = [], platform = 'darwin') {
  let bridge
  const calls = []
  vm.runInNewContext(source, {
    process: { argv: [], platform }, require(name) {
      assert.equal(name, 'electron')
      return { contextBridge: { exposeInMainWorld(_name, value) { bridge = value } }, ipcRenderer: {
        invoke(channel, ...args) {
          calls.push([channel, ...args])
          const reply = replies.shift()
          return reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply)
        },
      } }
    },
  })
  return { bridge, calls }
}
test('PDF preload exposes only fixed recognize/cancel and closed full-page results on macOS', async () => {
  const ready = { status: 'ready', text: '[Page 1]\nRead this', pages: 2, textPages: 1 }
  const noText = { status: 'no-text', pages: 2, textPages: 0 }
  const { bridge, calls } = load([ready, noText, true])
  assert.deepEqual(Object.keys(bridge.pdfOcr).sort(), ['cancel', 'recognize'])
  const bytes = new TextEncoder().encode('%PDF-1.7')
  assert.deepEqual(json(await bridge.pdfOcr.recognize('operation', bytes)), ready)
  assert.deepEqual(json(await bridge.pdfOcr.recognize('operation', bytes)), noText)
  assert.equal(await bridge.pdfOcr.cancel('operation'), true)
  assert.deepEqual(calls, [[channels.recognize, 'operation', bytes], [channels.recognize, 'operation', bytes], [channels.cancel, 'operation']])
  for (const platform of ['linux', 'win32']) assert.equal('pdfOcr' in load([], platform).bridge, false)
})
test('PDF preload strips private IPC diagnostics and rejects malformed coverage or extra fields', async () => {
  const ready = { status: 'ready', text: 'text', pages: 1, textPages: 1 }
  const invalid = [new Error('/private/scan.pdf: decoder detail'), { ...ready, path: '/private/scan.pdf' },
    { ...ready, pages: 101 }, { ...ready, textPages: 2 }, { ...ready, textPages: 0 },
    { ...ready, text: '\u0000secret' }, { status: 'ready', text: 'partial' },
    { status: 'no-text', pages: 2 }, { status: 'no-text', pages: 2, textPages: 1 }]
  const { bridge } = load([...invalid, new Error('private cancel error')])
  for (const _entry of invalid) assert.deepEqual(json(await bridge.pdfOcr.recognize('operation', new Uint8Array())), { status: 'unavailable' })
  assert.equal(await bridge.pdfOcr.cancel('operation'), false)
})
