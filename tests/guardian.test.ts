/** Unit tests for the resource guardian (D5) — the escrow ledger that enforces a
 *  capacity invariant per shared resource. Uses a fresh guardian + a controllable
 *  clock so TTL behaviour is deterministic; emit is a no-op. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ResourceGuardian, GuardianError } from '../server/guardian.ts'

function make() {
  const now = { t: 1000 }
  const g = new ResourceGuardian(() => {}, () => now.t)
  return { g, now }
}

const isConflict = (e: unknown) => e instanceof GuardianError && e.code === 'conflict'
const isNotFound = (e: unknown) => e instanceof GuardianError && e.code === 'not_found'

test('reserve grants a held reservation; status reflects it', () => {
  const { g } = make()
  const r = g.reserve('res-A', 'sessA')
  assert.equal(r.status, 'held')
  assert.equal(r.resourceId, 'res-A')
  const s = g.status('res-A')
  assert.equal(s.capacity, 1)
  assert.equal(s.active.length, 1)
})

test('reserve is re-entrant for the same holder (no second slot)', () => {
  const { g } = make()
  const a = g.reserve('res-B', 'sessA')
  const b = g.reserve('res-B', 'sessA')
  assert.equal(a.id, b.id)
  assert.equal(g.status('res-B').active.length, 1)
})

test('a second distinct holder is refused at capacity 1 (conflict)', () => {
  const { g } = make()
  g.reserve('res-C', 'sessA')
  assert.throws(() => g.reserve('res-C', 'sessB'), isConflict)
})

test('capacity > 1 admits that many distinct holders, then conflicts', () => {
  const { g } = make()
  g.setCapacity('res-D', 2)
  g.reserve('res-D', 'sessA')
  g.reserve('res-D', 'sessB')
  assert.equal(g.status('res-D').active.length, 2)
  assert.throws(() => g.reserve('res-D', 'sessC'), isConflict)
})

test('release frees the slot for another holder', () => {
  const { g } = make()
  const a = g.reserve('res-E', 'sessA')
  g.release(a.id)
  const b = g.reserve('res-E', 'sessB')
  assert.equal(b.holder, 'sessB')
  assert.equal(g.status('res-E').active.length, 1)
})

test('commit records the irreversible step; idempotent', () => {
  const { g } = make()
  const a = g.reserve('res-F', 'sessA')
  assert.equal(g.commit(a.id).status, 'committed')
  assert.equal(g.commit(a.id).status, 'committed') // idempotent
})

test('a committed reservation still occupies its slot until released', () => {
  const { g } = make()
  const a = g.reserve('res-G', 'sessA')
  g.commit(a.id)
  assert.throws(() => g.reserve('res-G', 'sessB'), isConflict)
  g.release(a.id)
  assert.doesNotThrow(() => g.reserve('res-G', 'sessB'))
})

test('TTL expiry frees the slot', () => {
  const { g, now } = make()
  g.reserve('res-H', 'sessA', { ttlMs: 100 })
  assert.throws(() => g.reserve('res-H', 'sessB'), isConflict) // before expiry
  now.t += 101 // past expiry
  const b = g.reserve('res-H', 'sessB')
  assert.equal(b.holder, 'sessB')
  assert.equal(g.status('res-H').active.length, 1) // the lapsed one is gone
})

test('commit after expiry is a conflict (the slot is gone)', () => {
  const { g, now } = make()
  const a = g.reserve('res-I', 'sessA', { ttlMs: 100 })
  now.t += 101
  assert.throws(() => g.commit(a.id), isConflict)
})

test('commit / release on an unknown reservation throws not_found', () => {
  const { g } = make()
  assert.throws(() => g.commit('nope'), isNotFound)
  assert.throws(() => g.release('nope'), isNotFound)
})
