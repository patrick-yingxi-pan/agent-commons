/** Commission (docs/agent-commons.md, D7/D13) — the agent→Project assignment and the
 *  LEAF of the D8 attenuation cascade: a commission's grant + authority must be a
 *  subset of the Agent's (which inherit the provider when unset). Validated once at the
 *  creation funnel, so a Commission can never carry authority the Agent never held. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../store/index.ts'
import { BudgetError } from '../usage.ts'
import { AuthorityError } from '../authority.ts'
import { LimitError } from '../limit.ts'
import { ValidationError } from '../conflict.ts'
import { call, callFresh } from '../testkit/http.ts'
import { commissionCreationId } from '../commissionCreationIdentity.ts'

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
        role: 'writer',
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
        role: 'writer',
        agentId: agent.id,
        projectId: 'p-insights',
        authority: { tools: ['read', 'write'] },
      }),
    AuthorityError,
  )
  // A commission that is a subset of the Agent's grants mints fine.
  const ok = store.createCommission({
    role: 'writer',
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
  assert.throws(() => store.createCommission({ role: 'writer', agentId: 'ghost-agent', projectId: 'p-insights' }), /unknown agent/)
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
  const created = await call('POST', '/commissions', { role: 'writer', agentId: 'agent-default', projectId: 'p-insights' })
  assert.equal(created.status, 200) // sendJson default; body carries the new commission
  assert.equal(created.json.agentId, 'agent-default')
  assert.ok(created.json.id.startsWith('commission-'))

  // Missing required fields — including a missing ROLE (INV-9: never defaulted).
  const bad = await call('POST', '/commissions', { role: 'writer', agentId: 'agent-default' })
  assert.equal(bad.status, 400)
  assert.equal(bad.json.error.code, 'bad_request')
  const noRole = await call('POST', '/commissions', { agentId: 'agent-default', projectId: 'p-insights' })
  assert.equal(noRole.status, 400)
  assert.match(noRole.json.error.message, /role/i)

  // Unknown agent / project → 404.
  const noAgent = await call('POST', '/commissions', { role: 'writer', agentId: 'ghost', projectId: 'p-insights' })
  assert.equal(noAgent.status, 404)
  const noProject = await call('POST', '/commissions', { role: 'writer', agentId: 'agent-default', projectId: 'p-ghost' })
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
    role: 'writer',
    authority: { tools: ['read', 'write'] },
  })
  assert.equal(over.status, 400)
  assert.equal(over.json.error.code, 'bad_request')
})

test('a keyed commission survives response-cache loss without rewinding newer configuration', async () => {
  const headers: Record<string, string> = {
    'idempotency-key': `commission-create-durable-${Date.now()}`,
  }
  const tenantId = store.identity(headers).tenant.id
  const expectedId = commissionCreationId(tenantId, headers['idempotency-key']!)
  const body = { role: 'writer' as const, agentId: 'agent-default', projectId: 'p-insights' }
  const changed: string[] = []
  const unsubscribe = store.subscribe((event) => {
    if (event.type === 'commission.changed' && event.projectId === body.projectId) {
      changed.push(event.projectId)
    }
  })

  const first = await call('POST', '/commissions', body, headers)
  const cachedReplay = await call('POST', '/commissions', body, headers)
  assert.equal(first.status, 200)
  assert.equal(first.json.id, expectedId)
  assert.equal(cachedReplay.json.id, expectedId)
  assert.equal(cachedReplay.headers['idempotency-replayed'], 'true')

  const newer = store.updateCommission(expectedId, { role: 'reader' }, 0)
  assert.equal(newer?.configurationRevision, 1)
  const durableReplay = await callFresh('POST', '/commissions', {
    ...body,
    role: 'owner',
  }, headers)
  assert.equal(durableReplay.status, 200)
  assert.equal(durableReplay.headers['idempotency-replayed'], undefined)
  assert.equal(durableReplay.json.id, expectedId)
  assert.equal(durableReplay.json.role, 'reader')
  assert.equal(durableReplay.json.configurationRevision, 1)
  assert.equal(store.listCommissions(undefined, tenantId).filter((row) => row.id === expectedId).length, 1)

  unsubscribe()
  assert.equal(changed.length, 2, 'only the first creation and later configuration edit emit')
})

test('a commission carries a project role (D14) — seeded maintainer, REQUIRED at the funnel, patchable', () => {
  // The seed is an explicit maintainer.
  assert.equal(store.getCommission('commission-insights-default')?.role, 'maintainer')
  // An unset role is REFUSED (INV-9): the funnel never picks one for the caller — the
  // commissioning UI pre-selects the Project's defaultRole (else writer), visibly.
  assert.throws(
    () => store.createCommission({ agentId: 'agent-default', projectId: 'p-insights' } as never),
    ValidationError,
  )
  // An explicit role is carried through.
  const r = store.createCommission({ agentId: 'agent-default', projectId: 'p-insights', role: 'reader' })
  assert.equal(r.role, 'reader')
  // updateCommission re-assigns the role; absent leaves it unchanged.
  assert.equal(store.updateCommission(r.id, { role: 'owner' })?.role, 'owner')
  assert.equal(store.updateCommission(r.id, {})?.role, 'owner')
})

test('a Project can carry a DEFAULT role — a picker pre-selection the API never resolves to', () => {
  // Set on a seed project via the same store seam the relation op uses.
  const set = store.setProjectDefaultRole('p-insights', 'maintainer')
  assert.equal(set?.defaultRole, 'maintainer')
  // It is convenience metadata ONLY: a role-less commission is still refused.
  assert.throws(
    () => store.createCommission({ agentId: 'agent-default', projectId: 'p-insights' } as never),
    ValidationError,
  )
  // Clearing leaves no default — a valid state (pickers fall back to writer).
  assert.equal(store.setProjectDefaultRole('p-insights', undefined)?.defaultRole, undefined)
  // An unknown role name is refused at the same seam.
  assert.throws(() => store.setProjectDefaultRole('p-insights', 'admin' as never), ValidationError)
  // The relation op is the same funnel (the project-page select + the consent card).
  store.applyRelationOp({ kind: 'set-project-default-role', projectId: 'p-insights', projectName: 'Insights dashboard', role: 'reader' })
  assert.equal(store.findProject('p-insights')?.defaultRole, 'reader')
  store.applyRelationOp({ kind: 'set-project-default-role', projectId: 'p-insights', projectName: 'Insights dashboard' })
  assert.equal(store.findProject('p-insights')?.defaultRole, undefined)
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

test('D13 commission cap: the funnel refuses past the cap; the route 429s (fail-closed)', async () => {
  // p-brand is a seed Project no other test commissions on — isolated for the cap.
  // Since the demo-accounts split it belongs to tenant-northlight (Noor), so the
  // route calls act AS that tenant (the owner) via the dev header seam.
  const projectId = 'p-brand'
  const asOwner = { 'x-tenant-id': 'tenant-northlight' }
  assert.equal(store.activeCommissionCount(projectId), 0)
  store.setCommissionCap(projectId, 1) // room for exactly one Contributor

  // The first mints; a second at the *funnel* throws LimitError (covers both the route
  // and the conversational commission-agent path, which share this funnel).
  assert.ok(store.createCommission({ role: 'writer', agentId: 'agent-default', projectId }).id.startsWith('commission-'))
  assert.throws(() => store.createCommission({ role: 'writer', agentId: 'agent-default', projectId }), LimitError)

  // The route surfaces the over-cap attempt as 429 limit_exceeded.
  const over = await call('POST', '/commissions', { role: 'writer', agentId: 'agent-default', projectId }, asOwner)
  assert.equal(over.status, 429)
  assert.equal(over.json.error.code, 'limit_exceeded')

  // The owner raises the cap → admits more; clearing it (undefined) is uncapped.
  store.setCommissionCap(projectId, 3)
  assert.equal((await call('POST', '/commissions', { role: 'writer', agentId: 'agent-default', projectId }, asOwner)).status, 200)
  store.setCommissionCap(projectId, undefined)
  assert.equal((await call('POST', '/commissions', { role: 'writer', agentId: 'agent-default', projectId }, asOwner)).status, 200)
})

test('D13 cap: a Project with no cap is unlimited (back-compat)', () => {
  // p-growth carries no cap; commissions mint freely.
  for (let i = 0; i < 5; i += 1) store.createCommission({ role: 'writer', agentId: 'agent-default', projectId: 'p-growth' })
  assert.ok(store.activeCommissionCount('p-growth') >= 5)
})

test('D13 cap works on a *created* Project too (findProject spans both homes)', () => {
  store.applyRelationOp({
    kind: 'create-project', projectId: 'p-capped-new', projectName: 'Capped New', projectDescription: 'd',
  })
  assert.equal(store.setCommissionCap('p-capped-new', 1)?.id, 'p-capped-new')
  assert.ok(store.createCommission({ role: 'writer', agentId: 'agent-default', projectId: 'p-capped-new' }).id.startsWith('commission-'))
  assert.throws(() => store.createCommission({ role: 'writer', agentId: 'agent-default', projectId: 'p-capped-new' }), LimitError)
  // An unknown Project resolves to nothing — no cap to set.
  assert.equal(store.setCommissionCap('p-ghost', 1), undefined)
})

test('narrowing a provider re-clamps its Agents and their commissions (D8 runtime propagation)', () => {
  const p = store.createProvider({ label: 'Shrink P', modelFamily: 'x', effortLevels: ['Low'], authority: { tools: ['a', 'b', 'c'] } })
  const a = store.createAgent({ label: 'Shrink A', systemPrompt: 's', tools: [], instructions: '', providerId: p.id, authority: { tools: ['a', 'b'] } })
  const c = store.createCommission({ role: 'writer', agentId: a.id, projectId: 'p-insights', authority: { tools: ['a', 'b'] } })
  // Narrow the provider's tools to just ['a'] — the already-minted children must follow down.
  store.updateProvider(p.id, { authority: { tools: ['a'] } })
  assert.deepEqual(store.listAgents().find((x) => x.id === a.id)?.authority?.tools, ['a']) // Agent clamped
  assert.deepEqual(store.getCommission(c.id)?.authority?.tools, ['a']) // commission clamped (transitive)
  assert.equal(store.getAgent(a.id).revision, 1, 'an effective indirect configuration change advances ordering')
  assert.equal(store.getCommission(c.id)?.configurationRevision, 1, 'the transitive commission change advances its domain ordering')
  store.updateProvider(p.id, { authority: { tools: ['a'] } })
  assert.equal(store.getAgent(a.id).revision, 1, 'an idempotent re-clamp does not invent a configuration change')
  assert.equal(store.getCommission(c.id)?.configurationRevision, 1, 'an idempotent re-clamp does not invent a commission change')
})

test('narrowing an Agent budget re-clamps its commissions grants (D8 runtime propagation)', () => {
  const a = store.createAgent({
    label: 'Budget A', systemPrompt: 's', tools: [], instructions: '',
    budget: { windows: [{ label: '5-hour limit', ceiling: 1_000_000 }] },
  })
  const c = store.createCommission({
    role: 'writer',
    agentId: a.id, projectId: 'p-insights',
    grant: { windows: [{ label: '5-hour limit', ceiling: 1_000_000 }] },
  })
  store.updateAgentFromRequest(a.id, { budget: { windows: [{ label: '5-hour limit', ceiling: 400_000 }] } })
  assert.equal(store.getCommission(c.id)?.grant?.windows.find((w) => w.label === '5-hour limit')?.ceiling, 400_000)
  assert.equal(store.getCommission(c.id)?.configurationRevision, 1)
})
