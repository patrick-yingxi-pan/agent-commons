import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { McpStdioSetupSource, McpStdioSetupView, NativeMcpStdioBridge } from '../../contract/mcpStdioSetup.ts'
import { createMcpStdioSetupController } from './mcpStdioSetupCore.ts'
const source = { tenantId: 'tenant-fixture', userId: 'person-fixture' }
const connection = { id: 'mcp-fixture', label: 'Private local fixture', revision: 3 }
const launch = () => ({ executable: '/fixture/program', cwd: '/fixture/work', args: ['argument-secret'], env: { TEST: 'environment-secret' } })
const view = (status: McpStdioSetupView['status'], changes: Partial<McpStdioSetupView> = {}): McpStdioSetupView => ({ flowId: 'flow-fixture', connectionId: connection.id, revision: status === 'connected' ? 4 : 3, status, ...changes })
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
function fixture(overrides: Partial<NativeMcpStdioBridge> = {}) {
  const calls: Array<{ method: string; request: unknown }> = [], refreshes: string[] = []
  let current: McpStdioSetupSource | null = source
  const api = Object.fromEntries(['start', 'authorize', 'reconcile', 'cancel'].map(method => [method, async (request: never) => {
    calls.push({ method, request })
    const override = overrides[method as keyof NativeMcpStdioBridge] as ((request: never) => Promise<McpStdioSetupView>) | undefined
    return override ? override(request) : view(method === 'start' ? 'ready' : method === 'cancel' ? 'cancelled' : 'connected')
  }])) as unknown as NativeMcpStdioBridge
  const core = createMcpStdioSetupController({ api, currentSource: () => current, refresh: id => refreshes.push(id) })
  return { core, calls, refreshes, source(next: McpStdioSetupSource | null) { current = next } }
}

