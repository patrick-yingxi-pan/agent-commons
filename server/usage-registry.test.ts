import assert from 'node:assert/strict'
import test from 'node:test'
import type { Budget } from '../contract/index.ts'
import { BudgetError } from './usage.ts'
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

const FIVE_HOUR = '5-hour limit'
const WEEKLY = 'Weekly · all models'
const HOUR = 3_600_000
const budget = (fiveHour?: number, weekly?: number): Budget => ({ windows: [
  ...(fiveHour === undefined ? [] : [{ label: FIVE_HOUR, ceiling: fiveHour }]),
  ...(weekly === undefined ? [] : [{ label: WEEKLY, ceiling: weekly }]),
] })

test('public multi-budget gate takes each window minimum, preserves omitted inheritance, and refuses equality', () => {
  let now = 1_000
  const registry = new UsageRegistry(() => now, () => 'tenant-default')
  registry.rehydrate([], false)
  const constraints = [undefined, budget(100, 300), budget(60), budget(undefined, 150), budget()] as const
  const before = structuredClone(constraints)
  registry.record(59, 0, 'tenant-owner')
  assert.equal(registry.overLimit('tenant-owner', constraints), null, 'one token below every effective ceiling remains admissible')
  registry.record(1, 0, 'tenant-owner')
  assert.deepEqual(registry.overLimit('tenant-owner', constraints), { label: FIVE_HOUR, ceiling: 60 })
  assert.deepEqual(registry.overLimit('tenant-owner', [...constraints].reverse()), { label: FIVE_HOUR, ceiling: 60 },
    'budget order cannot replace a tighter parent or child constraint')
  now += 5 * HOUR
  registry.record(90, 0, 'tenant-owner')
  assert.deepEqual(registry.overLimit('tenant-owner', [budget(100, 300), budget(undefined, 150)]), { label: WEEKLY, ceiling: 150 },
    'a partial child inherits every omitted provider window')
  assert.deepEqual(constraints, before, 'gate reads never normalize or mutate caller-owned budgets')
})

test('public multi-budget gate always retains account ceilings and treats empty budgets as inheritance', () => {
  const registry = new UsageRegistry(() => 1_000, () => 'tenant-default')
  registry.rehydrate([], false)
  const account = registry.planCeilings()[0]!
  registry.record(account.ceiling, 0, 'tenant-owner')
  assert.deepEqual(registry.overLimit('tenant-owner'), account)
  assert.deepEqual(registry.overLimit('tenant-owner', [undefined, budget(), budget(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)]), account,
    'no supplied budget can widen the account plan')
})

test('public multi-budget gate counts active and uncertain reservations exactly once, and releases settled allowance', () => {
  let now = 1_000
  const registry = new UsageRegistry(() => now, () => 'tenant-default')
  registry.rehydrate([], false)
  const constraints = [budget(200, 200), budget(100, 100)]
  registry.record(25, 0, 'tenant-owner')
  registry.reserve('active-model-work', 'tenant-owner', 75, constraints)
  assert.deepEqual(registry.overLimit('tenant-owner', constraints), { label: FIVE_HOUR, ceiling: 100 })
  registry.recordReserved('active-model-work', 'tenant-owner', 30, 0)
  assert.deepEqual(registry.overLimit('tenant-owner', constraints), { label: FIVE_HOUR, ceiling: 100 },
    'reported usage replaces an equal portion of the live hold instead of counting twice')
  registry.settleReservation('active-model-work', 'tenant-owner', true)
  assert.equal(registry.overLimit('tenant-owner', constraints), null, 'settlement releases the unused allowance')
  registry.reserve('uncertain-model-work', 'tenant-owner', 45, constraints)
  registry.settleReservation('uncertain-model-work', 'tenant-owner', false)
  assert.deepEqual(registry.overLimit('tenant-owner', constraints), { label: FIVE_HOUR, ceiling: 100 })
  assert.equal(registry.overLimit('other-tenant', constraints), null, 'foreign reservations cannot consume this tenant’s capacity')
  now += 5 * HOUR
  assert.deepEqual(registry.overLimit('tenant-owner', constraints), { label: WEEKLY, ceiling: 100 },
    'an uncertain hold expires independently in each anchored window')
  now = 1_000 + 7 * 24 * HOUR
  assert.equal(registry.overLimit('tenant-owner', constraints), null)
})

test('public multi-budget gate rolls each window independently and preserves tenant isolation', () => {
  let now = 1_000
  const registry = new UsageRegistry(() => now, () => 'tenant-default')
  registry.rehydrate([], false)
  const constraints = [budget(100), budget(undefined, 150)]
  registry.record(100, 0, 'tenant-owner')
  assert.deepEqual(registry.overLimit('tenant-owner', constraints), { label: FIVE_HOUR, ceiling: 100 })
  assert.equal(registry.overLimit('other-tenant', constraints), null)
  now += 5 * HOUR
  assert.equal(registry.overLimit('tenant-owner', constraints), null)
  registry.record(50, 0, 'tenant-owner')
  assert.deepEqual(registry.overLimit('tenant-owner', constraints), { label: WEEKLY, ceiling: 150 })
  now = 1_000 + 7 * 24 * HOUR
  assert.equal(registry.overLimit('tenant-owner', constraints), null, 'expired weekly spend no longer gates the next period')
})

