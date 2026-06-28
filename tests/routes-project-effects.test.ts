/** The guarded Project-effect path (docs/agent-commons.md, D11/D12, OQ3+OQ4) — the
 *  slice-4 "forward" effect now wired through the Guardian. `POST /projects/:id/effects`
 *  enforces the Commission's connector reach (D12) and serializes a non-monotonic effect
 *  on its sub-goal reservation (D11); a monotonic effect runs coordination-free (CALM). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { call } from './helpers/http.ts'

const P = 'p-insights' // guarded; the seeded commission reaches Linear + Figma
const C = 'commission-insights-default'

test('a connector effect outside the Commission reach is 403 (D12)', async () => {
  const r = await call('POST', `/projects/${P}/effects`, {
    commissionId: C, subGoal: 'sg-deny', type: 'connector.write', target: 'Gmail',
  })
  assert.equal(r.status, 403)
  assert.equal(r.json.error.code, 'forbidden')
})

test('an unknown commission reaches nothing — 403 fail-closed', async () => {
  const r = await call('POST', `/projects/${P}/effects`, {
    commissionId: 'nope', subGoal: 'sg-x', type: 'connector.write', target: 'Linear',
  })
  assert.equal(r.status, 403)
})

test('a non-monotonic effect within reach commits through the Guardian (D11)', async () => {
  const r = await call('POST', `/projects/${P}/effects`, {
    commissionId: C, subGoal: 'sg-fresh-1', type: 'connector.write', target: 'Linear',
  })
  assert.equal(r.status, 200)
  assert.equal(r.json.guarded, true)
  assert.equal(r.json.type, 'connector.write')
})

test('a non-monotonic effect on a sub-goal a different principal holds is 409 (escrow)', async () => {
  // Another principal claims the sub-goal first.
  const held = await call('POST', `/projects/${P}/subgoals`, { holder: 'squatter', subGoal: 'sg-contended' })
  assert.equal(held.status, 200)
  // The Contributor's non-monotonic effect on that same sub-goal is refused up front.
  const r = await call('POST', `/projects/${P}/effects`, {
    commissionId: C, subGoal: 'sg-contended', type: 'connector.write', target: 'Linear',
  })
  assert.equal(r.status, 409)
  assert.equal(r.json.error.code, 'conflict')
})

test('a monotonic effect is coordination-free — runs even on a contended sub-goal', async () => {
  await call('POST', `/projects/${P}/subgoals`, { holder: 'squatter2', subGoal: 'sg-ro' })
  const r = await call('POST', `/projects/${P}/effects`, {
    commissionId: C, subGoal: 'sg-ro', type: 'connector.read', target: 'Linear',
  })
  assert.equal(r.status, 200)
  assert.equal(r.json.guarded, false)
})

test('a re-entrant effect on a sub-goal the Contributor holds keeps the hold (guardedRun)', async () => {
  // The Contributor explicitly holds the sub-goal (e.g. across a consent gate).
  const held = await call('POST', `/projects/${P}/subgoals`, { holder: C, subGoal: 'sg-kept' })
  assert.equal(held.status, 200)
  // Firing a non-monotonic effect on it commits, but must NOT release the kept hold —
  // guardian.reserve is re-entrant, so guardedRun releases only what *it* acquired.
  const eff = await call('POST', `/projects/${P}/effects`, {
    commissionId: C, subGoal: 'sg-kept', type: 'connector.write', target: 'Linear',
  })
  assert.equal(eff.status, 200)
  const after = await call('GET', `/projects/${P}/subgoals`)
  assert.ok(
    after.json.some((s: { subGoal: string; holder: string }) => s.subGoal === 'sg-kept' && s.holder === C),
    'the Contributor still holds sg-kept after the effect',
  )
})

test('missing fields → 400; an invalid type → 400; an unknown project → 404', async () => {
  const noFields = await call('POST', `/projects/${P}/effects`, { commissionId: C, subGoal: 'x' })
  assert.equal(noFields.status, 400)
  const badType = await call('POST', `/projects/${P}/effects`, {
    commissionId: C, subGoal: 'x', type: 'connector.delete', target: 'Linear',
  })
  assert.equal(badType.status, 400)
  const missing = await call('POST', '/projects/ghost/effects', {
    commissionId: C, subGoal: 'x', type: 'connector.read', target: 'Linear',
  })
  assert.equal(missing.status, 404)
})
