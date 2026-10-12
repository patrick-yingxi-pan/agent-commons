import assert from 'node:assert/strict'
import { test } from 'node:test'
import { UsageRegistry, UsageReservationError, parseUsageReservations } from './usageRegistry.ts'

const FIVE_HOURS = 5 * 60 * 60 * 1000
const budget = (fiveHour: number, weekly = fiveHour) => ({ windows: [
  { label: '5-hour limit', ceiling: fiveHour },
  { label: 'Weekly · all models', ceiling: weekly },
] })

function registry(now: () => number, owner = 'tenant-a') {
  const usage = new UsageRegistry(now, () => owner)
  usage.rehydrate([], false)
  usage.rehydrateReservations(undefined)
  return usage
}

test('synchronous reservations serialize concurrent Commission preparations and all meter views see holds', () => {
  const usage = registry(() => 1_000_000)
  assert.equal(usage.reserve('claim-a', 'tenant-a', 60, [budget(100)]), true)
  assert.equal(usage.reserve('claim-a', 'tenant-a', 60, [budget(100)]), false, 'an exact duplicate claim does not reserve twice')
  assert.throws(() => usage.reserve('claim-a', 'tenant-a', 61, [budget(100)]),
    (error: unknown) => error instanceof UsageReservationError && error.code === 'stale')
  assert.throws(() => usage.reserve('claim-b', 'tenant-a', 50, [budget(100)]),
    (error: unknown) => error instanceof UsageReservationError && error.code === 'limit')
  assert.deepEqual(usage.readForTenant('tenant-a').overLimit(budget(50)), { label: '5-hour limit', ceiling: 50 })
  assert.equal(usage.reserved('tenant-a'), 60)
})

test('multiple applicable budgets take the minimum and unknown budget windows fail closed', () => {
  const usage = registry(() => 1_000_000)
  assert.throws(() => usage.reserve('unknown-budget', 'tenant-a', 1, [{ windows: [{ label: 'tokens-ish', ceiling: 100 }] }]),
    (error: unknown) => error instanceof UsageReservationError && error.code === 'invalid')
  assert.throws(() => usage.reserve('tight-budget', 'tenant-a', 60, [budget(100), budget(50)]),
    (error: unknown) => error instanceof UsageReservationError && error.code === 'limit')
  assert.deepEqual(usage.readForTenant('tenant-a').overLimit({ windows: [{ label: 'unknown', ceiling: 100 }] }),
    { label: 'unknown', ceiling: 0 })
})

test('reports are counted once, mismatched replays fail, and actual usage may exceed allowance', () => {
  const usage = registry(() => 1_000_000)
  usage.reserve('claim-report', 'tenant-a', 20, [budget(25)])
  assert.equal(usage.recordReserved('claim-report', 'tenant-a', 20, 10), true)
  assert.equal(usage.recordReserved('claim-report', 'tenant-a', 20, 10), false)
  assert.throws(() => usage.recordReserved('claim-report', 'tenant-a', 20, 11),
    (error: unknown) => error instanceof UsageReservationError && error.code === 'stale')
  assert.equal(usage.readForTenant('tenant-a').snapshot().fiveHour.consumed, 30)
  assert.deepEqual(usage.readForTenant('tenant-a').overLimit(budget(25)), { label: '5-hour limit', ceiling: 25 })
  assert.throws(() => usage.reserve('claim-after-overage', 'tenant-a', 1, [budget(25)]),
    (error: unknown) => error instanceof UsageReservationError && error.code === 'limit')
})

test('known settlement releases only unused capacity while retaining replay evidence', () => {
  const usage = registry(() => 1_000_000)
  usage.reserve('claim-settle', 'tenant-a', 80, [budget(100)])
  assert.throws(() => usage.settleReservation('claim-settle', 'tenant-a', true),
    (error: unknown) => error instanceof UsageReservationError && error.code === 'stale',
    'known usage cannot be asserted before a model report exists')
  usage.recordReserved('claim-settle', 'tenant-a', 25, 5)
  assert.equal(usage.reserved('tenant-a'), 50)
  usage.settleReservation('claim-settle', 'tenant-a', true)
  assert.equal(usage.reserved('tenant-a'), 0)
  assert.equal(usage.snapshotReservations()[0]?.status, 'settled')
  assert.equal(usage.recordReserved('claim-settle', 'tenant-a', 25, 5), false)
  assert.throws(() => usage.recordReserved('claim-settle', 'tenant-a', 26, 5),
    (error: unknown) => error instanceof UsageReservationError && error.code === 'stale')
})

