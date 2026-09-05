import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isRelationActionDecisionId,
  relationActionDecisionId,
} from './relationActionDecisionIdentity.ts'

test('relation action decision ids bind tenant, conversation, message, operation, and logical key', () => {
  const key = 'one-logical-relation-decision'
  const id = relationActionDecisionId('tenant-a', 'session-a', 'message-a', 'operation-a', key)
  assert.equal(id, relationActionDecisionId('tenant-a', 'session-a', 'message-a', 'operation-a', key))
  assert.match(id, /^relation-action-decision-[a-f0-9]{24}$/)
  assert.equal(isRelationActionDecisionId(id), true)
  assert.notEqual(id, relationActionDecisionId('tenant-b', 'session-a', 'message-a', 'operation-a', key))
  assert.notEqual(id, relationActionDecisionId('tenant-a', 'session-b', 'message-a', 'operation-a', key))
  assert.notEqual(id, relationActionDecisionId('tenant-a', 'session-a', 'message-b', 'operation-a', key))
  assert.notEqual(id, relationActionDecisionId('tenant-a', 'session-a', 'message-a', 'operation-b', key))
  assert.notEqual(id, relationActionDecisionId('tenant-a', 'session-a', 'message-a', 'operation-a', 'another-key'))
  assert.equal(isRelationActionDecisionId('relation-action-decision-nope'), false)
})
