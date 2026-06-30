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
  assert.deepEqual(events, [{ type: 'runner.connected', runner: a }])
})

test('register without an id mints a durable id', () => {
  const { reg } = harness()
  const a = reg.register({ label: 'X', host: 'h', capabilities: [] })
  assert.match(a.id, /^runner-/)
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
    ['runner.connected', 'runner.capabilities.changed'],
  )
})

test('setCapabilities emits only when the grant set actually changes', () => {
  const { reg, events } = harness()
  reg.register({ id: 'a1', label: 'L', host: 'h', capabilities: FS })
  reg.setCapabilities('a1', FS) // same set → silent
  assert.equal(events.length, 1)
  reg.setCapabilities('a1', []) // changed → event
  assert.equal(events.at(-1)?.type, 'runner.capabilities.changed')
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
  assert.deepEqual(events.at(-1), { type: 'runner.disconnected', runnerId: 'a1' })
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
  assert.equal(events.at(-1)?.type, 'runner.connected')
})

test('lifecycle ops on an unknown id return undefined/false (no throw)', () => {
  const { reg } = harness()
  assert.equal(reg.heartbeat('nope'), undefined)
  assert.equal(reg.setCapabilities('nope', []), undefined)
  assert.equal(reg.deregister('nope'), false)
})

test('reapStale marks runners past the TTL offline (durable), emits disconnect, returns ids', () => {
  const { reg, events, tick } = harness()
  reg.register({ id: 'a1', label: 'L', host: 'h', capabilities: FS }) // lastSeen 1000
  tick(50)
  reg.register({ id: 'a2', label: 'M', host: 'h', capabilities: FS }) // lastSeen 1050
  tick(100) // clock 1150
  // TTL 120: a1 (last 1000, age 150) is stale; a2 (last 1050, age 100) is fresh.
  const reaped = reg.reapStale(120)
  assert.deepEqual(reaped, ['a1'])
  assert.equal(reg.get('a1')?.status, 'offline', 'stale runner reaped')
  assert.equal(reg.get('a2')?.status, 'online', 'fresh runner kept')
  assert.deepEqual(reg.list().map((x) => x.id), ['a1', 'a2'], 'identity persists (durable)')
  assert.deepEqual(events.at(-1), { type: 'runner.disconnected', runnerId: 'a1' })
  assert.equal(reg.find('fs.read').some((r) => r.id === 'a1'), false, 'reaped runner is no longer routed to')
})

test('reapStale is a no-op for an already-offline runner and for fresh runners', () => {
  const { reg, tick } = harness()
  reg.register({ id: 'a1', label: 'L', host: 'h', capabilities: FS })
  reg.deregister('a1') // already offline
  tick(10_000)
  assert.deepEqual(reg.reapStale(1), [], 'an offline runner is not re-reaped')
  reg.register({ id: 'a2', label: 'M', host: 'h', capabilities: FS })
  assert.deepEqual(reg.reapStale(120), [], 'a just-seen runner is not reaped')
})

test('a heartbeat rescues a runner from the next reap (refreshes lastSeen)', () => {
  const { reg, tick } = harness()
  reg.register({ id: 'a1', label: 'L', host: 'h', capabilities: FS })
  tick(100)
  reg.heartbeat('a1') // lastSeen now 1100
  tick(50) // clock 1150, age since heartbeat = 50
  assert.deepEqual(reg.reapStale(120), [], 'recent heartbeat keeps it online')
  assert.equal(reg.get('a1')?.status, 'online')
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
