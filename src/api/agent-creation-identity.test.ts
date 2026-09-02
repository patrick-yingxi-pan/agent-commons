import test from 'node:test'
import assert from 'node:assert/strict'
import { agentCreationId as serverAgentCreationId } from '../../server/agentCreationIdentity.ts'
import { agentCreationId } from './agentCreationIdentity.ts'

test('browser and server derive the same opaque Agent identity', async () => {
  const tenantId = 'tenant-agent-parity'
  const key = 'agent-create-parity-key'
  assert.equal(await agentCreationId(tenantId, key), serverAgentCreationId(tenantId, key))
})
