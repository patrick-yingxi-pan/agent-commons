import test from 'node:test'
import assert from 'node:assert/strict'
import {
  agentCreationId as serverAgentCreationId,
  agentForkCreationId as serverAgentForkCreationId,
  agentImportCreationId as serverAgentImportCreationId,
} from '../../server/agentCreationIdentity.ts'
import {
  agentCreationId,
  agentForkCreationId,
  agentImportCreationId,
} from './agentCreationIdentity.ts'

test('browser and server derive the same opaque Agent identity', async () => {
  const tenantId = 'tenant-agent-parity'
  const key = 'agent-create-parity-key'
  assert.equal(await agentCreationId(tenantId, key), serverAgentCreationId(tenantId, key))
  assert.equal(await agentForkCreationId(tenantId, key), serverAgentForkCreationId(tenantId, key))
  assert.equal(await agentImportCreationId(tenantId, key), serverAgentImportCreationId(tenantId, key))
  assert.notEqual(await agentCreationId(tenantId, key), await agentForkCreationId(tenantId, key))
  assert.notEqual(await agentCreationId(tenantId, key), await agentImportCreationId(tenantId, key))
  assert.notEqual(await agentForkCreationId(tenantId, key), await agentImportCreationId(tenantId, key))
})
