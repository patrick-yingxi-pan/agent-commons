/** The detective audit trail in the store (docs/agent-commons.md, D15/OQ7) — every
 *  cross-user effect lands an entry, fulfilled OR denied (the detective watches attempts).
 *  The three channels: the agent-to-agent proxy, a Project effect, a commissioned host
 *  invoke. A legacy (single-tenant) invoke is NOT a cross-user channel and isn't audited. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../server/store.ts'
import { call } from './helpers/http.ts'

test('runAgentProxy logs both a fulfilled and a denied proxy entry (D15)', () => {
  const b = store.createAgent({ label: 'Auditor B', systemPrompt: 'p', tools: [], instructions: '', authority: { connectors: ['Linear'] } })
  const a = store.createAgent({ label: 'Auditor A', systemPrompt: 'p', tools: [], instructions: '' })

  store.runAgentProxy(b.id, { fromAgentId: a.id, capability: 'connector.read', target: 'Linear' })
  let top = store.listAuditLog()[0]
  assert.equal(top.channel, 'proxy')
  assert.equal(top.outcome, 'fulfilled')
  assert.equal(top.actorAgentId, b.id, 'the acting Agent (B) is the actor, not the requester')
  assert.equal(top.capability, 'connector.read')
  assert.equal(top.target, 'Linear')

  // B declines what its own authority excludes → a denied entry (the detective signal).
  store.runAgentProxy(b.id, { fromAgentId: a.id, capability: 'connector.read', target: 'Gmail' })
  top = store.listAuditLog()[0]
  assert.equal(top.outcome, 'denied')
  assert.equal(top.target, 'Gmail')
})

test('runProjectEffect logs a fulfilled project-effect entry attributed to the Commission', () => {
  const agent = store.createAgent({ label: 'Effect agent', systemPrompt: 'p', tools: [], instructions: '' })
  const c = store.createCommission({ agentId: agent.id, projectId: 'p-insights' })
  store.runProjectEffect('p-insights', c.id, 'audit-sub', 'connector.read', 'Linear')
  const top = store.listAuditLog()[0]
  assert.equal(top.channel, 'project-effect')
  assert.equal(top.outcome, 'fulfilled')
  assert.equal(top.commissionId, c.id)
  assert.equal(top.capability, 'connector.read')
})

test('the host-invoke route logs a commissioned success and a D12-denied attempt', async () => {
  await call('POST', '/runners', { id: 'runner-audit', label: 'A', host: 'h', capabilities: [{ type: 'fs.read', scopes: ['~/code'] }] })
  await call('POST', '/sessions/aud/contexts', { id: 'ctx-aud', type: 'folder', label: 'code', scope: '~/code' })
  const base = { sessionId: 'aud', contextId: 'ctx-aud', capability: 'fs.read' as const, commissionId: 'commission-insights-default' }

  // In-reach commissioned success → a fulfilled host-invoke entry.
  await call('POST', '/runners/runner-audit/invoke', { ...base, target: '~/code/insights-web/main.ts' })
  let top = store.listAuditLog()[0]
  assert.equal(top.channel, 'host-invoke')
  assert.equal(top.outcome, 'fulfilled')
  assert.equal(top.commissionId, 'commission-insights-default')

  // Out-of-Project target → the D12 wall denies (403) and logs a denied entry.
  const denied = await call('POST', '/runners/runner-audit/invoke', { ...base, target: '~/code/other/secret.ts' })
  assert.equal(denied.status, 403)
  top = store.listAuditLog()[0]
  assert.equal(top.channel, 'host-invoke')
  assert.equal(top.outcome, 'denied')
  assert.equal(top.target, '~/code/other/secret.ts')
})

test('a legacy (no-commission) invoke is NOT audited — it is not a cross-user channel', async () => {
  await call('POST', '/runners', { id: 'runner-audit2', label: 'A2', host: 'h', capabilities: [{ type: 'fs.read', scopes: ['~/code'] }] })
  await call('POST', '/sessions/aud2/contexts', { id: 'ctx-aud2', type: 'folder', label: 'code', scope: '~/code' })
  const before = store.listAuditLog().length
  await call('POST', '/runners/runner-audit2/invoke', { sessionId: 'aud2', contextId: 'ctx-aud2', capability: 'fs.read', target: '~/code/insights-web/main.ts' })
  assert.equal(store.listAuditLog().length, before, 'no commissionId ⇒ no audit entry')
})
