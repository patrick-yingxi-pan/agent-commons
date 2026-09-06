import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CommonsItem } from '../../contract/index.ts'
import { mergeCommonsLikeMembership } from './commonsLikeRevision.ts'

const card = (overrides: Partial<CommonsItem> = {}): CommonsItem => ({
  id: 'share:g-1',
  kind: 'share',
  at: 1,
  actor: 'Ada Lovelace',
  subject: { kind: 'project', id: 'p-1' },
  subjectName: 'Project one',
  commentCount: 2,
  likes: 7,
  watched: true,
  ...overrides,
})

test('Like acknowledgement changes only the addressed viewer membership', () => {
  const addressed = card()
  const sibling = card({ id: 'share:g-2', likes: 11, followed: true })
  const liked = mergeCommonsLikeMembership([addressed, sibling], addressed.id, true)
  assert.equal(liked[0]?.liked, true)
  assert.equal(liked[0]?.likes, 7, 'a crossed public aggregate is not rewritten from acknowledgement')
  assert.equal(liked[0]?.watched, true, 'orthogonal viewer state survives')
  assert.strictEqual(liked[1], sibling, 'another item keeps identity and every field')

  const unliked = mergeCommonsLikeMembership(liked, addressed.id, false)
  assert.equal('liked' in unliked[0]!, false, 'absence remains the negative Commons wire form')
  assert.equal(unliked[0]?.likes, 7)
})
