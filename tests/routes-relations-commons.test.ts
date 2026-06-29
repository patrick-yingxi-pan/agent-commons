/** Agent Commons CRUD over the SHARED gate (docs/agent-commons.md, D6/D9/D10/D7).
 *  Claude proposes these as RelationOps and the user confirms the same card; the
 *  confirmed write travels POST /relations/ops → store.applyRelationOp, which executes
 *  each through the registry mutator the Agents hub uses (the D8 funnel + 409 guards)
 *  rather than the graph reducer. These lock that wire path: a confirmed op creates /
 *  commissions through the one seam, and a stale agent reference is a 409 (not a 500).
 *  The in-memory store is shared, so each case uses its own labels / ids and never
 *  touches the seeded registries other tests rely on. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../server/store.ts'
import { DEFAULT_AGENT } from '../server/data/workers.ts'
import { call } from './helpers/http.ts'

const apply = (op: unknown) => call('POST', '/relations/ops', { op })

test('create-provider op registers a provider through the funnel (a proper cascade root)', async () => {
  const res = await apply({ kind: 'create-provider', label: 'Wire provider', modelFamily: 'claude' })
  assert.equal(res.status, 200)
  const provider = store.listProviders().find((p) => p.label === 'Wire provider')
  assert.ok(provider, 'the provider is in the registry')
  assert.deepEqual(provider?.authority, { tools: ['*'], connectors: ['*'], scopes: ['*'] }, 'granted everything — the cascade root')
})

test('create-prompt op adds a library entry', async () => {
  const res = await apply({ kind: 'create-prompt', label: 'Wire prompt', body: 'Be terse.', targetFamily: 'claude' })
  assert.equal(res.status, 200)
  assert.ok(store.listSystemPrompts().some((p) => p.label === 'Wire prompt'), 'the prompt is in the library')
})

test('create-agent op mints a worker agent bound to the named provider + prompt', async () => {
  const provider = store.createProvider({ label: 'Bind provider', modelFamily: 'claude', effortLevels: ['Low'] })
  const prompt = store.createSystemPrompt({ label: 'Bind prompt', body: 'Cite sources.', targetFamily: 'claude' })

  const res = await apply({
    kind: 'create-agent',
    label: 'Wire agent',
    providerId: provider.id,
    providerLabel: provider.label,
    systemPromptId: prompt.id,
    systemPromptLabel: prompt.label,
    instructions: 'Stay focused.',
  })
  assert.equal(res.status, 200)
  const agent = store.listAgents().find((a) => a.label === 'Wire agent')
  assert.ok(agent, 'the agent is in the registry')
  assert.equal(agent?.providerId, provider.id, 'bound to the chosen provider')
  assert.equal(agent?.systemPromptId, prompt.id, 'built from the chosen library prompt')
  assert.equal(agent?.systemPrompt, 'Cite sources.', 'the prompt body is resolved from the library entry')
  assert.equal(agent?.instructions, 'Stay focused.')
  assert.ok((agent?.tools.length ?? 0) > 0, 'tools default to the full catalog')
})

test('commission-agent op commissions through the leaf funnel; uncommission-agent removes it', async () => {
  const agent = store.createAgent({ label: 'Commission target', systemPrompt: 'p', tools: [], instructions: '' })

  const commissioned = await apply({
    kind: 'commission-agent',
    agentId: agent.id,
    agentLabel: agent.label,
    projectId: 'p-insights',
    projectName: 'Insights',
  })
  assert.equal(commissioned.status, 200)
  const commission = store.listCommissions('p-insights').find((c) => c.agentId === agent.id)
  assert.ok(commission, 'the commission exists on the project')

  const removed = await apply({
    kind: 'uncommission-agent',
    commissionId: commission!.id,
    agentLabel: agent.label,
    projectName: 'Insights',
  })
  assert.equal(removed.status, 200)
  assert.equal(store.getCommission(commission!.id), undefined, 'the commission is gone')
})

test('commission-agent op carries the project role (D14) onto the commission', async () => {
  const agent = store.createAgent({ label: 'Role target', systemPrompt: 'p', tools: [], instructions: '' })
  const commissioned = await apply({
    kind: 'commission-agent',
    agentId: agent.id,
    agentLabel: agent.label,
    projectId: 'p-insights',
    projectName: 'Insights',
    role: 'reader',
  })
  assert.equal(commissioned.status, 200)
  const commission = store.listCommissions('p-insights').find((c) => c.agentId === agent.id)
  assert.equal(commission?.role, 'reader')
})

test('uncommission-agent on an already-gone commission is a benign no-op (200)', async () => {
  const res = await apply({
    kind: 'uncommission-agent',
    commissionId: 'commission-never-existed',
    agentLabel: 'Ghost',
    projectName: 'Insights',
  })
  assert.equal(res.status, 200, 'idempotent removal — not an error')
})

test('commission-agent against a removed agent is a 409 (the guard), not a 500', async () => {
  const res = await apply({
    kind: 'commission-agent',
    agentId: 'agent-removed-after-proposal',
    agentLabel: 'Stale',
    projectId: 'p-insights',
    projectName: 'Insights',
  })
  assert.equal(res.status, 409)
  assert.equal(res.json.error.code, 'conflict')
})

test('the default agent (always present) commissions fine through the op', async () => {
  const res = await apply({
    kind: 'commission-agent',
    agentId: DEFAULT_AGENT.id,
    agentLabel: DEFAULT_AGENT.label,
    projectId: 'p-insights',
    projectName: 'Insights',
  })
  assert.equal(res.status, 200)
  assert.ok(store.listCommissions('p-insights').some((c) => c.agentId === DEFAULT_AGENT.id))
})

test('set-commission-cap (D13) op sets the Project cap through the shared gate', async () => {
  // p-infra is a seed Project untouched by other tests here.
  const res = await apply({ kind: 'set-commission-cap', projectId: 'p-infra', projectName: 'Infra', cap: 4 })
  assert.equal(res.status, 200)
  assert.equal(store.listProjects().find((p) => p.id === 'p-infra')?.commissionCap, 4, 'the cap is set via the same card')
  // Re-applying the op changes the cap (the owner adjusting the ceiling).
  await apply({ kind: 'set-commission-cap', projectId: 'p-infra', projectName: 'Infra', cap: 9 })
  assert.equal(store.listProjects().find((p) => p.id === 'p-infra')?.commissionCap, 9)
})

test('handoff-agent (D16) re-binds the session’s driving Agent; an unknown agent 409s', async () => {
  const s = store.createSession('handoff target')
  const a = store.createAgent({ label: 'Handoff Scout', systemPrompt: 'p', tools: [], instructions: '' })
  const res = await apply({ kind: 'handoff-agent', sessionId: s.id, sessionTitle: s.title, agentId: a.id, agentLabel: a.label })
  assert.equal(res.status, 200)
  assert.equal(store.getSession(s.id)?.agentId, a.id) // the driver is re-bound mid-thread
  // A hand-off to a removed / unknown agent is the 409 guard, not a 500.
  const bad = await apply({ kind: 'handoff-agent', sessionId: s.id, sessionTitle: s.title, agentId: 'ghost', agentLabel: 'Ghost' })
  assert.equal(bad.status, 409)
})
