/** Project-as-guarded-resource (docs/agent-commons.md, D11). The seeded guarded
 *  Project routes its non-monotonic effects through the existing ResourceGuardian
 *  (D5), single-principal: one holder commits; a concurrent *different* holder is
 *  refused up front (the escrow). An unguarded Project is coordination-free. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../server/store.ts'
import { GuardianError } from '../server/guardian.ts'

const GUARDED = 'p-insights' // seeded with a guardianId (server/data/cowork.ts)

test('the seeded Project is registered as a guarded resource (D11)', () => {
  const project = store.listProjects().find((p) => p.id === GUARDED)
  assert.ok(project?.guardianId, 'p-insights carries a guardianId')
})

test('guardProjectEffect runs + commits the effect, then frees the lease', () => {
  let ran = false
  const out = store.guardProjectEffect(GUARDED, 'session-A', () => {
    ran = true
    return 'done'
  })
  assert.equal(ran, true)
  assert.equal(out, 'done')
  // The lease is released after the effect — the resource is free again.
  assert.equal(store.guardian.status(GUARDED).active.length, 0)
})

test('a concurrent effect by a different principal is refused, freed after release', () => {
  // Principal A holds the Project's guardian (an in-flight reservation).
  const held = store.guardian.reserve(GUARDED, 'session-A')
  assert.throws(
    () => store.guardProjectEffect(GUARDED, 'session-B', () => 'B wins'),
    GuardianError,
    'a second principal is refused while A holds the Project',
  )
  store.guardian.release(held.id) // A done
  let ran = false
  store.guardProjectEffect(GUARDED, 'session-B', () => (ran = true))
  assert.equal(ran, true, 'B proceeds once A releases')
})

test('an unguarded Project runs the effect coordination-free', () => {
  const unguarded = store.listProjects().find((p) => !p.guardianId)
  assert.ok(unguarded, 'there is an unguarded project')
  let ran = false
  store.guardProjectEffect(unguarded!.id, 'whoever', () => (ran = true))
  assert.equal(ran, true)
})
