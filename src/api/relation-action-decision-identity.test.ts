import { test } from 'node:test'
import assert from 'node:assert/strict'
import { relationActionDecisionId } from './relationActionDecisionIdentity.ts'
import { relationActionDecisionId as serverRelationActionDecisionId } from '../../server/relationActionDecisionIdentity.ts'

test('browser relation action decision identity matches the server and is scope-sensitive', async () => {
  const key = 'one-logical-relation-decision'
  const args = ['tenant-a', 'session-a', 'message-a', 'operation-a', key] as const
  const id = await relationActionDecisionId(...args)
  assert.equal(id, serverRelationActionDecisionId(...args))
  assert.equal(id, await relationActionDecisionId(...args))
  assert.match(id, /^relation-action-decision-[a-f0-9]{24}$/)
  assert.notEqual(id, await relationActionDecisionId('tenant-b', 'session-a', 'message-a', 'operation-a', key))
  assert.notEqual(id, await relationActionDecisionId('tenant-a', 'session-b', 'message-a', 'operation-a', key))
  assert.notEqual(id, await relationActionDecisionId('tenant-a', 'session-a', 'message-b', 'operation-a', key))
  assert.notEqual(id, await relationActionDecisionId('tenant-a', 'session-a', 'message-a', 'operation-b', key))
})
