import assert from 'node:assert/strict'
import test from 'node:test'
import { delegationPolicyPatch, delegationVersions, sameDelegationPolicy, validStoredDelegations, validDelegationRetirements } from './delegationPolicy.ts'

const patch = { expectedRevision: 0, policy: 'Only notes.', mode: 'draft', escalation: [], expiresAt: null } as const
const legacy = {
  id: 'delegation-1', projectId: 'p-1', agentId: 'a-1', agentLabel: 'Reviewer', actKind: 'land',
  policy: 'Only notes.', mode: 'draft', escalation: ['effectful'], createdAt: 100, delegatorTenant: 't-1',
} as any

test('one full policy parser preserves expiry absence meaning and the irreversible floor', () => {
  assert.deepEqual(delegationPolicyPatch({ ...patch, policy: '  Only notes.  ', escalation: ['stranger', 'unreviewed'] }), {
    ...patch, escalation: ['effectful', 'unreviewed', 'stranger'],
  })
  for (const bad of [undefined, [], {}, { ...patch, agentId: 'other' }, { ...patch, expiresAt: undefined },
    { ...patch, expectedRevision: -1 }, { ...patch, expectedRevision: Number.MAX_SAFE_INTEGER },
    { ...patch, policy: ' ' }, { ...patch, policy: 'x'.repeat(2001) }, { ...patch, mode: 'auto' },
    { ...patch, escalation: ['unknown'] }, { ...patch, expiresAt: NaN }, { ...patch, expiresAt: 8_640_000_000_000_001 },
  ]) assert.throws(() => delegationPolicyPatch(bad))
})

test('retained policy equality names every authority dimension, not only matching prose', () => {
  const normalized = delegationPolicyPatch(patch)
  assert.equal(sameDelegationPolicy(legacy, normalized), true)
  for (const delta of [{ policy: 'Broader.' }, { mode: 'decide' }, { escalation: ['effectful', 'stranger'] }, { expiresAt: 200 }]) {
    assert.equal(sameDelegationPolicy({ ...legacy, ...delta }, normalized), false)
  }
  const baseline = delegationVersions(legacy)
  baseline[0].escalation.push('stranger')
  assert.deepEqual(legacy.escalation, ['effectful'], 'public version reads are detached')
})

test('durable admission keeps legacy immutable grants and rejects inconsistent mutable histories', () => {
  assert.equal(validStoredDelegations([legacy]), true)
  const row = { ...legacy, revision: 0, versions: delegationVersions(legacy) }
  assert.equal(validStoredDelegations([row]), true)
  const version = { ...row.versions[0], revision: 1, updatedAt: 101, mode: 'decide' as const, expiresAt: 200 }
  const edited = { ...row, revision: 1, mode: 'decide', expiresAt: 200, versions: [...row.versions, version] }
  assert.equal(validStoredDelegations([edited]), true)
  for (const bad of [
    { ...row, revision: 1 }, { ...row, versions: [] }, { ...row, mine: true }, { ...row, expired: false }, { ...row, privateNote: 'secret' },
    { ...row, policy: 'Tampered.' }, { ...row, escalation: [] }, { ...legacy, expiresAt: 200 },
    { ...row, versions: [{ ...row.versions[0], updatedAt: 99 }] },
    { ...edited, expiresAt: undefined },
    { ...edited, versions: [row.versions[0], { ...version, revision: 2 }] },
    { ...edited, versions: [row.versions[0], { ...version, updatedAt: 99 }] },
    { ...edited, versions: [row.versions[0], { ...version, expiresAt: null }] },
    { ...edited, versions: [row.versions[0], { ...version, additionalAuthority: true }] },
  ]) assert.equal(validStoredDelegations([bad]), false, JSON.stringify(bad))
  assert.equal(validStoredDelegations([row, row]), false, 'duplicate identities refuse admission')
})

test('retirement admission cannot acknowledge removal while its authority remains active', () => {
  const retired = { delegationId: legacy.id, projectId: legacy.projectId, createdAt: legacy.createdAt }
  const receipt = { ...retired, revocationId: 'delegation-revoke-000000000000000000000000', revokedByTenant: 't-1', expectedCreatedAt: legacy.createdAt, expectedRevision: 2 }
  assert.equal(validDelegationRetirements([retired]), true)
  assert.equal(validDelegationRetirements([receipt]), true)
  assert.equal(validDelegationRetirements([retired], [legacy]), false)
  assert.equal(validDelegationRetirements([receipt], [legacy]), false)
  assert.equal(validDelegationRetirements([retired, retired]), false)
  assert.equal(validDelegationRetirements([receipt, { ...receipt, delegationId: 'other' }]), false)
  for (const bad of [null, { ...retired, revokedByTenant: 't-1' }, { ...receipt, revocationId: 'forged' },
    { ...receipt, expectedRevision: -1 }, { ...receipt, expectedCreatedAt: 99 }, { ...receipt, privateNote: 'secret' },
  ]) assert.equal(validDelegationRetirements([bad]), false)
})
