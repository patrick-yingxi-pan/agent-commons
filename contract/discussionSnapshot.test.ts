import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DISCUSSION_SNAPSHOT_MAX_BYTES,
  buildDiscussionSnapshot,
  discussionContextId,
  discussionIdFromContextId,
  isDiscussionSnapshot,
  type DiscussionSnapshot,
} from './discussionSnapshot.ts'
import { discussionTitle, type Discussion } from './social.ts'

const SNAPSHOT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CAPTURED_AT = '2026-10-06T12:34:56.789Z'
const AT_1 = Date.parse('2026-10-06T12:00:00.000Z')

function discussion(posts: Discussion['posts']): Pick<Discussion, 'id' | 'posts'> {
  return { id: 'disc/example:1', posts }
}

test('discussion context ids are reserved, encoded, canonical, and bounded', () => {
  const id = 'disc/含有 spaces:and%percent'
  const contextId = discussionContextId(id)
  assert.equal(contextId, 'discussion::disc%2F%E5%90%AB%E6%9C%89%20spaces%3Aand%25percent')
  assert.equal(discussionIdFromContextId(contextId), id)
  assert.equal(discussionIdFromContextId('other::disc%2F1'), null)
  assert.equal(discussionIdFromContextId('discussion::'), null)
  assert.equal(discussionIdFromContextId(`discussion::${'a'.repeat(201)}`), null)
  assert.equal(discussionIdFromContextId('discussion::bad%escape'), null)
  assert.equal(discussionIdFromContextId('discussion::%61'), null, 'noncanonical escapes do not alias a different context id')
  assert.equal(discussionIdFromContextId('discussion::bad%0Aline'), null)
  assert.equal(discussionIdFromContextId('discussion::%ED%A0%80'), null, 'invalid UTF-8/Unicode is refused')
  assert.equal(discussionIdFromContextId(`discussion::${'a'.repeat(200)}`), 'a'.repeat(200))
})

test('builds an exact deterministic transcript with display author, UTC time, bodies, and numeric reply parents', () => {
  const firstBody = 'Opening paragraph.'
  const secondBody = 'First reply line.\nSecond line with café & exact punctuation!'
  const thirdBody = 'A reply to the reply.'
  const source = discussion([
    { id: 'post-root', author: 'Ada Lovelace', body: firstBody, at: AT_1, reactions: 7, reported: true, mine: true },
    { id: 'post-answer', author: 'Grace Hopper', body: secondBody, at: AT_1 + 1_234, reactions: 2, reacted: true, replyTo: 'post-root' },
    { id: 'post-follow-up', author: 'Ada Lovelace', body: thirdBody, at: AT_1 + 60_000, reactions: 0, replyTo: 'post-answer' },
  ])
  const snapshot = buildDiscussionSnapshot(source, SNAPSHOT_ID, CAPTURED_AT)
  assert.ok(snapshot)
  assert.deepEqual(snapshot, {
    version: 1,
    snapshotId: SNAPSHOT_ID,
    capturedAt: CAPTURED_AT,
    discussionId: 'disc/example:1',
    title: discussionTitle(firstBody),
    postCount: 3,
    text: '# Opening paragraph.\n\n' +
      '[1] Ada Lovelace · 2026-10-06T12:00:00.000Z\nOpening paragraph.\n\n' +
      '[2] Grace Hopper · 2026-10-06T12:00:01.234Z · reply to #1\n' + secondBody + '\n\n' +
      '[3] Ada Lovelace · 2026-10-06T12:01:00.000Z · reply to #2\nA reply to the reply.',
  })
  assert.equal(snapshot.text.includes(secondBody), true, 'the original multi-line body is preserved byte-for-byte as text')
  assert.equal(snapshot.text.includes('reactions'), false)
  assert.equal(snapshot.text.includes('reported'), false)
  assert.equal(snapshot.text.includes('tenantId'), false)
  assert.deepEqual(Object.keys(snapshot).sort(), ['capturedAt', 'discussionId', 'postCount', 'snapshotId', 'text', 'title', 'version'])
  assert.equal(isDiscussionSnapshot(snapshot), true)
})