test('one explicit review freezes native-only settings and retains its handle before authorize', async () => {
  const ready = deferred<McpStdioSetupView>()
  const f = fixture({ start: () => ready.promise, authorize: async () => {
    assert.equal(f.core.snapshot()[0]!.flowId, 'flow-fixture')
    assert.equal(f.core.snapshot()[0]!.phase, 'authorizing')
    return view('connected')
  } })
  const input = launch(), pending = f.core.begin(connection, source, input)
  input.args[0] = 'changed'; input.env.TEST = 'changed'
  await f.core.begin(connection, source, launch())
  assert.equal(f.calls.length, 1, 'duplicate panes share the synchronous hold')
  const request = f.calls[0]!.request as { launch: ReturnType<typeof launch>; source: unknown; expectedRevision: number }
  assert.equal(request.launch.args[0], 'argument-secret'); assert.equal(request.launch.env.TEST, 'environment-secret')
  assert.deepEqual(request.source, source); assert.equal(request.expectedRevision, 3)
  assert.doesNotMatch(JSON.stringify(f.core.snapshot()), /argument-secret|environment-secret|executable|cwd/)
  ready.resolve(view('ready')); await pending
  assert.deepEqual(f.calls.map(call => call.method), ['start', 'authorize'])
  assert.equal(f.core.snapshot()[0]!.phase, 'connected'); assert.deepEqual(f.refreshes, [connection.id])
})
test('lost authorize acknowledgement remains held across subscribers and Check invokes only exact read recovery', async () => {
  const f = fixture({ authorize: async () => { throw new Error('SECRET diagnostic') }, reconcile: async () => view('working') })
  const leave = f.core.subscribe(() => {})
  await f.core.begin(connection, source, launch()); leave()
  assert.equal(f.core.snapshot()[0]!.phase, 'uncertain')
  assert.deepEqual(f.refreshes, [connection.id], 'lost IPC acknowledgement still refreshes current cleanup/capability truth without another inspection')
  assert.doesNotMatch(JSON.stringify(f.core.snapshot()), /SECRET|argument-secret|environment-secret/)
  await f.core.begin(connection, source, launch())
  await f.core.check(connection.id); await f.core.check(connection.id)
  assert.deepEqual(f.calls.map(call => call.method), ['start', 'authorize', 'reconcile', 'reconcile'])
  assert.deepEqual(f.calls[2]!.request, { flowId: 'flow-fixture' })
  assert.equal(f.core.snapshot()[0]!.phase, 'working')
  f.core.dismiss(connection.id); assert.equal(f.core.snapshot().length, 1)
})
test('unknown, malformed and cross-flow status reads cannot release possible execution', async () => {
  let mode = 0
  const f = fixture({ authorize: async () => { throw new Error() }, reconcile: async () => {
    if (mode === 0) throw new Error('SECRET')
    return view('connected', mode === 1 ? { flowId: 'other' } : mode === 2 ? { connectionId: 'other' } : { revision: 2 })
  } })
  await f.core.begin(connection, source, launch())
  for (mode = 0; mode < 4; mode++) { await f.core.check(connection.id); assert.equal(f.core.snapshot()[0]!.phase, 'uncertain') }
  assert.equal(f.calls.filter(call => call.method === 'authorize').length, 1)
  assert.deepEqual(f.refreshes, [connection.id], 'only the original unknown acknowledgement prompts current-state refresh')
})
test('expired or source-invalidated handles end read recovery honestly without another inspection', async () => {
  for (const code of ['expired', 'stale']) {
    const f = fixture({ authorize: async () => { throw new Error() }, reconcile: async () => { throw Object.assign(new Error('SECRET'), { code }) } })
    await f.core.begin(connection, source, launch()); await f.core.check(connection.id)
    assert.equal(f.core.snapshot()[0]!.phase, 'failed')
    assert.match(f.core.snapshot()[0]!.error!, /saved connection shows current status/)
    assert.match(f.core.snapshot()[0]!.error!, /effects are not undone/)
    assert.deepEqual(f.calls.map(call => call.method), ['start', 'authorize', 'reconcile'])
    assert.deepEqual(f.refreshes, [connection.id, connection.id], 'lost acknowledgement and later expiry each refresh current public truth')
    f.core.dismiss(connection.id); assert.deepEqual(f.core.snapshot(), [])
  }
})
test('stale reviewed revisions cancel preparation before any native approval', async () => {
  const f = fixture({ start: async () => view('ready', { revision: 4 }) })
  await f.core.begin(connection, source, launch())
  assert.deepEqual(f.calls.map(call => call.method), ['start', 'cancel'])
  assert.equal(f.core.snapshot()[0]!.phase, 'failed')
})
test('account disposal and same-account reentry fence late preparation and sanitize native failures', async () => {
  const pending = deferred<McpStdioSetupView>(), f = fixture({ start: () => pending.promise })
  const run = f.core.begin(connection, source, launch())
  f.core.reset(); f.source({ tenantId: 'foreign', userId: 'foreign' }); f.source(source)
  pending.resolve(view('ready')); await run
  assert.deepEqual(f.calls.map(call => call.method), ['start', 'cancel'])
  assert.deepEqual(f.core.snapshot(), [])
  f.source(null); await f.core.begin(connection, source, launch()); assert.equal(f.calls.length, 2)
})
test('cancelling pending preparation cannot authorize a late response or replace a newer flow', async () => {
  const pending = deferred<McpStdioSetupView>(), f = fixture({ start: () => pending.promise })
  const run = f.core.begin(connection, source, launch())
  await f.core.cancel(connection.id)
  assert.equal(f.core.snapshot()[0]!.phase, 'cancelled')
  f.core.dismiss(connection.id)
  pending.resolve(view('ready')); await run
  assert.deepEqual(f.calls.map(call => call.method), ['start', 'cancel'])
  assert.deepEqual(f.core.snapshot(), [])
})
test('late preparation cannot republish a cancelled review retained by another pane', async () => {
  const pending = deferred<McpStdioSetupView>(), f = fixture({ start: () => pending.promise })
  const phases: string[] = []
  f.core.subscribe(() => phases.push(f.core.snapshot()[0]?.phase ?? 'empty'))
  const run = f.core.begin(connection, source, launch())
  await f.core.cancel(connection.id)
  pending.resolve(view('ready')); await run
  assert.deepEqual(phases, ['preparing', 'cancelled'])
  assert.equal(f.core.snapshot()[0]!.phase, 'cancelled')
  assert.equal(f.core.snapshot()[0]!.flowId, undefined)
  assert.deepEqual(f.calls.map(call => call.method), ['start', 'cancel'])
})
test('Stop after possible submission remains uncertain and late authorize cannot overwrite its receipt', async () => {
  const pending = deferred<McpStdioSetupView>(), f = fixture({ authorize: () => pending.promise, cancel: async () => view('uncertain'), reconcile: async () => view('disconnected', { revision: 5 }) })
  const run = f.core.begin(connection, source, launch())
  await Promise.resolve(); await Promise.resolve()
  assert.equal(f.core.snapshot()[0]!.phase, 'authorizing')
  await f.core.cancel(connection.id)
  pending.resolve(view('connected')); await run
  assert.equal(f.core.snapshot()[0]!.phase, 'uncertain')
  await f.core.check(connection.id)
  assert.equal(f.core.snapshot()[0]!.phase, 'disconnected')
  assert.equal(f.calls.filter(call => call.method === 'authorize').length, 1)
})
test('account disposal aborts exact active setup and drops late acknowledgements', async () => {
  const pending = deferred<McpStdioSetupView>(), f = fixture({ authorize: () => pending.promise })
  const run = f.core.begin(connection, source, launch())
  await Promise.resolve(); await Promise.resolve(); f.core.reset()
  pending.resolve(view('connected')); await run
  assert.deepEqual(f.core.snapshot(), []); assert.equal(f.refreshes.length, 0)
  assert.deepEqual(f.calls.at(-1), { method: 'cancel', request: { flowId: 'flow-fixture' } })
})
