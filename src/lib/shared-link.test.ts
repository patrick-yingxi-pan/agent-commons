import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SOCIAL_ENTITY_KINDS, type SocialEntityKind } from '../../contract/index.ts'
import { sharedLinkAddress, sharedLinkFailurePhase, sharedSubjectPath } from './sharedLink.ts'

test('share-link addresses accept one bounded base64url token and never throw on malformed input', () => {
  assert.deepEqual(sharedLinkAddress('/shared/Abc_123-xyz'), { kind: 'token', token: 'Abc_123-xyz' })
  assert.deepEqual(sharedLinkAddress('/shared/Abc_123-xyz/'), { kind: 'token', token: 'Abc_123-xyz' })
  assert.deepEqual(sharedLinkAddress('/projects/p-1'), { kind: 'none' })
  assert.deepEqual(sharedLinkAddress('/shared'), { kind: 'invalid' })
  assert.deepEqual(sharedLinkAddress('/shared/'), { kind: 'invalid' })
  assert.deepEqual(sharedLinkAddress('/shared/a/b'), { kind: 'invalid' })
  assert.deepEqual(sharedLinkAddress('/shared/a%2Fb'), { kind: 'invalid' })
  assert.deepEqual(sharedLinkAddress('/shared/%E0%A4%A'), { kind: 'invalid' })
  assert.deepEqual(sharedLinkAddress(`/shared/${'a'.repeat(257)}`), { kind: 'invalid' })
})

test('every social noun has one canonical post-redemption destination', () => {
  const expected: Record<SocialEntityKind, string> = {
    session: '/s/subject%20id',
    project: '/projects/subject%20id',
    artifact: '/artifacts/subject%20id',
    context: '/contexts/subject%20id',
    schedule: '/scheduled/subject%20id',
    discussion: '/discussions/subject%20id',
    proposal: '/commons',
    principal: '/u/subject%20id',
  }
  assert.equal(Object.keys(expected).length, SOCIAL_ENTITY_KINDS.length)
  for (const kind of SOCIAL_ENTITY_KINDS) {
    assert.equal(sharedSubjectPath({ kind, id: 'subject id' }), expected[kind], kind)
  }
})

test('share-link failures distinguish terminal absence, identity drift, and recoverable interruption', () => {
  assert.equal(sharedLinkFailurePhase(404), 'unavailable')
  assert.equal(sharedLinkFailurePhase(400), 'unavailable')
  assert.equal(sharedLinkFailurePhase(409), 'identity-changed')
  assert.equal(sharedLinkFailurePhase(401), 'identity-changed')
  assert.equal(sharedLinkFailurePhase(null, true), 'identity-changed')
  assert.equal(sharedLinkFailurePhase(0), 'retryable')
  assert.equal(sharedLinkFailurePhase(429), 'retryable')
  assert.equal(sharedLinkFailurePhase(503), 'retryable')
})
