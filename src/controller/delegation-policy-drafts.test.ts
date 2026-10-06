import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import type { Delegation } from '../../contract/delegations.ts'
import {
  clearDelegationPolicyDrafts,
  hasDelegationPolicyDraft,
  readDelegationPolicyDraft,
  settleDelegationPolicyDraft,
  writeDelegationPolicyDraft,
  subscribeDelegationPolicyDrafts,
  delegationPolicyDraftGeneration,
} from './delegationPolicyDrafts.ts'

const delegation = {
  id: 'delegation-draft', projectId: 'project-draft', agentId: 'agent-draft',
  actKind: 'land', mode: 'draft', policy: 'Reviewed criteria',
  escalation: ['effectful'], revision: 3, createdAt: 1,
  expiresAt: Date.UTC(2035, 5, 7, 8, 9, 42, 123),
} satisfies Delegation

afterEach(clearDelegationPolicyDrafts)

test('policy drafts preserve exact expiry and clone mutable authority fields', () => {
  const draft = readDelegationPolicyDraft(delegation)
  assert.equal(draft.expiryAt, delegation.expiresAt)
  assert.equal(draft.expiryChanged, false)
  assert.equal(draft.expectedRevision, 3)
  writeDelegationPolicyDraft(delegation, draft)
  draft.escalation.push('stranger')
  assert.deepEqual(readDelegationPolicyDraft(delegation).escalation, ['effectful'])
  const returned = readDelegationPolicyDraft(delegation)
  returned.escalation.push('unreviewed')
  assert.deepEqual(readDelegationPolicyDraft(delegation).escalation, ['effectful'])
})

test('settlement survives editor unmount, retains dismissed intent for review, and clears acknowledged drafts', () => {
  writeDelegationPolicyDraft(delegation, {
    ...readDelegationPolicyDraft(delegation), policy: 'Unacknowledged authored criteria',
  })
  const newer = { ...delegation, revision: 4, policy: 'Other device criteria' }
  settleDelegationPolicyDraft(delegation, false)
  const retained = readDelegationPolicyDraft(newer)
  assert.equal(retained.policy, 'Unacknowledged authored criteria')
  assert.equal(retained.expectedRevision, 3, 'dismissal cannot silently rebase authority')
  assert.equal(retained.needsReview, true)
  settleDelegationPolicyDraft(delegation, true)
  assert.equal(hasDelegationPolicyDraft(delegation), false)
  assert.equal(readDelegationPolicyDraft(newer).policy, 'Other device criteria')
})

test('draft identity includes Project and account disposal cannot be undone by discarded settlement', () => {
  writeDelegationPolicyDraft(delegation, readDelegationPolicyDraft(delegation))
  assert.equal(hasDelegationPolicyDraft({ ...delegation, projectId: 'another-project' }), false)
  clearDelegationPolicyDrafts()
  settleDelegationPolicyDraft(delegation, false)
  assert.equal(hasDelegationPolicyDraft(delegation), false)
})

test('all pane subscribers observe each draft write and lifecycle settlement', () => {
  const startingGeneration = delegationPolicyDraftGeneration()
  const observed: string[] = []
  const unsubscribe = subscribeDelegationPolicyDrafts(() => {
    observed.push(readDelegationPolicyDraft(delegation).policy)
  })
  try {
    writeDelegationPolicyDraft(delegation, { ...readDelegationPolicyDraft(delegation), policy: 'First pane' })
    writeDelegationPolicyDraft(delegation, { ...readDelegationPolicyDraft(delegation), policy: 'Second pane' })
    settleDelegationPolicyDraft(delegation, false)
    settleDelegationPolicyDraft(delegation, true)
    assert.deepEqual(observed, ['First pane', 'Second pane', 'Second pane', delegation.policy])
    assert.equal(delegationPolicyDraftGeneration(), startingGeneration + 4)
  } finally { unsubscribe() }
  clearDelegationPolicyDrafts()
  assert.equal(observed.length, 4, 'disposed panes receive no further notifications')
})
