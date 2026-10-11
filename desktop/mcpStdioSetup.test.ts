import test from 'node:test'
import assert from 'node:assert/strict'
import { createMcpStdioSetup, mcpStdioReply } from './mcpStdioSetup.mjs'
import { McpStdioGrantError } from './mcpStdioGrantVault.mjs'
import { McpStdioDefinitiveInspectionRefusal } from './mcpStdioSource.mjs'

const id = `mcp-connection-${'a'.repeat(32)}`
const reference = `MCP_STDIO_${'A'.repeat(32)}`
const launch = { executable: '/usr/bin/fixture', args: ['private-argument'], cwd: '/tmp', env: { PRIVATE_ENV: 'private-value' } }
const binding = { tenantId: 'tenant-a', ownerUserId: 'user-a', connectionId: id, connectionRevision: 0 }
const initial = { stamp: 'source-a', binding, connection: { revision: 0, status: 'unverified', inspectionOperationId: null } }
const precondition = { expectedRevision: 0, source: { tenantId: binding.tenantId, userId: binding.ownerUserId } }
function fixture(overrides = {}) {
  let latest = structuredClone(initial), current = true, count = 0
  const events: string[] = []
  const lifecycle = {
    configure: async (_binding, config, options) => { assert.equal(options.isCurrent(), true); assert.deepEqual(config, launch); events.push('configure'); return reference },
    permitSetup: () => { events.push('permit'); return Object.freeze({}) },
    isCurrent: () => current,
    completeSetup: () => { events.push('complete') },
    cancelSetup: () => { events.push('cancel') },
    abandonSetup: () => { events.push('abandon') },
    ...overrides.lifecycle,
  }
  const source = {
    resolveSource: async () => structuredClone(latest), isSourceCurrent: () => current, close: () => {},
    inspect: async (_source, request, options) => {
      assert.equal(options.beforeSubmit(), true)
      events.push('inspect')
      latest = { ...initial, binding: { ...binding, connectionRevision: 1 },
        connection: { revision: 1, status: 'connected', inspectionOperationId: request.operationId } }
      return structuredClone(latest)
    },
    ...overrides.source,
  }
  const host = createMcpStdioSetup({ lifecycle, source, assertCaller: () => true, uuid: () => `fixture-${++count}`, ...overrides.host })
  return { host, events, lifecycle, source, setCurrent: value => { current = value }, setLatest: value => { latest = value } }
}

test('setup prepares without code execution, then configures and inspects exactly once', async t => {
  const { host, events } = fixture()
  t.after(() => host.close())
  const prepared = await host.start({}, { connectionId: id, launch, ...precondition })
  assert.equal(prepared.status, 'ready')
  assert.deepEqual(events, [])
  const result = await host.authorize({}, { flowId: prepared.flowId })
  assert.equal(result.status, 'connected')
  assert.deepEqual(events, ['configure', 'permit', 'inspect', 'complete'])
  assert.deepEqual(await host.authorize({}, { flowId: prepared.flowId }), result)
  assert.deepEqual(await host.reconcile({}, { flowId: prepared.flowId }), result)
  assert.deepEqual(events, ['configure', 'permit', 'inspect', 'complete'])
  assert.doesNotMatch(JSON.stringify({ prepared, result }), /private-|executable|MCP_STDIO|ownerUserId|tenantId/)
})

test('lost response remains uncertain and explicit reconciliation only reads the receipt', async t => {
  const value = fixture()
  t.after(() => value.host.close())
  const inspect = value.source.inspect
  value.source.inspect = async (...args) => { await inspect(...args); throw new Error('lost ack with secret details') }
  const prepared = await value.host.start({}, { connectionId: id, launch, ...precondition })
  assert.equal((await value.host.authorize({}, { flowId: prepared.flowId })).status, 'uncertain')
  assert.equal((await value.host.authorize({}, { flowId: prepared.flowId })).status, 'uncertain')
  assert.equal((await value.host.reconcile({}, { flowId: prepared.flowId })).status, 'connected')
  assert.equal(value.events.filter(event => event === 'inspect').length, 1)
  assert.equal(value.events.includes('abandon'), false)
})

test('only the typed definitive precommit refusal abandons its exact provisional grant', async t => {
  let posts = 0
  const value = fixture({ source: { inspect: async (_source, _request, options) => {
    posts += 1
    assert.equal(options.beforeSubmit(), true)
    throw new McpStdioDefinitiveInspectionRefusal()
  } } })
  t.after(() => value.host.close())
  const prepared = await value.host.start({}, { connectionId: id, launch, ...precondition })
  const result = await value.host.authorize({}, { flowId: prepared.flowId })
  assert.equal(result.status, 'failed')
  assert.equal(posts, 1)
  assert.deepEqual(value.events, ['configure', 'permit', 'complete', 'abandon'])
  assert.equal((await value.host.authorize({}, { flowId: prepared.flowId })).status, 'failed')
  assert.equal(posts, 1, 'a definitive refusal is terminal and is never retried implicitly')
  assert.equal((await value.host.reconcile({}, { flowId: prepared.flowId })).status, 'failed')
})

