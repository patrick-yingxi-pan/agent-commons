/** Unit tests for the native-runner registry (server/registry.ts) — the broker's
 *  live view of connected hosts. The emit callback + clock are injected so every
 *  assertion about events and lastSeen is deterministic. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RunnerRegistry } from '../server/registry.ts'
import type { RunnerCapability, ServerEvent } from '../contract/index.ts'

function harness() {
  const events: ServerEvent[] = []
  let clock = 1000
  const reg = new RunnerRegistry(
    (e) => events.push(e),
    () => clock,
  )
  return { events, reg, tick: (n = 1) => (clock += n) }
}

const FS: RunnerCapability[] = [{ type: 'fs.read', scopes: ['~/p'] }]

test('register: a new runner comes online, is listed, emits runner.connected', () => {
  const { reg, events } = harness()
  const a = reg.register({ id: 'a1', label: 'Laptop', host: 'localhost', capabilities: FS })
  assert.equal(a.id, 'a1')
  assert.equal(a.status, 'online')
  assert.equal(a.lastSeen, 1000)
  assert.deepEqual(
    reg.list().map((x) => x.id),
    ['a1'],
  )
  assert.deepEqual(events, [{ type: 'agent.connected', runner: a }])
})

test('register without an id mints a durable id', () => {
  const { reg } = harness()
  const a = reg.register({ label: 'X', host: 'h', capabilities: [] })
  // The minted id prefix ('agent-') is serialized wire surface, deferred to step 1b.
  assert.match(a.id, /^agent-/)
})

test('idempotent re-register (online, unchanged caps) emits nothing further', () => {
  const { reg, events } = harness()
  reg.register({ id: 'a1', label: 'L', host: 'h', capabilities: FS })
  reg.register({ id: 'a1', label: 'L', host: 'h', capabilities: FS })
  assert.equal(events.length, 1) // only the initial connect
})

test('re-register with changed caps emits runner.capabilities.changed', () => {
  const { reg, events } = harness()
  reg.register({ id: 'a1', label: 'L', host: 'h', capabilities: FS })
  reg.register({
    id: 'a1',
    label: 'L',
    host: 'h',
    capabilities: [...FS, { type: 'terminal', scopes: ['*'] }],
  })
  assert.deepEqual(
    events.map((e) => e.type),
    ['agent.connected', 'agent.capabilities.changed'],
  )
})

test('setCapabilities emits only when the grant set actually changes', () => {
  const { reg, events } = harness()
  reg.register({ id: 'a1', label: 'L', host: 'h', capabilities: FS })
  reg.setCapabilities('a1', FS) // same set → silent
  assert.equal(events.length, 1)
  reg.setCapabilities('a1', []) // changed → event
  assert.equal(events.at(-1)?.type, 'agent.capabilities.changed')
  assert.deepEqual(reg.get('a1')?.capabilities, [])
})

test('deregister marks offline (durable), emits runner.disconnected, keeps the record', () => {
  const { reg, events } = harness()
  reg.register({ id: 'a1', label: 'L', host: 'h', capabilities: FS })
  assert.equal(reg.deregister('a1'), true)
  assert.equal(reg.get('a1')?.status, 'offline')
  assert.deepEqual(
    reg.list().map((x) => x.id),
    ['a1'],
  ) // identity persists
  assert.deepEqual(events.at(-1), { type: 'agent.disconnected', agentId: 'a1' })
  assert.equal(reg.deregister('a1'), false) // already offline → no-op
})

test('heartbeat reconnects an offline runner and refreshes lastSeen', () => {
  const { reg, events, tick } = harness()
  reg.register({ id: 'a1', label: 'L', host: 'h', capabilities: FS })
  reg.deregister('a1')
  tick(50)
  const a = reg.heartbeat('a1')
  assert.equal(a?.status, 'online')
  assert.equal(a?.lastSeen, 1050)
  assert.equal(events.at(-1)?.type, 'agent.connected')
})

test('lifecycle ops on an unknown id return undefined/false (no throw)', () => {
  const { reg } = harness()
  assert.equal(reg.heartbeat('nope'), undefined)
  assert.equal(reg.setCapabilities('nope', []), undefined)
  assert.equal(reg.deregister('nope'), false)
})

test('find returns only online runners advertising a capability', () => {
  const { reg } = harness()
  reg.register({ id: 'a1', label: 'L', host: 'h', capabilities: [{ type: 'terminal', scopes: ['*'] }] })
  reg.register({ id: 'a2', label: 'M', host: 'h', capabilities: FS })
  assert.deepEqual(
    reg.find('terminal').map((a) => a.id),
    ['a1'],
  )
  assert.deepEqual(
    reg.find('fs.read').map((a) => a.id),
    ['a2'],
  )
  reg.deregister('a1')
  assert.deepEqual(reg.find('terminal'), []) // offline excluded
})
