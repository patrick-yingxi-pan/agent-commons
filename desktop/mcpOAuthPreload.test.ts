import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { mcpOAuthChannels, mcpOAuthReply } from './mcpOAuthRuntime.mjs'
import { McpOAuthHostError } from './mcpOAuthHost.mjs'

const source = readFileSync(new URL('./preload.cjs', import.meta.url), 'utf8')
function preload(reply: any, enabled = true) {
  let bridge: any
  const calls: any[] = []
  vm.runInNewContext(source, {
    process: { argv: enabled ? ['--agent-commons-mcp-oauth=true'] : [], platform: 'darwin' },
    require(name: string) {
      assert.equal(name, 'electron')
      return { contextBridge: { exposeInMainWorld(_name: string, value: any) { bridge = value } },
        ipcRenderer: { invoke(...args: any[]) { calls.push(args); return typeof reply === 'function' ? reply() : reply } } }
    },
  })
  return { bridge, calls }
}

test('OAuth preload exposes only the five fixed verbs after native availability', async () => {
  assert.equal(preload(undefined, false).bridge.mcpOAuth, undefined)
  const value = { status: 'cancelled' }
  const { bridge, calls } = preload({ ok: true, value })
  assert.deepEqual(Object.keys(bridge.mcpOAuth), Object.keys(mcpOAuthChannels))
  assert.equal(Object.isFrozen(bridge.mcpOAuth), true)
  for (const [method, channel] of Object.entries(mcpOAuthChannels)) {
    const request = { flowId: 'test-flow' }
    assert.equal(await bridge.mcpOAuth[method](request), value)
    assert.deepEqual(calls.at(-1), [channel, request])
  }
})

test('OAuth preload failures never reflect native exception text or malformed envelopes', async () => {
  const secret = 'private-token-and-path-canary'
  for (const reply of [null, { ok: true }, { ok: false, error: secret },
    { ok: false, error: 'busy', message: secret }, Object.create({ ok: true, value: secret }),
    () => Promise.reject(new Error(secret))]) {
    const { bridge } = preload(reply)
    await assert.rejects(bridge.mcpOAuth.start({}), (error: any) => {
      assert.equal(error.code, 'unavailable')
      assert.equal(error.message, 'MCP sign-in could not be completed (unavailable).')
      assert.equal(error.cause, undefined)
      return true
    })
  }
  for (const code of ['request', 'busy', 'stale', 'expired', 'cancelled', 'conflict', 'unavailable']) {
    await assert.rejects(preload({ ok: false, error: code }).bridge.mcpOAuth.cancel({}), (error: any) => error.code === code)
  }
})

test('main OAuth envelope admits typed errors only, not arbitrary native code or message properties', async () => {
  assert.deepEqual(await mcpOAuthReply(() => ({ status: 'cancelled' })), { ok: true, value: { status: 'cancelled' } })
  assert.deepEqual(await mcpOAuthReply(() => { throw new McpOAuthHostError('stale') }), { ok: false, error: 'stale' })
  assert.deepEqual(await mcpOAuthReply(() => { throw Object.assign(new Error('secret'), { code: 'busy' }) }),
    { ok: false, error: 'unavailable' })
})
