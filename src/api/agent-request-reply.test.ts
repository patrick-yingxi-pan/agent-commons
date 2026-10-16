import { test } from 'node:test'
import assert from 'node:assert/strict'
import { keys, paths } from './keys.ts'

test('private reply-draft review has a distinct encoded route and cache identity', () => {
  const id = 'agent-request-private/id'
  assert.equal(paths.agentRequestReplyReview(id), '/agent-requests/agent-request-private%2Fid/reply-review')
  assert.equal(keys.agentRequestReplyReview(id), 'agent-request-review:agent-request-private/id:reply')
  assert.ok(keys.agentRequestReplyReview(id).startsWith('agent-request-review:'),
    'model and tool reviews share the existing authority-change invalidation family')
  assert.notEqual(keys.agentRequestReplyReview(id), keys.agentRequestReview(id))
  assert.notEqual(paths.agentRequestReplyReview(id), paths.agentRequestReview(id))
})
