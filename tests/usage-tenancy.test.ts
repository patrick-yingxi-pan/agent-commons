/** Per-tenant usage metering (F2/PD9, P5 MODEL-*) — the cost/budget axis of the tenancy
 *  boundary. Usage windows are metered PER TENANT: the default tenant owns the seeded demo
 *  meter (so the single-tenant mock gauge reads exactly as before), while every other tenant
 *  gets a *fresh* meter (starts at zero) — so one tenant's spend can neither 429 another via
 *  the per-turn gate nor show up in another's gauge. The header-driven route scoping is
 *  covered on the remote backend in tests/capability-remote.test.ts. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../server/store.ts'

test('a fresh (non-default) tenant starts at zero consumption; the default tenant is seeded', () => {
  // The default tenant (omitted ⇒ the mock's tenant) reads the seeded mid-period baseline.
  const seeded = store.usage(undefined).limits.find((w) => w.label === '5-hour limit')
  assert.ok(seeded && seeded.pct > 0, 'the default tenant shows the seeded baseline (a real-looking account)')

  // A brand-new tenant has consumed nothing — its gauge starts empty.
  const fresh = store.usage(undefined, 'tenant-usage-fresh').limits.find((w) => w.label === '5-hour limit')
  assert.ok(fresh && fresh.pct === 0, 'a fresh tenant starts at zero, not the demo baseline')
})

test('one tenant exhausting its window doesn’t 429 another, nor move its gauge', () => {
  const A = 'tenant-usage-a'
  const B = 'tenant-usage-b'

  // Before: neither is over, and B's gauge is empty.
  assert.equal(store.overSpendLimit(undefined, A), null, 'A is not over before spending')
  assert.equal(store.overSpendLimit(undefined, B), null, 'B is not over')
  assert.equal(store.usage(undefined, B).limits.find((w) => w.label === '5-hour limit')?.pct, 0, 'B starts empty')

  // A exhausts its 5-hour window (record ≥ the ceiling).
  store.recordUsage(1_200_000, 0, A)

  // A is now gated…
  const overA = store.overSpendLimit(undefined, A)
  assert.ok(overA && overA.label === '5-hour limit', 'A’s 5-hour window is exhausted → the turn gate fires')
  // …but B is untouched (isolation of both the gate and the gauge)…
  assert.equal(store.overSpendLimit(undefined, B), null, 'B is NOT gated by A’s spend')
  assert.equal(store.usage(undefined, B).limits.find((w) => w.label === '5-hour limit')?.pct, 0, 'A’s spend did not move B’s gauge')
  // …and the default tenant is untouched too (A is not the default).
  assert.equal(store.overSpendLimit(undefined), null, 'the default tenant is not gated by a non-default tenant’s spend')
})

test('an Agent budget still tightens the per-turn gate within a tenant', () => {
  const C = 'tenant-usage-c'
  // A budget capping the 5-hour window well below what C has spent makes the gate fire even
  // though the plan ceiling isn’t reached — the D8 attenuation, now per tenant.
  store.recordUsage(100_000, 0, C) // 100k of the 1.2M plan ceiling — not over the plan
  assert.equal(store.overSpendLimit(undefined, C), null, 'not over the plan ceiling on its own')
  const tightBudget = { windows: [{ label: '5-hour limit', ceiling: 50_000 }] }
  const over = store.overSpendLimit(tightBudget, C)
  assert.ok(over && over.ceiling === 50_000, 'a tighter Agent budget exhausts first — the gate fires at the effective ceiling')
})
