import assert from 'node:assert/strict'
import test from 'node:test'
import { UsageRegistry, parseUsageMeterEntries } from './usageRegistry.ts'

test('registry meters are tenant-isolated and snapshots identify exact owners', () => {
  let now = 1_000
  const registry = new UsageRegistry(() => now, () => 'tenant-default')
  registry.record(100, 25, 'tenant-a')
  registry.record(7, 3, 'tenant-b')
  assert.equal(registry.readForTenant('tenant-a').snapshot().fiveHour.consumed, 125)
  assert.equal(registry.readForTenant('tenant-b').snapshot().fiveHour.consumed, 10)
  assert.ok(registry.readForTenant().snapshot().fiveHour.consumed > 0, 'default meter keeps the demo seed')
  assert.deepEqual(registry.snapshot().map(([tenant]) => tenant), ['tenant-default', 'tenant-a', 'tenant-b'])
  now += 1
})

test('rehydration replaces stale tenants and does not restore omitted default spend', () => {
  const registry = new UsageRegistry(() => 1_000, () => 'tenant-default')
  registry.record(500, 0)
  registry.record(90, 0, 'stale-tenant')
  registry.rehydrate([['retained-tenant', { fiveHour: { start: 1_000, consumed: 12 }, weekly: { start: 1_000, consumed: 12 } }]], false)
  assert.deepEqual(registry.snapshot().map(([tenant]) => tenant), ['retained-tenant'])
  assert.equal(registry.readForTenant().snapshot().fiveHour.consumed, 0)
  assert.equal(registry.snapshot().some(([tenant]) => tenant === 'stale-tenant'), false)
})

test('absent state seeds only when requested, while present empty state never seeds', () => {
  const registry = new UsageRegistry(() => 0, () => 'tenant-default')
  registry.rehydrate(undefined, true)
  assert.ok(registry.readForTenant().snapshot().fiveHour.consumed > 0)
  registry.rehydrate(undefined, false)
  assert.equal(registry.readForTenant().snapshot().fiveHour.consumed, 0)
  registry.rehydrate([], true)
  assert.deepEqual(registry.snapshot(), [])
  assert.equal(registry.readForTenant().snapshot().fiveHour.consumed, 0)
})

test('duplicate, invalid, and malformed entries fail before changing live registry state', () => {
  const registry = new UsageRegistry(() => 0, () => 'tenant-default')
  registry.record(42, 0, 'keep')
  const before = registry.snapshot()
  const valid = ['keep', { fiveHour: { start: 0, consumed: 1 }, weekly: { start: 0, consumed: 1 } }] as const
  const invalid: unknown[] = [
    [valid, valid],
    [['', valid[1]]],
    [['bad\u0000tenant', valid[1]]],
    [['tenant-' + 'x'.repeat(257), valid[1]]],
    [['broken-state', { fiveHour: { start: 0, consumed: -1 }, weekly: { start: 0, consumed: 0 } }]],
    [['extra-state', { fiveHour: { start: 0, consumed: 0 }, weekly: { start: 0, consumed: 0 }, ceiling: 1 }]],
    [[' leading', valid[1]]],
    [['trailing ', valid[1]]],
    [['   ', valid[1]]],
  ]
  const sparse: unknown[] = []
  sparse[1] = valid
  invalid.push(sparse)
  for (const candidate of invalid) {
    assert.throws(() => registry.rehydrate(candidate as any, false))
    assert.deepEqual(registry.snapshot(), before)
  }
  assert.throws(() => registry.readForTenant(''))
  assert.throws(() => registry.readForTenant('bad\u0000tenant'))
  assert.throws(() => registry.readForTenant(' leading'))
  assert.throws(() => registry.readForTenant('trailing '))
  for (const tenant of ['', 'bad\u0000tenant', ' leading', 'trailing ']) {
    assert.throws(() => registry.record(1, 0, tenant))
    assert.deepEqual(registry.snapshot(), before)
  }
  assert.throws(() => parseUsageMeterEntries({} as any))
})

test('registry and parser snapshots are detached from caller and registry state', () => {
  const source = [['tenant-a', { fiveHour: { start: 0, consumed: 4 }, weekly: { start: 0, consumed: 9 } }]] as const
  const parsed = parseUsageMeterEntries(source)
  const registry = new UsageRegistry(() => 0, () => 'tenant-default')
  registry.rehydrate(parsed, false)
  const snapshot = registry.snapshot()
  snapshot[0]![1].fiveHour.consumed = 999
  assert.equal(registry.readForTenant('tenant-a').snapshot().fiveHour.consumed, 4)
  ;(source[0]![1].fiveHour as { consumed: number }).consumed = 100
  assert.equal(registry.readForTenant('tenant-a').snapshot().fiveHour.consumed, 4)
})

test('gauge and gate reads cannot grow retained tenant state before reported spend', () => {
  let now = 1_000
  const registry = new UsageRegistry(() => now, () => 'tenant-default')
  registry.rehydrate([], false)
  for (let index = 0; index < 2_000; index++) {
    const meter = registry.readForTenant(`tenant-${index}`)
    assert.equal(meter.overLimit(), null)
    assert.equal(meter.planLimits()[0]!.pct, 0)
  }
  registry.planCeilings()
  assert.deepEqual(registry.snapshot(), [])
  now = 2_000
  registry.record(10, 2, 'tenant-1')
  assert.deepEqual(registry.readForTenant('tenant-1').snapshot().fiveHour, { start: 2_000, consumed: 12 })
  assert.deepEqual(registry.snapshot().map(([id]) => id), ['tenant-1'])
  assert.throws(() => registry.readForTenant(' '))
})
