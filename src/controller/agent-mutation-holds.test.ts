import test from 'node:test'
import assert from 'node:assert/strict'
import {
  acquireAgentMutation,
  isAgentConfigurationHeld,
  isAgentDeletionHeld,
  releaseAgentMutation,
} from './agentMutationHolds.ts'
import { refreshAccount } from '../api/account.ts'

test('Agent configuration and removal exclude one another with reference-counted leases', () => {
  const id = `agent-hold-${Date.now()}`
  const firstEdit = acquireAgentMutation('configuration', id)
  const secondEdit = acquireAgentMutation('configuration', id)
  assert.ok(firstEdit && secondEdit)
  assert.equal(isAgentConfigurationHeld(id), true)
  assert.equal(acquireAgentMutation('deletion', id), null, 'removal cannot race held configuration')

  releaseAgentMutation(firstEdit)
  assert.equal(isAgentConfigurationHeld(id), true, 'one caller cannot release another edit hold')
  releaseAgentMutation(secondEdit)
  assert.equal(isAgentConfigurationHeld(id), false)

  const deletion = acquireAgentMutation('deletion', id)
  assert.ok(deletion)
  assert.equal(isAgentDeletionHeld(id), true)
  assert.equal(acquireAgentMutation('configuration', id), null, 'configuration cannot race held removal')
  releaseAgentMutation(deletion)
  assert.equal(isAgentDeletionHeld(id), false)
})

test('an old-account lease cannot release a same-id Agent hold after switching', () => {
  const id = `agent-account-hold-${Date.now()}`
  const oldLease = acquireAgentMutation('deletion', id)
  assert.ok(oldLease)
  refreshAccount({ userId: 'hold-user-next', tenantId: 'hold-tenant-next' })
  assert.equal(isAgentDeletionHeld(id), false, 'switching clears old-account holds synchronously')

  const currentLease = acquireAgentMutation('deletion', id)
  assert.ok(currentLease)
  releaseAgentMutation(oldLease)
  assert.equal(isAgentDeletionHeld(id), true, 'late old-account settlement cannot release current work')
  releaseAgentMutation(currentLease)
  refreshAccount(null)
})
