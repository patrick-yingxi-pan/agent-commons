import test from 'node:test'
import assert from 'node:assert/strict'
import type { Delegation, PatchDelegationRequest } from '../../contract/index.ts'
import { delegationPolicyVersionMatches } from './delegationPolicyCommands.ts'
import { preferNewerDelegation } from './delegationRevision.ts'

const request: PatchDelegationRequest = {
  expectedRevision: 4,
  policy: 'Only approve the reviewed change.',
  escalation: ['effectful', 'stranger'],
  mode: 'decide',
  expiresAt: null,
}

test('Delegation recovery matches only the exact next policy version, canonically', () => {
  const represented = {
    revision: 5,
    policy: request.policy,
    escalation: ['stranger', 'effectful'] as const,
    mode: request.mode,
    updatedAt: 1_000,
  }
  assert.equal(delegationPolicyVersionMatches(represented, request), true)
  assert.equal(delegationPolicyVersionMatches({ ...represented, revision: 4 }, request), false)
  assert.equal(delegationPolicyVersionMatches({ ...represented, policy: 'A changed policy' }, request), false)
  assert.equal(delegationPolicyVersionMatches({ ...represented, mode: 'draft' }, request), false)
  assert.equal(delegationPolicyVersionMatches({ ...represented, expiresAt: 2_000 }, request), false)
  assert.equal(delegationPolicyVersionMatches({ ...represented, escalation: ['effectful'] }, request), false)
})

test('an older creation acknowledgement cannot rewind a versioned Delegation', () => {
  const current: Delegation = {
    id: 'delegation-a', projectId: 'project-a', agentId: 'agent-a', agentLabel: 'Ada’s agent',
    actKind: 'land', policy: 'new policy', escalation: ['effectful'], mode: 'decide',
    createdAt: 10, revision: 2, mine: true,
  }
  const oldAck: Delegation = { ...current, policy: 'old policy', revision: 0, mode: 'draft' }
  assert.equal(preferNewerDelegation(current, oldAck), current)
  assert.equal(preferNewerDelegation(oldAck, current), current)
})
