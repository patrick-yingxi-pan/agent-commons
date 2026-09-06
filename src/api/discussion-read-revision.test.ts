import { test } from 'node:test'
import assert from 'node:assert/strict'
import { discussionReadRealized } from './discussionReadRevision.ts'

test('discussion read recovery requires the exact echoed post and realized cursor', () => {
  assert.equal(discussionReadRealized({ throughPostId: 'post-1', read: true }, 'post-1'), true)
  assert.equal(discussionReadRealized({ throughPostId: 'post-1', read: false }, 'post-1'), false)
  assert.equal(
    discussionReadRealized({ throughPostId: 'post-later', read: true }, 'post-1'),
    false,
    'a crossed response cannot settle another cursor',
  )
})
