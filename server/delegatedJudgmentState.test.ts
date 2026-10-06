import { test } from 'node:test'
import assert from 'node:assert/strict'
import { delegatedJudgmentId } from './delegatedJudgmentIdentity.ts'
import { judgmentContextHash, publicJudgmentRun, sameJudgmentRequest, validJudgmentRequest, validStoredJudgments, type StoredDelegatedJudgment } from './delegatedJudgmentState.ts'

function receipt(): StoredDelegatedJudgment {
  return {
    id: delegatedJudgmentId('owner', 'project', 'contribution', 'delegation', 'key'),
    delegationId: 'delegation', delegationRevision: 2, actKind: 'land', mode: 'decide',
    changesetVersion: 3, envelopeVersion: null, reviewer: 'Delegate', provider: 'Provider', model: 'model',
    startedAt: 100, status: 'pending', tenantId: 'owner', delegationCreatedAt: 10,
    contextHash: judgmentContextHash({ private: 'authority' }),
    request: { expectedDelegationRevision: 2, expectedChangesetVersion: 3, expectedEnvelopeVersion: null,
      reviewer: { agentId: 'agent', agentRevision: 1, providerId: 'provider', providerRevision: 2, connectionRevision: 3 } },
  }
}

test('judgment requests require every exact version, bounded binding, and no guessed or additional authority', () => {
  const { request } = receipt()
  assert.equal(validJudgmentRequest(request), true)
  assert.equal(sameJudgmentRequest(request, structuredClone(request)), true)
  for (const key of Object.keys(request)) {
    const missing = { ...request }
    delete missing[key as keyof typeof missing]
    assert.equal(validJudgmentRequest(missing), false, key)
  }
  for (const malformed of [null, [], { ...request, extra: true }, { ...request, expectedChangesetVersion: 0 },
    { ...request, expectedDelegationRevision: -1 }, { ...request, reviewer: { ...request.reviewer, providerRevision: 0.5 } }]) {
    assert.equal(validJudgmentRequest(malformed), false)
  }
  for (const changed of [{ ...request, expectedDelegationRevision: 3 }, { ...request, expectedEnvelopeVersion: 1 },
    { ...request, expectedChangesetVersion: 4 }, { ...request, reviewer: { ...request.reviewer, connectionRevision: 4 } }]) {
    assert.equal(sameJudgmentRequest(request, changed), false)
  }
})

test('public judgment history detaches receipts and only the initiating owner receives policy-derived prose', () => {
  const run = { ...receipt(), status: 'decided' as const, finishedAt: 101, decision: 'approve' as const, summary: 'Private written criteria.' }
  assert.equal(validStoredJudgments([run]), true)
  const owner = publicJudgmentRun(run, 'owner')
  assert.equal(owner.summary, run.summary)
  for (const viewer of ['shared', 'foreign', undefined]) {
    const shown = publicJudgmentRun(run, viewer)
    assert.equal(shown.summary, undefined)
    assert.equal(shown.status, 'decided')
    for (const field of ['tenantId', 'request', 'delegationCreatedAt', 'contextHash']) assert.equal(Object.hasOwn(shown, field), false)
  }
  owner.reviewer = 'changed'
  assert.equal(run.reviewer, 'Delegate')
})

test('durable judgment admission rejects malformed status, authority, duplicates, and unbounded histories', () => {
  assert.equal(validStoredJudgments(undefined), true)
  assert.equal(validStoredJudgments([receipt()]), true)
  const terminal = { ...receipt(), status: 'decided' as const, finishedAt: 101, decision: 'approve' as const, summary: 'Approved.' }
  assert.equal(validStoredJudgments([terminal]), true)
  for (const changes of [
    { secret: 'extra' }, { id: 'wrong' }, { contextHash: 'wrong' }, { delegationRevision: 3 },
    { envelopeVersion: 1 }, { changesetVersion: null }, { request: {} }, { tenantId: '' },
    { delegationCreatedAt: -1 }, { startedAt: -1 }, { status: 'passed' }, { mode: 'automatic' },
    { status: 'pending' }, { status: 'uncertain' }, { status: 'failed' }, { finishedAt: 99 },
    { decision: 'decline' }, { mode: 'draft' }, { summary: '' }, { summary: 'x'.repeat(2001) },
  ]) assert.equal(validStoredJudgments([{ ...terminal, ...changes }]), false, JSON.stringify(changes))
  assert.equal(validStoredJudgments([terminal, terminal]), false)
  assert.equal(validStoredJudgments(Array.from({ length: 51 }, (_, i) => ({ ...receipt(),
    id: delegatedJudgmentId('owner', 'project', 'contribution', 'delegation', `key-${i}`), startedAt: i + 100 }))), false)
})
