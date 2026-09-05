import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toolActivityDecisionId } from './toolActivityDecisionIdentity.ts'
import { toolActivityDecisionId as serverToolActivityDecisionId } from '../../server/toolActivityDecisionIdentity.ts'

test('browser tool activity decision identity is stable and scope-sensitive', async () => {
  const key = 'one-logical-tool-decision'
  const id = await toolActivityDecisionId('tenant-a', 'session-a', 'activity-a', key)
  assert.equal(id, serverToolActivityDecisionId('tenant-a', 'session-a', 'activity-a', key))
  assert.equal(id, await toolActivityDecisionId('tenant-a', 'session-a', 'activity-a', key))
  assert.match(id, /^tool-activity-decision-[a-f0-9]{24}$/)
  assert.notEqual(id, await toolActivityDecisionId('tenant-b', 'session-a', 'activity-a', key))
  assert.notEqual(id, await toolActivityDecisionId('tenant-a', 'session-b', 'activity-a', key))
  assert.notEqual(id, await toolActivityDecisionId('tenant-a', 'session-a', 'activity-b', key))
})
