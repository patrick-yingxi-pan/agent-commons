import assert from 'node:assert/strict'
import { test } from 'node:test'
import { agentRequestId } from './agentRequests.ts'
import { proxyRequestId } from '../../server/proxyRequestRegistry.ts'

test('browser Agent request identity matches the server digest and includes exact tenant, user, and key scope', async () => {
  const tenantId = 'tenant-identity-test'
  const userId = 'person-identity-test'
  const key = 'agent-request-key-that-must-not-leak'
  const id = await agentRequestId(tenantId, userId, key)

  assert.equal(id, proxyRequestId({ tenantId, userId }, key))
  assert.equal(id, await agentRequestId(tenantId, userId, key), 'same scope and key reuse one opaque identity')
  assert.match(id, /^agent-request-[a-f0-9]{32}$/)
  assert.notEqual(id, await agentRequestId('tenant-other', userId, key))
  assert.notEqual(id, await agentRequestId(tenantId, 'person-other', key))
  assert.notEqual(id, await agentRequestId(tenantId, userId, 'different-key'))
  assert.doesNotMatch(id, /tenant-identity-test|person-identity-test|agent-request-key/)
})
