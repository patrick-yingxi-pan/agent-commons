import test from 'node:test'
import assert from 'node:assert/strict'
import {
  acquireCommissionMutation,
  isCommissionConfigurationHeld,
  isCommissionDeletionHeld,
  releaseCommissionMutation,
} from './commissionMutationHolds.ts'

test('Contributor configuration and removal exclude one another with reference-counted leases', () => {
  const id = `commission-hold-${Date.now()}`
  const firstEdit = acquireCommissionMutation('configuration', id)
  const secondEdit = acquireCommissionMutation('configuration', id)
  assert.ok(firstEdit && secondEdit)
  assert.equal(isCommissionConfigurationHeld(id), true)
  assert.equal(acquireCommissionMutation('deletion', id), null, 'removal cannot race held configuration')

  releaseCommissionMutation(firstEdit)
  assert.equal(isCommissionConfigurationHeld(id), true, 'one caller cannot release another edit hold')
  releaseCommissionMutation(secondEdit)
  assert.equal(isCommissionConfigurationHeld(id), false)

  const deletion = acquireCommissionMutation('deletion', id)
  assert.ok(deletion)
  assert.equal(isCommissionDeletionHeld(id), true)
  assert.equal(acquireCommissionMutation('configuration', id), null, 'configuration cannot race held removal')
  releaseCommissionMutation(deletion)
  assert.equal(isCommissionDeletionHeld(id), false)
})
