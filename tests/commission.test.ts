/** Commission (docs/agent-commons.md, D7/D13) — the agent→Project assignment and the
 *  LEAF of the D8 attenuation cascade: a commission's grant + authority must be a
 *  subset of the Agent's (which inherit the provider when unset). Validated once at the
 *  creation funnel, so a Commission can never carry authority the Agent never held. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../server/store.ts'
import { BudgetError } from '../server/usage.ts'
import { AuthorityError } from '../server/authority.ts'
import { call } from './helpers/http.ts'

test('the seeded commission is present and queryable by project (the Contributor view)', () => {
  assert.ok(store.listCommissions().some((c) => c.id === 'commission-insights-default'))
  const onInsights = store.listCommissions('p-insights')
  assert.ok(onInsights.some((c) => c.id === 'commission-insights-default'))
  assert.ok(onInsights.every((c) => c.projectId === 'p-insights'))
  assert.equal(store.getCommission('commission-insights-default')?.agentId, 'agent-default')
  assert.equal(store.getCommission('nope'), undefined)
})

test('createCommission attenuates against the Agent (leaf of the cascade)', () => {
  // A restricted Agent: authority = read-only, budget = 100k / 5h (both within the
  // default provider, which grants everything / inherits the account plan).
  const agent = store.createAgent({
    label: 'Restricted contributor',
    systemPrompt: 'p',
    tools: [],
    instructions: '',
    authority: { tools: ['read'] },
    budget: { windows: [{ label: '5-hour limit', ceiling: 100_000 }] },
  })

  // A commission grant over the Agent's token sub-budget is rejected.
  assert.throws(
    () =>
      store.createCommission({
        agentId: agent.id,
        projectId: 'p-insights',
        grant: { windows: [{ label: '5-hour limit', ceiling: 200_000 }] },
      }),
    BudgetError,
  )
  // A commission authority beyond the Agent's is rejected (the confused-deputy wall).
  assert.throws(
    () =>
      store.createCommission({
        agentId: agent.id,
        projectId: 'p-insights',
        authority: { tools: ['read', 'write'] },
      }),
    AuthorityError,
  )
  // A commission that is a subset of the Agent's grants mints fine.
  const ok = store.createCommission({
    agentId: agent.id,
    projectId: 'p-insights',
    authority: { tools: ['read'] },
    grant: { windows: [{ label: '5-hour limit', ceiling: 50_000 }] },
  })
  assert.ok(ok.id.startsWith('commission-'))
  assert.equal(ok.agentId, agent.id)
  assert.deepEqual(ok.authority, { tools: ['read'] })
})

test('createCommission rejects an unknown agent rather than silently using the default', () => {
  assert.throws(() => store.createCommission({ agentId: 'ghost-agent', projectId: 'p-insights' }), /unknown agent/)
})

test('GET /commissions lists + filters; /:id 404s the envelope', async () => {
  const all = await call('GET', '/commissions')
  assert.equal(all.status, 200)
  assert.ok(all.json.some((c: any) => c.id === 'commission-insights-default'))

  const filtered = await call('GET', '/commissions?project=p-insights')
  assert.equal(filtered.status, 200)
  assert.ok(filtered.json.every((c: any) => c.projectId === 'p-insights'))

  const missing = await call('GET', '/commissions/nope')
  assert.equal(missing.status, 404)
  assert.equal(missing.json.error.code, 'not_found')
})

test('POST /commissions mints (201); over-grant 400s; unknown agent/project 404s', async () => {
  const created = await call('POST', '/commissions', { agentId: 'agent-default', projectId: 'p-insights' })
  assert.equal(created.status, 200) // sendJson default; body carries the new commission
  assert.equal(created.json.agentId, 'agent-default')
  assert.ok(created.json.id.startsWith('commission-'))

  // Missing required fields.
  const bad = await call('POST', '/commissions', { agentId: 'agent-default' })
  assert.equal(bad.status, 400)
  assert.equal(bad.json.error.code, 'bad_request')

  // Unknown agent / project → 404.
  const noAgent = await call('POST', '/commissions', { agentId: 'ghost', projectId: 'p-insights' })
  assert.equal(noAgent.status, 404)
  const noProject = await call('POST', '/commissions', { agentId: 'agent-default', projectId: 'p-ghost' })
  assert.equal(noProject.status, 404)

  // An over-authority commission against the default agent? The default agent inherits
  // the provider's unrestricted authority, so build a capped agent first, then exceed it.
  const capped = store.createAgent({
    label: 'Capped for route test',
    systemPrompt: 'p',
    tools: [],
    instructions: '',
    authority: { tools: ['read'] },
  })
  const over = await call('POST', '/commissions', {
    agentId: capped.id,
    projectId: 'p-insights',
    authority: { tools: ['read', 'write'] },
  })
  assert.equal(over.status, 400)
  assert.equal(over.json.error.code, 'bad_request')
})

test('a commission carries a project role (D14) — seeded maintainer, default writer, patchable', () => {
  // The seed is an explicit maintainer.
  assert.equal(store.getCommission('commission-insights-default')?.role, 'maintainer')
  // An unset role defaults to 'writer' at the funnel.
  const c = store.createCommission({ agentId: 'agent-default', projectId: 'p-insights' })
  assert.equal(c.role, 'writer')
  // An explicit role is carried through.
  const r = store.createCommission({ agentId: 'agent-default', projectId: 'p-insights', role: 'reader' })
  assert.equal(r.role, 'reader')
  // updateCommission re-assigns the role; absent leaves it unchanged.
  assert.equal(store.updateCommission(r.id, { role: 'owner' })?.role, 'owner')
  assert.equal(store.updateCommission(r.id, {})?.role, 'owner')
})

test('the commission routes reject an unknown role (400)', async () => {
  const badCreate = await call('POST', '/commissions', {
    agentId: 'agent-default', projectId: 'p-insights', role: 'admin',
  })
  assert.equal(badCreate.status, 400)
  const ok = await call('POST', '/commissions', {
    agentId: 'agent-default', projectId: 'p-insights', role: 'reader',
  })
  assert.equal(ok.status, 200)
  const badPatch = await call('PATCH', `/commissions/${ok.json.id}`, { role: 'superuser' })
  assert.equal(badPatch.status, 400)
})