test('a caller-supplied error code cannot impersonate the typed definitive refusal', async t => {
  const spoof = Object.assign(new Error('not trusted'), { code: 'definitive-inspection-refusal' })
  const value = fixture({ source: { inspect: async (_source, _request, options) => {
    assert.equal(options.beforeSubmit(), true)
    throw spoof
  } } })
  t.after(() => value.host.close())
  const prepared = await value.host.start({}, { connectionId: id, launch, ...precondition })
  assert.equal((await value.host.authorize({}, { flowId: prepared.flowId })).status, 'uncertain')
  assert.equal(value.events.includes('abandon'), false)
})

test('stale revision refuses configuration; source change refuses recovery', async t => {
  const value = fixture()
  t.after(() => value.host.close())
  const prepared = await value.host.start({}, { connectionId: id, launch, ...precondition })
  value.setLatest({ ...initial, binding: { ...binding, connectionRevision: 1 }, connection: { ...initial.connection, revision: 1 } })
  assert.equal((await value.host.authorize({}, { flowId: prepared.flowId })).status, 'failed')
  assert.deepEqual(value.events, [])
  value.setCurrent(false)
  await assert.rejects(value.host.reconcile({}, { flowId: prepared.flowId }), /stale/)
})

test('cancellation during durable configure retains then safely abandons exact pre-POST grant', async t => {
  let finish!: (value: string) => void
  const value = fixture({ lifecycle: { configure: () => new Promise<string>(resolve => { finish = resolve }) } })
  t.after(() => value.host.close())
  const prepared = await value.host.start({}, { connectionId: id, launch, ...precondition })
  const running = value.host.authorize({}, { flowId: prepared.flowId })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(value.host.cancel({}, { flowId: prepared.flowId }).status, 'cancelled')
  finish(reference)
  assert.equal((await running).status, 'cancelled')
  assert.deepEqual(value.events, ['abandon'])
})

test('parallel authorization cannot duplicate native consent; input is detached before source waits', async t => {
  let finish!: (value: string) => void
  let received
  const value = fixture({ lifecycle: { configure: (_binding, config) => {
    received = config
    return new Promise<string>(resolve => { finish = resolve })
  } } })
  t.after(() => value.host.close())
  const input = structuredClone(launch)
  const pending = value.host.start({}, { connectionId: id, launch: input, ...precondition })
  input.args[0] = 'redirected'
  const prepared = await pending
  const running = value.host.authorize({}, { flowId: prepared.flowId })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal((await value.host.authorize({}, { flowId: prepared.flowId })).status, 'working')
  assert.deepEqual(received, launch)
  finish(reference)
  assert.equal((await running).status, 'connected')
})

test('malformed native requests and caller refusal cannot inspect or reflect errors', async t => {
  const value = fixture()
  t.after(() => value.host.close())
  for (const input of [{ connectionId: id, launch, ...precondition, ownerUserId: 'foreign' }, { connectionId: id, launch: { ...launch, shell: true }, ...precondition },
    Object.defineProperty({ connectionId: id, ...precondition }, 'launch', { enumerable: true, get() { throw new Error('must not run') } })]) {
    await assert.rejects(value.host.start({}, input), /invalid/)
  }
  assert.deepEqual(value.events, [])
  const reply = await mcpStdioReply(() => { throw new Error('secret executable') })
  assert.deepEqual(reply, { ok: false, error: 'unavailable' })
  const refused = fixture({ host: { assertCaller: () => false } })
  t.after(() => refused.host.close())
  await assert.rejects(refused.host.start({}, { connectionId: id, launch, ...precondition }), /stale/)
})

test('native cancellation is reported as cancelled without inspection or a saved grant', async t => {
  const value = fixture({ lifecycle: { configure: async () => { throw new McpStdioGrantError('cancelled') } } })
  t.after(() => value.host.close())
  const prepared = await value.host.start({}, { connectionId: id, launch, ...precondition })
  assert.equal((await value.host.authorize({}, { flowId: prepared.flowId })).status, 'cancelled')
  assert.deepEqual(value.events, [])
})

test('renderer source and revision are detached preconditions, never native authority', async t => {
  const value = fixture()
  t.after(() => value.host.close())
  for (const expected of [
    { ...precondition, expectedRevision: 1 },
    { ...precondition, source: { ...precondition.source, userId: 'other-user' } },
    { ...precondition, source: { ...precondition.source, tenantId: 'other-tenant' } },
  ]) await assert.rejects(value.host.start({}, { connectionId: id, launch, ...expected }), /stale/)
  for (const expected of [{ ...precondition, expectedRevision: -1 },
    { ...precondition, source: { ...precondition.source, extra: true } },
    { ...precondition, source: Object.defineProperty({}, 'tenantId', { get() { throw new Error('not evaluated') } }) },
  ]) await assert.rejects(value.host.start({}, { connectionId: id, launch, ...expected }), /invalid/)
  const input = { connectionId: id, launch, ...structuredClone(precondition) }
  const pending = value.host.start({}, input)
  input.source.userId = 'other-user'
  input.expectedRevision = 2
  assert.equal((await pending).status, 'ready')
  assert.deepEqual(value.events, [])
})
