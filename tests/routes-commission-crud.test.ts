/** Commission update / delete on the wire (docs/agent-commons.md, D7/D12) — re-granting
 *  a Contributor's Project-clamped reach and un-commissioning. PATCH re-runs the leaf
 *  funnel (an over-grant past the Agent is a 400); DELETE cascade-releases the
 *  Contributor's in-flight sub-goals. The in-memory store is shared, so each case makes
 *  its own commission and never touches the seeded one other tests rely on. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../server/store.ts'
import { DEFAULT_AGENT } from '../server/data/workers.ts'
import { call } from './helpers/http.ts'

const GUARDED = 'p-insights'

test('PATCH narrows a Contributor reach to a subset of what the Project admits (D12)', async () => {
  const commission = store.createCommission({ agentId: DEFAULT_AGENT.id, projectId: GUARDED })
  // Inheriting: the full admitted connector set.
  const full = await call('GET', `/commissions/${commission.id}/authority`)
  const admitted: string[] = full.json.connectors
  assert.ok(admitted.length >= 1, 'the Project admits at least one connector')

  const patched = await call('PATCH', `/commissions/${commission.id}`, {
    authority: { connectors: [admitted[0]] },
  })
  assert.equal(patched.status, 200)

  // The effective reach now reflects the narrowed grant ∩ the admitted set.
  const reach = await call('GET', `/commissions/${commission.id}/authority`)
  assert.deepEqual(reach.json.connectors, [admitted[0]])
})

test('PATCH rejects an authority over the Agent (the leaf funnel) and 404s an unknown id', async () => {
  const provider = store.createProvider({
    label: 'Linear-only (commission)',
    modelFamily: 'claude',
    effortLevels: ['Low'],
    authority: { connectors: ['linear'] },
  })
  const agent = store.createAgent({
    label: 'Linear agent',
    systemPrompt: 'p',
    tools: [],
    instructions: '',
    providerId: provider.id,
  })
  const commission = store.createCommission({ agentId: agent.id, projectId: GUARDED })
  // The agent (inheriting its provider) may reach only 'linear'; granting 'figma' too
  // exceeds it.
  const over = await call('PATCH', `/commissions/${commission.id}`, {
    authority: { connectors: ['linear', 'figma'] },
  })
  assert.equal(over.status, 400)
  assert.equal(over.json.error.code, 'bad_request')

  const missing = await call('PATCH', '/commissions/no-such-commission', { authority: {} })
  assert.equal(missing.status, 404)
})

test('DELETE un-commissions; a second DELETE 404s', async () => {
  const commission = store.createCommission({ agentId: DEFAULT_AGENT.id, projectId: GUARDED })
  const del = await call('DELETE', `/commissions/${commission.id}`)
  assert.equal(del.status, 200)
  assert.deepEqual(del.json, { ok: true })
  assert.equal(store.getCommission(commission.id), undefined)

  const again = await call('DELETE', `/commissions/${commission.id}`)
  assert.equal(again.status, 404)
})

test('DELETE cascade-releases the Contributor’s in-flight sub-goals (no dangling hold)', async () => {
  const commission = store.createCommission({ agentId: DEFAULT_AGENT.id, projectId: GUARDED })
  store.reserveSubGoal(GUARDED, commission.id, 'crud-cascade-subgoal')
  assert.ok(store.projectSubGoals(GUARDED).some((s) => s.subGoal === 'crud-cascade-subgoal'))

  const del = await call('DELETE', `/commissions/${commission.id}`)
  assert.equal(del.status, 200)
  // The sub-goal the deleted Contributor held is freed.
  assert.ok(!store.projectSubGoals(GUARDED).some((s) => s.subGoal === 'crud-cascade-subgoal'))
})
