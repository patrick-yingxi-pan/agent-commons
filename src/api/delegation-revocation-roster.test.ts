import test from 'node:test'
import assert from 'node:assert/strict'
import type { Delegation } from '../../contract/index.ts'
import { mergeDelegationRevocationRoster } from './delegationRevocationRoster.ts'

const row = (id: string, createdAt: number): Delegation => ({
  id,
  projectId: 'project-a',
  agentId: `agent-${id}`,
  agentLabel: id,
  actKind: 'land',
  escalation: ['effectful'],
  mode: 'draft',
  createdAt,
})

test('Delegation revocation reconciliation changes only its exact roster row', () => {
  const target = row('delegation-a', 1)
  const later = row('delegation-later', 2)
  assert.deepEqual(
    mergeDelegationRevocationRoster([target, later], target.id, undefined),
    [later],
    'proved absence evicts only the addressed authority',
  )

  const refreshed = { ...target, mine: true as const, policy: 'private policy' }
  assert.deepEqual(
    mergeDelegationRevocationRoster([target, later], target.id, refreshed),
    [refreshed, later],
    'a still-present target refreshes without erasing a later grant',
  )
  assert.deepEqual(
    mergeDelegationRevocationRoster([later], target.id, refreshed),
    [later, refreshed],
    'an early cache absence can restore only the exact authoritative row',
  )
})