test('projects only permitted discussion inputs and rejects malformed whole transcripts', () => {
  const source = {
    ...discussion([{ id: 'post-root', author: 'Ada', body: 'Exact body.', at: AT_1, reactions: 99, reported: true }]),
    tenantId: 'private-tenant',
    openedById: 'private-user-id',
    unreadPosts: ['post-root'],
    anchor: { kind: 'project', id: 'private-project-id' },
  } as unknown as Pick<Discussion, 'id' | 'posts'>
  const snapshot = buildDiscussionSnapshot(source, SNAPSHOT_ID, CAPTURED_AT)
  assert.ok(snapshot)
  assert.equal(snapshot.text.includes('private-tenant'), false)
  assert.equal(snapshot.text.includes('private-user-id'), false)
  assert.equal(snapshot.text.includes('private-project-id'), false)
  assert.equal(snapshot.text.includes('99'), false)
  assert.deepEqual(Object.keys(snapshot).sort(), ['capturedAt', 'discussionId', 'postCount', 'snapshotId', 'text', 'title', 'version'])

  const malformed: unknown[] = [
    null,
    [],
    { ...snapshot, version: 2 },
    { ...snapshot, snapshotId: 'not-a-uuid' },
    { ...snapshot, capturedAt: '2026-02-30T12:00:00.000Z' },
    { ...snapshot, discussionId: '' },
    { ...snapshot, discussionId: 'bad\u0000id' },
    { ...snapshot, title: '' },
    { ...snapshot, title: 'x'.repeat(161) },
    { ...snapshot, postCount: 0 },
    { ...snapshot, postCount: 201 },
    { ...snapshot, text: 'bad\u0000text' },
    { ...snapshot, text: 'bad\u0085text' },
    { ...snapshot, text: '\ud800' },
    { ...snapshot, extra: 'authority' },
  ]
  for (const value of malformed) assert.equal(isDiscussionSnapshot(value), false, JSON.stringify(value))
  const withSymbol = { ...snapshot, [Symbol('tenant')]: 'private' }
  assert.equal(isDiscussionSnapshot(withSymbol), false, 'symbol keys are also outside the closed wire shape')

  const invalidInput = [
    discussion([]),
    discussion(Array.from({ length: 201 }, (_, index) => ({ id: `post-${index}`, author: 'Ada', body: 'body', at: AT_1, reactions: 0 }))),
    discussion([{ id: 'post-root', author: 'Ada', body: 'bad\ud800', at: AT_1, reactions: 0 }]),
    discussion([{ id: 'post-root', author: 'Ada', body: 'bad\u0000', at: AT_1, reactions: 0 }]),
    discussion([{ id: 'post-root', author: 'Ada', body: 'body', at: Number.MAX_SAFE_INTEGER, reactions: 0 }]),
    discussion([{ id: 'post-root', author: 'Ada', body: 'body', at: AT_1, reactions: 0, replyTo: 'missing-parent' }]),
    discussion([
      { id: 'post-root', author: 'Ada', body: 'body', at: AT_1, reactions: 0 },
      { id: 'post-root', author: 'Grace', body: 'duplicate id', at: AT_1 + 1, reactions: 0 },
    ]),
  ]
  for (const candidate of invalidInput) assert.equal(buildDiscussionSnapshot(candidate, SNAPSHOT_ID, CAPTURED_AT), null)
  assert.equal(buildDiscussionSnapshot(discussion([{ id: 'post-root', author: 'Ada', body: 'ok', at: AT_1, reactions: 0 }]), SNAPSHOT_ID, 'not-a-time'), null)
  assert.equal(buildDiscussionSnapshot(discussion([{ id: 'post-root', author: 'Ada', body: 'ok', at: AT_1, reactions: 0 }]), 'not-a-uuid', CAPTURED_AT), null)
})