test('unknown settlement and restart recovery retain the unreported allowance', () => {
  let now = 1_000_000
  const usage = registry(() => now)
  usage.reserve('claim-unknown', 'tenant-a', 80, [budget(100)])
  usage.recordReserved('claim-unknown', 'tenant-a', 10, 10)
  usage.settleReservation('claim-unknown', 'tenant-a', false)
  const persisted = usage.snapshotReservations()
  const restarted = registry(() => now)
  restarted.rehydrate(usage.snapshot(), false)
  restarted.rehydrateReservations(persisted)
  assert.equal(restarted.recoverReservations(), false, 'already uncertain reservations remain stable')
  assert.equal(restarted.reserved('tenant-a'), 60)
  assert.deepEqual(restarted.readForTenant('tenant-a').overLimit(budget(70)), { label: '5-hour limit', ceiling: 70 })
  assert.equal(restarted.recordReserved('claim-unknown', 'tenant-a', 10, 10), false)
  assert.throws(() => restarted.recordReserved('claim-unknown', 'tenant-a', 40, 2),
    (error: unknown) => error instanceof UsageReservationError && error.code === 'stale', 'a conflicting late report is refused')
})

test('active reservations span resets; recovered uncertain holds expire on anchored windows', () => {
  let now = 0
  const usage = registry(() => now)
  usage.reserve('claim-recover', 'tenant-a', 50, [budget(100)])
  now = FIVE_HOURS + 1
  assert.deepEqual(usage.readForTenant('tenant-a').overLimit(budget(50)), { label: '5-hour limit', ceiling: 50 },
    'an active request keeps occupying a reset current window')
  assert.throws(() => usage.reserve('claim-during-reset', 'tenant-a', 60, [budget(100)]),
    (error: unknown) => error instanceof UsageReservationError && error.code === 'limit')

  const persisted = usage.snapshotReservations()
  const restarted = registry(() => now)
  restarted.rehydrate(usage.snapshot(), false)
  restarted.rehydrateReservations(persisted)
  assert.equal(restarted.recoverReservations(), true)
  assert.equal(restarted.snapshotReservations()[0]?.status, 'uncertain')
  assert.equal(restarted.reserved('tenant-a'), 50)
  assert.equal(restarted.readForTenant('tenant-a').overLimit(budget(100)), null,
    'after recovery the expired five-hour anchor no longer blocks that window')
  assert.deepEqual(restarted.readForTenant('tenant-a').overLimit(budget(100, 25)), { label: 'Weekly · all models', ceiling: 25 },
    'the weekly reservation remains through its longer window')
  assert.equal(restarted.reserve('claim-after-five-hour-expiry', 'tenant-a', 60,
    [{ windows: [{ label: '5-hour limit', ceiling: 100 }] }]), true,
    'the five-hour capacity can be reused after the recovered hold expires there')
  restarted.recordReserved('claim-after-five-hour-expiry', 'tenant-a', 0, 0)
  restarted.settleReservation('claim-after-five-hour-expiry', 'tenant-a', true)

  now = 7 * 24 * 60 * 60 * 1000 + 1
  assert.equal(restarted.reserved('tenant-a'), 0)
  now = FIVE_HOURS + 1 // rollback before the weekly anchor cannot release that hold early
  assert.deepEqual(restarted.readForTenant('tenant-a').overLimit(budget(100, 25)), { label: 'Weekly · all models', ceiling: 25 })
})

test('reservation slice is strict and missing legacy data restores as empty', () => {
  const usage = registry(() => 1_000_000)
  usage.reserve('strict-row', 'tenant-a', 10, [])
  const snapshot = usage.snapshotReservations()
  assert.deepEqual(parseUsageReservations(snapshot), snapshot)
  assert.throws(() => parseUsageReservations([...snapshot, snapshot[0]]), /reservation invalid/)
  assert.throws(() => parseUsageReservations([{ ...snapshot[0], report: { inputTokens: -1, outputTokens: 0 } }]), /reservation invalid/)
  assert.throws(() => parseUsageReservations([{ ...snapshot[0], status: 'settled' }]), /reservation invalid/)
  const restored = registry(() => 1_000_000)
  restored.rehydrateReservations(undefined)
  assert.deepEqual(restored.snapshotReservations(), [])
  restored.rehydrateReservations([])
  assert.deepEqual(restored.snapshotReservations(), [])
})
