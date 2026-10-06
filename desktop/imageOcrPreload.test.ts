import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('./preload.cjs', import.meta.url), 'utf8')
const channels = {
  recognize: 'agent-commons:image-ocr:recognize',
  cancel: 'agent-commons:image-ocr:cancel',
}
const jsonValue = (value) => JSON.parse(JSON.stringify(value))

function loadPreload(responses = [], platform = 'darwin') {
  const calls = []
  let bridge
  const electron = {
    contextBridge: { exposeInMainWorld(name, value) { assert.equal(name, 'agentCommonsDesktop'); bridge = value } },
    ipcRenderer: {
      invoke(channel, ...args) {
        calls.push([channel, ...args])
        const response = responses.shift()
        if (response?.reject) return Promise.reject(response.reject)
        return Promise.resolve(response?.value)
      },
    },
  }
  const context = vm.createContext({
    process: { argv: [], platform },
    require(name) {
      assert.equal(name, 'electron', 'preload may require only Electron in this test harness')
      return electron
    },
  })
  vm.runInContext(source, context, { filename: 'preload.cjs' })
  return { bridge, calls }
}

test('macOS exposes only the fixed OCR recognize and cancel IPC methods', async () => {
  const png = Uint8Array.from([137, 80, 78, 71])
  const { bridge, calls } = loadPreload([
    { value: { status: 'ready', text: 'Cobalt garden 427' } },
    { value: true },
  ])
  assert.deepEqual(Object.keys(bridge.imageOcr).sort(), ['cancel', 'recognize'])
  assert.deepEqual(jsonValue(await bridge.imageOcr.recognize('123e4567-e89b-42d3-a456-426614174000', png)), { status: 'ready', text: 'Cobalt garden 427' })
  assert.equal(await bridge.imageOcr.cancel('123e4567-e89b-42d3-a456-426614174000'), true)
  assert.deepEqual(calls, [
    [channels.recognize, '123e4567-e89b-42d3-a456-426614174000', png],
    [channels.cancel, '123e4567-e89b-42d3-a456-426614174000'],
  ])
})

test('preload strips IPC exceptions and malformed/native details into closed outcomes', async () => {
  const { bridge, calls } = loadPreload([
    { reject: new Error('private native diagnostic /Users/example/image.png') },
    { value: { status: 'ready', text: 'safe?', path: '/private/image.png' } },
    { value: { status: 'failure', message: 'native exception' } },
    { reject: new Error('private native diagnostic') },
  ])
  const recognize = () => bridge.imageOcr.recognize('123e4567-e89b-42d3-a456-426614174000', new Uint8Array())
  assert.deepEqual(jsonValue(await recognize()), { status: 'unavailable' })
  assert.deepEqual(jsonValue(await recognize()), { status: 'unavailable' })
  assert.deepEqual(jsonValue(await recognize()), { status: 'unavailable' })
  assert.equal(await bridge.imageOcr.cancel('123e4567-e89b-42d3-a456-426614174000'), false)
  assert.equal(calls.length, 4)
  assert.equal(JSON.stringify(jsonValue(await recognize())).includes('/private'), false)
})

test('OCR capability is absent outside macOS', async () => {
  for (const platform of ['linux', 'win32']) {
    const { bridge, calls } = loadPreload([], platform)
    assert.equal('imageOcr' in bridge, false)
    assert.equal(calls.length, 0)
  }
})