test('bounds whole UTF-8 transcripts and post counts without truncation', () => {
  assert.equal(DISCUSSION_SNAPSHOT_MAX_BYTES, 65_536)
  const titleStableBody = 'x'.repeat(81)
  const base = buildDiscussionSnapshot(
    discussion([{ id: 'post-root', author: 'Ada', body: titleStableBody, at: AT_1, reactions: 0 }]),
    SNAPSHOT_ID,
    CAPTURED_AT,
  )
  assert.ok(base)
  const prefixBytes = new TextEncoder().encode(base.text).byteLength - titleStableBody.length
  const atLimitBody = 'x'.repeat(DISCUSSION_SNAPSHOT_MAX_BYTES - prefixBytes)
  const atLimit = buildDiscussionSnapshot(
    discussion([{ id: 'post-root', author: 'Ada', body: atLimitBody, at: AT_1, reactions: 0 }]),
    SNAPSHOT_ID,
    CAPTURED_AT,
  )
  assert.ok(atLimit)
  assert.equal(new TextEncoder().encode(atLimit.text).byteLength, DISCUSSION_SNAPSHOT_MAX_BYTES)
  assert.equal(atLimit.text.endsWith(atLimitBody), true, 'the accepted boundary transcript keeps every source character')
  assert.equal(buildDiscussionSnapshot(
    discussion([{ id: 'post-root', author: 'Ada', body: `${atLimitBody}x`, at: AT_1, reactions: 0 }]),
    SNAPSHOT_ID,
    CAPTURED_AT,
  ), null, 'an oversized transcript is refused as a whole')

  const twoByte = 'é'.repeat(40_000)
  assert.equal(isDiscussionSnapshot({
    version: 1, snapshotId: SNAPSHOT_ID, capturedAt: CAPTURED_AT, discussionId: 'd', title: 'Title', postCount: 1, text: twoByte,
  }), false, 'UTF-8 bytes, not code units, enforce the limit')
  const unicode = 'é'.repeat(32_768 - 1) + 'x'
  assert.equal(new TextEncoder().encode(unicode).byteLength, DISCUSSION_SNAPSHOT_MAX_BYTES - 1)
  assert.equal(isDiscussionSnapshot({
    version: 1, snapshotId: SNAPSHOT_ID, capturedAt: CAPTURED_AT, discussionId: 'd', title: 'Title', postCount: 1, text: unicode,
  }), true)

  const maxPosts = Array.from({ length: 200 }, (_, index) => ({
    id: `post-${index + 1}`,
    author: 'Ada',
    body: index === 0 ? 'Opening' : `Body ${index + 1}`,
    at: AT_1 + index,
    reactions: index,
    ...(index > 0 ? { replyTo: `post-${index}` } : {}),
  }))
  const maxSnapshot = buildDiscussionSnapshot(discussion(maxPosts), SNAPSHOT_ID, CAPTURED_AT)
  assert.ok(maxSnapshot)
  assert.equal(maxSnapshot.postCount, 200)
  assert.equal(maxSnapshot.text.includes('reply to #199'), true)
})

test('rejects malformed UTF-16 instead of encoding replacement characters', () => {
  const malformed: DiscussionSnapshot = {
    version: 1,
    snapshotId: SNAPSHOT_ID,
    capturedAt: CAPTURED_AT,
    discussionId: 'disc-valid',
    title: 'Title',
    postCount: 1,
    text: 'prefix \udfff suffix',
  }
  assert.equal(isDiscussionSnapshot(malformed), false)
  assert.equal(buildDiscussionSnapshot(
    discussion([{ id: 'post-root', author: 'Ada', body: 'prefix \udfff suffix', at: AT_1, reactions: 0 }]),
    SNAPSHOT_ID,
    CAPTURED_AT,
  ), null)
})
