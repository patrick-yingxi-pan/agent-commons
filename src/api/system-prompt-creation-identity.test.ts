import test from 'node:test'
import assert from 'node:assert/strict'
import { systemPromptCreationId as serverSystemPromptCreationId } from '../../server/systemPromptCreationIdentity.ts'
import { systemPromptCreationId } from './systemPromptCreationIdentity.ts'

test('browser and server derive the same opaque system-prompt identity', async () => {
  const tenantId = 'tenant-prompt-parity'
  const key = 'prompt-create-parity-key'
  assert.equal(
    await systemPromptCreationId(tenantId, key),
    serverSystemPromptCreationId(tenantId, key),
  )
})
