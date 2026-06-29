/** D13 / OQ1 reputation — a successful *commissioned Project* effect credits its
 *  Contributor's worker track record (monotonic, success-only). The D15 proxy is a
 *  private cross-user channel, NOT a Project contribution, so it does not credit here —
 *  that channel is the Phase-6 audit's concern. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../server/store.ts'
import { call } from './helpers/http.ts'

test('a successful Project effect credits the commissioned Contributor (D13)', () => {
  const agent = store.createAgent({ label: 'Rep Contributor', systemPrompt: 'p', tools: [], instructions: '' })
  const commission = store.createCommission({ agentId: agent.id, projectId: 'p-insights' })
  const before = store.getAgent(agent.id).contributions ?? 0

  // A monotonic effect (connector.read) runs coordination-free → fulfils → credits once.
  store.runProjectEffect('p-insights', commission.id, 'sub-goal-x', 'connector.read', 'Linear')
  assert.equal(store.getAgent(agent.id).contributions, before + 1)

  // A second effect increments again (the track record is monotonic).
  store.runProjectEffect('p-insights', commission.id, 'sub-goal-x', 'connector.read', 'Linear')
  assert.equal(store.getAgent(agent.id).contributions, before + 2)
})

test('an unknown commission credits nothing — fail-quiet, never a gate', () => {
  assert.doesNotThrow(() => store.recordContribution('commission-ghost'))
})

test('a commissioned host invoke credits the Contributor on success (D13)', async () => {
  // The seeded commission (agent-default on p-insights) admits ~/code/insights-web; a runner
  // granting the broader ~/code lets the *commission* be the wall and the effect succeed.
  await call('POST', '/runners', {
    id: 'runner-rep', label: 'Rep', host: 'h',
    capabilities: [{ type: 'fs.read', scopes: ['~/code'] }],
  })
  await call('POST', '/sessions/rep/contexts', { id: 'ctx-rep', type: 'folder', label: 'code', scope: '~/code' })
  const before = store.getAgent('agent-default').contributions ?? 0

  const ok = await call('POST', '/runners/runner-rep/invoke', {
    sessionId: 'rep', contextId: 'ctx-rep', capability: 'fs.read',
    target: '~/code/insights-web/main.ts', commissionId: 'commission-insights-default',
  })
  assert.equal(ok.status, 200)
  assert.equal(store.getAgent('agent-default').contributions, before + 1)
})

test('a NON-commissioned (legacy single-tenant) invoke credits nobody', async () => {
  await call('POST', '/runners', {
    id: 'runner-rep2', label: 'Rep2', host: 'h',
    capabilities: [{ type: 'fs.read', scopes: ['~/code'] }],
  })
  await call('POST', '/sessions/rep2/contexts', { id: 'ctx-rep2', type: 'folder', label: 'code', scope: '~/code' })
  const before = store.getAgent('agent-default').contributions ?? 0

  const ok = await call('POST', '/runners/runner-rep2/invoke', {
    sessionId: 'rep2', contextId: 'ctx-rep2', capability: 'fs.read', target: '~/code/insights-web/main.ts',
  })
  assert.equal(ok.status, 200)
  assert.equal(store.getAgent('agent-default').contributions ?? 0, before, 'no commissionId ⇒ no credit')
})
