import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CommonsItem } from '../../contract/index.ts'
import { mergeCommonsFollow, mergeCommonsWatch } from './standingRelationshipRevision.ts'

const card = (overrides: Partial<CommonsItem> = {}): CommonsItem => ({
  id: 'share:g-1',
  kind: 'share',
  at: 1,
  actor: 'Ada Lovelace',
  subject: { kind: 'project', id: 'p-1' },
  subjectName: 'Project one',
  commentCount: 0,
  likes: 4,
  ...overrides,
})

test('Follow acknowledgement changes only matching actor stamps', () => {
  const matching = card()
  const sibling = card({ id: 'share:g-2', actor: 'Grace Hopper', likes: 9 })
  const followed = mergeCommonsFollow([matching, sibling], 'Ada Lovelace', true)
  assert.equal(followed[0]?.followed, true)
  assert.equal(followed[0]?.likes, 4, 'unrelated card truth survives')
  assert.strictEqual(followed[1], sibling, 'another actor is untouched')

  const unfollowed = mergeCommonsFollow(followed, 'Ada Lovelace', false)
  assert.equal('followed' in unfollowed[0]!, false, 'absence remains the negative wire form')
})

test('Watch acknowledgement changes every matching subject and no sibling field', () => {
  const first = card()
  const second = card({ id: 'landing:p-2', kind: 'landing', actor: 'Grace Hopper' })
  const sibling = card({ id: 'share:g-3', subject: { kind: 'artifact', id: 'a-1' }, liked: true })
  const watched = mergeCommonsWatch([first, second, sibling], { kind: 'project', id: 'p-1' }, true)
  assert.equal(watched[0]?.watched, true)
  assert.equal(watched[1]?.watched, true)
  assert.strictEqual(watched[2], sibling)
  assert.equal(watched[2]?.liked, true, 'another relationship dimension survives')

  const unwatched = mergeCommonsWatch(watched, { kind: 'project', id: 'p-1' }, false)
  assert.equal('watched' in unwatched[0]!, false)
  assert.equal('watched' in unwatched[1]!, false)
})
