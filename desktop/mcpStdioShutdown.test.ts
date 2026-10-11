import test from 'node:test'
import assert from 'node:assert/strict'
import { waitForMcpStdioShutdown } from './mcpStdioShutdown.mjs'
import { readFileSync } from 'node:fs'

test('native shutdown distinguishes physical completion from timeout or failed cleanup', async () => {
  let finish!: () => void
  let returned = false
  const waiting = waitForMcpStdioShutdown(() => new Promise<void>(resolve => { finish = resolve }))
    .then(result => { returned = true; return result })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(returned, false)
  finish()
  assert.equal(await waiting, true)
  assert.equal(await waitForMcpStdioShutdown(() => new Promise(() => {}), 5), false)
  assert.equal(await waitForMcpStdioShutdown(() => { throw new Error('private launch details') }), false)
  for (const timeout of [0, NaN, 7_001]) assert.equal(await waitForMcpStdioShutdown(() => assert.fail('not admitted'), timeout), false)
})

test('main process waits for owned MCP close before backend teardown and refuses unsafe restore/update', () => {
  const main = readFileSync(new URL('./main.mjs', import.meta.url), 'utf8')
  const stop = main.slice(main.indexOf('async function stopBackend('), main.indexOf('async function runRestoreWorker('))
  assert.match(stop, /await waitForMcpStdioShutdown\(closeMcpStdio\)/)
  assert.ok(stop.indexOf('await waitForMcpStdioShutdown') < stop.indexOf('child.kill()'))
  assert.match(stop, /if \(!nativeStopped\)[\s\S]*if \(requireExit\) throw/)
})