test('public multi-budget gate refuses invalid budgets without allocating or changing retained state', () => {
  const registry = new UsageRegistry(() => 1_000, () => 'tenant-default')
  registry.rehydrate([], false)
  const invalid: unknown[] = [null, {}, { windows: null }, { windows: [{ label: 'unknown window', ceiling: 10 }] },
    budget(-1), budget(1.5), budget(Number.NaN), budget(Number.MAX_SAFE_INTEGER + 1),
    { windows: [{ label: FIVE_HOUR, ceiling: 10 }, { label: FIVE_HOUR, ceiling: 20 }] },
    { windows: [null] }]
  for (const candidate of invalid) {
    const refusal = registry.overLimit('unmetered-tenant', [undefined, candidate as Budget])
    assert.ok(refusal, 'malformed present constraints must never become an unrestricted budget')
    assert.equal(refusal.ceiling, 0)
    assert.deepEqual(registry.snapshot(), [])
  }
  for (let index = 0; index < 2_000; index++) {
    assert.equal(registry.overLimit(`unmetered-${index}`, [undefined, budget(100), budget(undefined, 200)]), null)
  }
  assert.deepEqual(registry.snapshot(), [], 'admission reads must not create durable empty meter rows')
  for (const tenant of ['', ' ', 'bad\u0000tenant', ' leading', 'trailing ']) {
    assert.throws(() => registry.overLimit(tenant, [budget(100)]))
    assert.deepEqual(registry.snapshot(), [])
  }
})

test('budgetCeilings resolves complete sparse-parent minima with inheritance, zero caps and no consumption effects', () => {
  const registry = new UsageRegistry(() => 1_000, () => 'tenant-default')
  registry.rehydrate([], false)
  registry.record(75, 25, 'tenant-owner')
  registry.reserve('existing-capacity-hold', 'tenant-owner', 20)
  const metersBefore = registry.snapshot()
  const reservationsBefore = registry.snapshotReservations()
  const account = registry.planCeilings()
  assert.deepEqual(registry.budgetCeilings(), account)
  assert.deepEqual(registry.budgetCeilings([undefined, budget(), undefined]), account,
    'absence and an empty budget inherit every account window')
  const parents = [budget(100), undefined, budget(undefined, 300), budget(50, 500), budget()] as const
  const expected = [{ label: FIVE_HOUR, ceiling: 50 }, { label: WEEKLY, ceiling: 300 }]
  const parentsBefore = structuredClone(parents)
  assert.deepEqual(registry.budgetCeilings(parents), expected)
  assert.deepEqual(registry.budgetCeilings([...parents].reverse()), expected)
  assert.deepEqual(registry.budgetCeilings([budget(0), budget(undefined, 0)]),
    [{ label: FIVE_HOUR, ceiling: 0 }, { label: WEEKLY, ceiling: 0 }], 'zero is a real cap, never absence')
  assert.deepEqual(registry.budgetCeilings([budget(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)]), account)
  const detached = registry.budgetCeilings(parents)
  detached[0]!.ceiling = 9_999
  detached.push({ label: 'caller-only-window', ceiling: 1 })
  assert.deepEqual(registry.budgetCeilings(parents), expected)
  assert.deepEqual(parents, parentsBefore)
  assert.deepEqual(registry.snapshot(), metersBefore)
  assert.deepEqual(registry.snapshotReservations(), reservationsBefore)
})

test('budgetCeilings rejects malformed sparse parents as BudgetError without allocating meters or changing state', () => {
  const registry = new UsageRegistry(() => 1_000, () => 'tenant-default')
  registry.rehydrate([], false)
  const invalid: unknown[] = [null, {}, { windows: null }, { windows: {} },
    { windows: [{ label: 'unknown window', ceiling: 10 }] },
    { windows: [{ label: FIVE_HOUR, ceiling: 10 }, { label: FIVE_HOUR, ceiling: 20 }] },
    budget(-1), budget(1.5), budget(Number.NaN), budget(Number.POSITIVE_INFINITY), budget(Number.MAX_SAFE_INTEGER + 1),
    { windows: [null] }, { windows: [{ label: FIVE_HOUR }] }]
  for (const parent of invalid) {
    assert.throws(() => registry.budgetCeilings([budget(100), parent as Budget]), BudgetError)
    assert.deepEqual(registry.snapshot(), [])
    assert.deepEqual(registry.snapshotReservations(), [])
  }
  for (let index = 0; index < 100; index++) registry.budgetCeilings([budget(100)])
  assert.deepEqual(registry.snapshot(), [], 'pure ceiling resolution never creates the default or a tenant meter')
})
