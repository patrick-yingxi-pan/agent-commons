import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isToolActivityDecisionId, toolActivityDecisionId } from './toolActivityDecisionIdentity.ts'

test('tool activity decision ids bind tenant, conversation, activity, and logical key', () => {
  const key = 'one-logical-tool-decision'
  const id = toolActivityDecisionId('tenant-a', 'session-a', 'activity-a', key)
  assert.equal(id, toolActivityDecisionId('tenant-a', 'session-a', 'activity-a', key))
  assert.match(id, /^tool-activity-decision-[a-f0-9]{24}$/)
  assert.equal(isToolActivityDecisionId(id), true)
  assert.notEqual(id, toolActivityDecisionId('tenant-b', 'session-a', 'activity-a', key))
  assert.notEqual(id, toolActivityDecisionId('tenant-a', 'session-b', 'activity-a', key))
  assert.notEqual(id, toolActivityDecisionId('tenant-a', 'session-a', 'activity-b', key))
  assert.notEqual(id, toolActivityDecisionId('tenant-a', 'session-a', 'activity-a', 'another-key'))
  assert.equal(isToolActivityDecisionId('tool-activity-decision-nope'), false)
})
