import test from 'node:test'
import assert from 'node:assert/strict'
import {
  acquireSystemPromptMutation,
  isSystemPromptDefinitionHeld,
  isSystemPromptDeletionHeld,
  releaseSystemPromptMutation,
} from './systemPromptMutationHolds.ts'
import { refreshAccount } from '../api/account.ts'

test('System Prompt definition and removal exclude each other without collapsing same-kind callers', () => {
  const id = `prompt-hold-${Date.now()}`
  const firstDefinition = acquireSystemPromptMutation('definition', id)
  const secondDefinition = acquireSystemPromptMutation('definition', id)
  assert.ok(firstDefinition && secondDefinition)
  assert.equal(isSystemPromptDefinitionHeld(id), true)
  assert.equal(acquireSystemPromptMutation('deletion', id), null)

  releaseSystemPromptMutation(firstDefinition)
  assert.equal(isSystemPromptDefinitionHeld(id), true, 'one caller cannot release another hold')
  releaseSystemPromptMutation(secondDefinition)
  assert.equal(isSystemPromptDefinitionHeld(id), false)

  const deletion = acquireSystemPromptMutation('deletion', id)
  assert.ok(deletion)
  assert.equal(isSystemPromptDeletionHeld(id), true)
  assert.equal(acquireSystemPromptMutation('definition', id), null)
  releaseSystemPromptMutation(deletion)
})

test('an old-account System Prompt lease cannot release current-account work', () => {
  const id = `prompt-account-hold-${Date.now()}`
  const oldLease = acquireSystemPromptMutation('deletion', id)
  assert.ok(oldLease)
  refreshAccount({ userId: 'prompt-hold-next', tenantId: 'prompt-hold-tenant-next' })
  assert.equal(isSystemPromptDeletionHeld(id), false)

  const currentLease = acquireSystemPromptMutation('deletion', id)
  assert.ok(currentLease)
  releaseSystemPromptMutation(oldLease)
  assert.equal(isSystemPromptDeletionHeld(id), true)
  releaseSystemPromptMutation(currentLease)
  refreshAccount(null)
})
