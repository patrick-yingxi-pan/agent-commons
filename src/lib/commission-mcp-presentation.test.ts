import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CommissionMcpReview } from '../../contract/commissionMcpApi.ts'
import { commissionApprovalFromDraft, commissionApprovalMatchesReview, commissionClaimLabel, commissionToolKey } from './commissionMcpPresentation.ts'

const now = 1_800_000_000_000
function review(): CommissionMcpReview {
  return { commissionId: 'c', projectId: 'p', configurationRevision: 3, reviewHash: 'a'.repeat(64),
    execution: { agentId: 'agent', providerId: 'endpoint', modelId: 'catalog-model' }, policy: { version: 1, revision: 0, approval: null },
    active: false, blockedReason: null, disclosures: ['Owner-pays; private arguments; shared completion.'], claims: [],
    tools: [{ connectionId: 'http-1', connectionRevision: 4, connectionLabel: 'Inspected service', schemaHash: 'b'.repeat(64),
      tool: { name: 'write_record', inputSchema: { type: 'object', properties: { destination: { type: 'object' }, content: { type: 'string' } } } } }] }
}
const expiry = new Date(now + 60_000).toISOString()
function drafts(value = '{"destination":{"path":"exact/path"}}') { const valueReview = review(); return { [commissionToolKey(valueReview.tools[0]!)]: { selected: true, fixedText: value } } }

test('Commission approval freezes the exact selected binding and nested values without presentation metadata', () => {
  const source = review()
  const result = commissionApprovalFromDraft(source, drafts(), '5', expiry, now)
  assert.deepEqual(Object.keys(result).sort(), ['execution', 'expectedConfigurationRevision', 'expectedRevision', 'expiresAt', 'maxWorkItems', 'reviewHash', 'tools'])
  assert.deepEqual(result.execution, source.execution)
  assert.deepEqual(result.tools[0]?.fixedArguments, { destination: { path: 'exact/path' } })
  source.execution!.modelId = 'changed'
  source.tools[0]!.connectionRevision = 99
  assert.equal(result.execution.modelId, 'catalog-model')
  assert.equal(result.tools[0]?.connectionRevision, 4)
})

test('Commission consent refuses absent authority, invalid limits, non-object/non-finite JSON and stale exact review', () => {
  for (const patch of [{ execution: null }, { blockedReason: 'role denied' }, { disclosures: [] }]) {
    assert.throws(() => commissionApprovalFromDraft({ ...review(), ...patch }, drafts(), '5', expiry, now))
  }
  for (const count of ['0', '101', '2.5', 'NaN']) assert.throws(() => commissionApprovalFromDraft(review(), drafts(), count, expiry, now))
  for (const date of [new Date(now).toISOString(), new Date(now + 31 * 86_400_000).toISOString(), 'bad']) assert.throws(() => commissionApprovalFromDraft(review(), drafts(), '5', date, now))
  for (const value of ['null', '[]', '{"destination":1e309}', '{"typo":true}', '{']) assert.throws(() => commissionApprovalFromDraft(review(), drafts(value), '5', expiry, now))
  assert.throws(() => commissionApprovalFromDraft(review(), {}, '5', expiry, now))
  const approval = commissionApprovalFromDraft(review(), drafts(), '5', expiry, now)
  assert.equal(commissionApprovalMatchesReview(approval, review(), now), true)
  for (const change of [
    (source: CommissionMcpReview) => { source.configurationRevision++ },
    (source: CommissionMcpReview) => { source.policy.revision++ },
    (source: CommissionMcpReview) => { source.reviewHash = 'different' },
    (source: CommissionMcpReview) => { source.execution!.modelId = 'other' },
    (source: CommissionMcpReview) => { source.tools[0]!.connectionRevision++ },
    (source: CommissionMcpReview) => { source.tools[0]!.schemaHash = 'changed' },
    (source: CommissionMcpReview) => { source.blockedReason = 'No longer authorized' },
  ]) { const source = review(); change(source); assert.equal(commissionApprovalMatchesReview(approval, source, now), false) }
  assert.equal(commissionApprovalMatchesReview(approval, review(), now + 60_000), false)
})

test('Commission receipt success describes the external call, never invents Project completion', () => {
  const claim = { id: 'id', work: { itemId: 'work', subGoal: 'Goal', type: 'mcp.mutate' as const, target: 'write_record', note: '' }, startedAt: now }
  assert.equal(commissionClaimLabel({ ...claim, phase: 'preparing', status: 'pending' }), 'Preparing arguments')
  assert.equal(commissionClaimLabel({ ...claim, phase: 'closed', status: 'uncertain' }), 'Outcome uncertain')
  assert.equal(commissionClaimLabel({ ...claim, phase: 'closed', status: 'failed' }), 'Preparation stopped')
  assert.equal(commissionClaimLabel({ ...claim, phase: 'effect', status: 'done' }), 'Call succeeded')
})

test('local Commission selections freeze explicit launch intent and cannot silently change transport', () => {
  const source = review()
  const httpKey = commissionToolKey(source.tools[0]!)
  source.tools[0]!.transport = 'stdio'
  const localKey = commissionToolKey(source.tools[0]!)
  assert.notEqual(localKey, httpKey, 'a changed transport requires a fresh selection')
  const approval = commissionApprovalFromDraft(source, { [localKey]: { selected: true, fixedText: '{}' } }, '2', expiry, now)
  assert.equal(approval.localPrograms, true)
  assert.equal(commissionApprovalMatchesReview(approval, source, now), true)
  assert.equal(commissionApprovalMatchesReview({ ...approval, localPrograms: undefined }, source, now), false)
  delete source.tools[0]!.transport
  assert.equal(commissionApprovalMatchesReview(approval, source, now), false)
  assert.equal(commissionApprovalFromDraft(source, drafts(), '2', expiry, now).localPrograms, undefined)
})
