import test from 'node:test'
import assert from 'node:assert/strict'
import {
  acquireProviderMutation,
  isProviderConnectionHeld,
  isProviderDefinitionHeld,
  isProviderDeletionHeld,
  releaseProviderMutation,
} from './providerMutationHolds.ts'
import { refreshAccount } from '../api/account.ts'

test('Provider definition, connection, and removal exclude other mutation domains', () => {
  const id = `provider-hold-${Date.now()}`
  const firstDefinition = acquireProviderMutation('definition', id)
  const secondDefinition = acquireProviderMutation('definition', id)
  assert.ok(firstDefinition && secondDefinition)
  assert.equal(isProviderDefinitionHeld(id), true)
  assert.equal(acquireProviderMutation('connection', id), null)
  assert.equal(acquireProviderMutation('deletion', id), null)

  releaseProviderMutation(firstDefinition)
  assert.equal(isProviderDefinitionHeld(id), true, 'one caller cannot release another hold')
  releaseProviderMutation(secondDefinition)
  assert.equal(isProviderDefinitionHeld(id), false)

  const connection = acquireProviderMutation('connection', id)
  assert.ok(connection)
  assert.equal(isProviderConnectionHeld(id), true)
  assert.equal(acquireProviderMutation('deletion', id), null)
  releaseProviderMutation(connection)

  const deletion = acquireProviderMutation('deletion', id)
  assert.ok(deletion)
  assert.equal(isProviderDeletionHeld(id), true)
  assert.equal(acquireProviderMutation('definition', id), null)
  assert.equal(acquireProviderMutation('connection', id), null)
  releaseProviderMutation(deletion)
})

test('an old-account Provider lease cannot release current-account work', () => {
  const id = `provider-account-hold-${Date.now()}`
  const oldLease = acquireProviderMutation('deletion', id)
  assert.ok(oldLease)
  refreshAccount({ userId: 'provider-hold-next', tenantId: 'provider-hold-tenant-next' })
  assert.equal(isProviderDeletionHeld(id), false)

  const currentLease = acquireProviderMutation('deletion', id)
  assert.ok(currentLease)
  releaseProviderMutation(oldLease)
  assert.equal(isProviderDeletionHeld(id), true)
  releaseProviderMutation(currentLease)
  refreshAccount(null)
})
