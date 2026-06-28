/** Multi-principal coordination — sub-goal reservation (docs/agent-commons.md, D11).
 *  The coordination doc's residue, now the default case: different-user Contributors on
 *  one Project coordinate by reserving sub-goals at its Guardian. Different sub-goals →
 *  concurrent (distinct resources); the *same* sub-goal → the second Contributor is
 *  refused (conflict) and re-reasons. Arbitration is first-come (capacity-1 escrow). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../server/store.ts'
import { GuardianError } from '../server/guardian.ts'
import { isProjectEffectMonotonic } from '../contract/index.ts'
import { call } from './helpers/http.ts'

const GUARDED = 'p-insights'

test('the seeded sub-goal is in flight, held by the seeded Contributor (resolved label)', () => {
  const inflight = store.projectSubGoals(GUARDED)
  const seed = inflight.find((s) => s.subGoal === 'auth-refactor')
  assert.ok(seed, 'auth-refactor is seeded in flight')
  assert.equal(seed!.holder, 'commission-insights-default')
  assert.equal(seed!.holderLabel, 'Default agent') // resolved commission → agent label
})

test('different sub-goals are concurrent; the same sub-goal refuses a different holder', () => {
  // A different Contributor takes a *different* sub-goal — no conflict (distinct resource).
  const r = store.reserveSubGoal(GUARDED, 'contributor-B', 'dashboard-polish')
  assert.equal(r.status, 'held')
  // A different holder reaching for the *seeded* sub-goal is refused (first-come).
  assert.throws(() => store.reserveSubGoal(GUARDED, 'contributor-B', 'auth-refactor'), GuardianError)
  // Re-entrant: the same holder re-claims its own sub-goal fine.
  assert.doesNotThrow(() => store.reserveSubGoal(GUARDED, 'contributor-B', 'dashboard-polish'))
  // Once released, another Contributor may take it.
  store.releaseSubGoal(r.id)
  assert.doesNotThrow(() => store.reserveSubGoal(GUARDED, 'contributor-C', 'dashboard-polish'))
})

test('guardSubGoalEffect serializes one sub-goal but not across different sub-goals', () => {
  // Two effects on *different* sub-goals both run — no cross-serialization.
  let a = false
  let b = false
  store.guardSubGoalEffect(GUARDED, 'contributor-A', 'sub-a', () => (a = true))
  store.guardSubGoalEffect(GUARDED, 'contributor-B', 'sub-b', () => (b = true))
  assert.equal(a, true)
  assert.equal(b, true)
  // While one holder holds 'sub-c', a different holder's guarded effect on 'sub-c' is refused.
  const held = store.reserveSubGoal(GUARDED, 'contributor-A', 'sub-c')
  assert.throws(() => store.guardSubGoalEffect(GUARDED, 'contributor-B', 'sub-c', () => 'no'), GuardianError)
  store.releaseSubGoal(held.id)
})

test('an unguarded Project reserves nothing (coordination-free)', () => {
  const unguarded = store.listProjects().find((p) => !p.guardianId)!
  assert.deepEqual(store.projectSubGoals(unguarded.id), [])
  assert.throws(() => store.reserveSubGoal(unguarded.id, 'x', 'y'), GuardianError)
})

test('routes: GET lists in-flight sub-goals; POST claims; a conflicting claim 409s', async () => {
  const list = await call('GET', `/projects/${GUARDED}/subgoals`)
  assert.equal(list.status, 200)
  assert.ok(list.json.some((s: any) => s.subGoal === 'auth-refactor'))

  const claimed = await call('POST', `/projects/${GUARDED}/subgoals`, { holder: 'route-contrib', subGoal: 'route-goal' })
  assert.equal(claimed.status, 200)
  assert.equal(claimed.json.status, 'held')

  // A different holder on the seeded sub-goal → 409 conflict.
  const conflict = await call('POST', `/projects/${GUARDED}/subgoals`, { holder: 'route-contrib', subGoal: 'auth-refactor' })
  assert.equal(conflict.status, 409)
  assert.equal(conflict.json.error.code, 'conflict')

  // Missing fields → 400.
  const bad = await call('POST', `/projects/${GUARDED}/subgoals`, { holder: 'x' })
  assert.equal(bad.status, 400)
})

test('a sub-goal surfaces its holder’s role; a higher role does not preempt an in-flight hold (D14)', async () => {
  // The seeded in-flight sub-goal is held by the maintainer Contributor — its role shows.
  const seed = store.projectSubGoals(GUARDED).find((s) => s.subGoal === 'auth-refactor')
  assert.equal(seed?.holderRole, 'maintainer')

  // An owner (higher rank) cannot displace the maintainer's in-flight hold — acquisition
  // priority never preempts; the contender is refused (409) and re-reasons.
  const owner = store.createCommission({ agentId: 'agent-default', projectId: GUARDED, role: 'owner' })
  const contend = await call('POST', `/projects/${GUARDED}/subgoals`, { holder: owner.id, subGoal: 'auth-refactor' })
  assert.equal(contend.status, 409)
  // The maintainer still holds it — no preemption.
  const after = store.projectSubGoals(GUARDED).find((s) => s.subGoal === 'auth-refactor')
  assert.equal(after?.holder, 'commission-insights-default')
})

test('a reader role may not reserve a sub-goal; a maintainer may (D14)', async () => {
  const reader = store.createCommission({ agentId: 'agent-default', projectId: GUARDED, role: 'reader' })
  const denied = await call('POST', `/projects/${GUARDED}/subgoals`, { holder: reader.id, subGoal: 'sg-reader-reserve' })
  assert.equal(denied.status, 403)
  assert.equal(denied.json.error.code, 'forbidden')
  // The seeded Contributor is a maintainer — it may claim a fresh sub-goal.
  const ok = await call('POST', `/projects/${GUARDED}/subgoals`, {
    holder: 'commission-insights-default', subGoal: 'sg-maint-reserve',
  })
  assert.equal(ok.status, 200)
})

test('isProjectEffectMonotonic classifies the externally-effectful Project surface (OQ4)', () => {
  // Monotonic (observe / query) → coordination-free, bypasses the Guardian (CALM).
  assert.equal(isProjectEffectMonotonic('connector.read'), true)
  assert.equal(isProjectEffectMonotonic('mcp.query'), true)
  // Non-monotonic (irreversible outside change) → must hold a sub-goal reservation (D11's hard quadrant).
  assert.equal(isProjectEffectMonotonic('connector.write'), false)
  assert.equal(isProjectEffectMonotonic('mcp.mutate'), false)
  assert.equal(isProjectEffectMonotonic('charge'), false)
})
