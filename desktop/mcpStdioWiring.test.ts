import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { desktopBackendEnvironment } from './runtime.mjs'
import { mcpStdioChannels } from './mcpStdioSetup.mjs'
import { MCP_STDIO_PROTOCOL_LIMITS } from './mcpStdioProtocol.mjs'
import { MCP_STDIO_LIFECYCLE_LIMITS } from './mcpStdioLifecycle.mjs'
import { MCP_STDIO_GRANT_LIMITS } from './mcpStdioGrantVault.mjs'
import { MAX_MCP_STDIO_CONNECTIONS } from '../server/mcpConnections.ts'

const main = readFileSync(new URL('./main.mjs', import.meta.url), 'utf8')
const preload = readFileSync(new URL('./preload.cjs', import.meta.url), 'utf8')
const startup = readFileSync(new URL('../scripts/start.mjs', import.meta.url), 'utf8')

test('portable local-server capacity cannot exceed any native synchronization or custody bound', () => {
  assert.equal(MAX_MCP_STDIO_CONNECTIONS, MCP_STDIO_PROTOCOL_LIMITS.syncEntries)
  assert.equal(MAX_MCP_STDIO_CONNECTIONS, MCP_STDIO_LIFECYCLE_LIMITS.bindings)
  assert.equal(MAX_MCP_STDIO_CONNECTIONS, MCP_STDIO_GRANT_LIMITS.entries)
})
function assertWiring(source: string) {
  const text = source.replace(/\s+/g, ' ')
  for (const expected of [
    "if (process.platform === 'darwin')",
    'confirmLaunch: confirmMcpStdioLaunch',
    'readSession: readMcpOAuthSession, isSessionCurrent: isMcpOAuthSessionCurrent',
    'assertCaller: assertTrustedMcpStdioCaller',
    'mcpStdioAvailable: Boolean(mcpStdioLifecycle)',
    'open: (reference, binding, options) => mcpStdioLifecycle.open(reference, binding, options)',
    'isCurrent: (reference, binding, purpose) => mcpStdioLifecycle.isCurrent(reference, binding, purpose)',
    'synchronize: async bindings => ({ available: await mcpStdioLifecycle.synchronize(bindings) })',
    'mcpStdioSetup?.resetFlows()',
    'event.senderFrame !== event.sender.mainFrame || !mcpStdioLifecycle',
    'const literal = mcpStdioReviewLiteral',
    "buttons: ['Cancel', 'Allow local server'], defaultId: 0, cancelId: 0",
    "from '../contract/mcpStdioSetupCopy.mjs'",
    "MCP_STDIO_TOOL_APPROVAL_COPY + '\\n\\n'",
    'mcpStdioReply(() => mcpStdioSetup[method](event, request))',
    "...(mcpStdioSetup ? ['--agent-commons-mcp-stdio=true'] : [])",
  ]) assert.ok(text.includes(expected), `Local MCP must retain: ${expected}`)
  assert.ok(source.indexOf('mcpStdioSetup = createMcpStdioSetup(') < source.indexOf('await launchBackend('))
}

test('local MCP startup binds native custody, trusted cookies and default-Cancel main-frame review', () => {
  assertWiring(main)
  const mutated = main.replace("buttons: ['Cancel', 'Allow local server'], defaultId: 0", "buttons: ['Cancel', 'Allow local server'], defaultId: 1")
  assert.notEqual(mutated, main)
  assert.throws(() => assertWiring(mutated), assert.AssertionError)
  assert.match(startup, /profile === 'desktop' && process.platform === 'darwin' && process.env.AGENT_COMMONS_MCP_STDIO_AVAILABLE === 'true'/)
  assert.ok(startup.indexOf('installMcpStdioRuntime()') < startup.indexOf("await import('../server/index.ts')"))
  const options = { port: 12345, rendererOrigin: 'http://127.0.0.1:12345', userDataPath: '/private/stdio-test', authSecret: 'fixture',
    baseEnv: { AGENT_COMMONS_MCP_STDIO_AVAILABLE: 'true' } }
  assert.equal(desktopBackendEnvironment(options).AGENT_COMMONS_MCP_STDIO_AVAILABLE, 'false')
  assert.equal(desktopBackendEnvironment({ ...options, mcpStdioAvailable: true }).AGENT_COMMONS_MCP_STDIO_AVAILABLE, 'true')
  assert.equal(desktopBackendEnvironment({ ...options, mcpStdioAvailable: 'true' }).AGENT_COMMONS_MCP_STDIO_AVAILABLE, 'false')
})

function bridge(reply: unknown, enabled = true, platform = 'darwin') {
  let result: any
  const calls: unknown[][] = []
  vm.runInNewContext(preload, {
    process: { argv: enabled ? ['--agent-commons-mcp-stdio=true'] : [], platform },
    require(name: string) {
      assert.equal(name, 'electron')
      return { contextBridge: { exposeInMainWorld(_name: string, value: unknown) { result = value } },
        ipcRenderer: { invoke(...args: unknown[]) { calls.push(args); return typeof reply === 'function' ? reply() : reply } } }
    },
  })
  return { result, calls }
}

test('local MCP preload offers four fixed verbs only on an admitted macOS host', async () => {
  assert.equal(bridge(null, false).result.mcpStdio, undefined)
  assert.equal(bridge(null, true, 'linux').result.mcpStdio, undefined)
  const value = { status: 'cancelled' }
  const { result, calls } = bridge({ ok: true, value })
  assert.deepEqual(Object.keys(result.mcpStdio), Object.keys(mcpStdioChannels))
  assert.equal(Object.isFrozen(result.mcpStdio), true)
  for (const [method, channel] of Object.entries(mcpStdioChannels)) {
    const request = { flowId: 'fixture' }
    assert.equal(await result.mcpStdio[method](request), value)
    assert.deepEqual(calls.at(-1), [channel, request])
  }
})

test('local MCP preload never reflects native diagnostics or mixed failure envelopes', async () => {
  for (const reply of [null, { ok: true }, { ok: false, error: 'private-path' },
    { ok: false, error: 'busy', message: 'private-path' }, Object.create({ ok: true, value: 'private-path' }),
    () => Promise.reject(new Error('private-path'))]) {
    await assert.rejects(bridge(reply).result.mcpStdio.start({}), (error: any) => {
      assert.equal(error.code, 'unavailable')
      assert.doesNotMatch(error.message, /private-path/)
      assert.equal(error.cause, undefined)
      return true
    })
  }
  for (const code of ['invalid', 'busy', 'stale', 'expired', 'cancelled', 'unavailable']) {
    await assert.rejects(bridge({ ok: false, error: code }).result.mcpStdio.cancel({}), (error: any) => error.code === code)
  }
})
