import { test } from 'node:test'
import assert from 'node:assert/strict'
import { artifactHistoryRevision } from './artifactHistoryLocation.ts'

test('artifact history revisions accept exact nonnegative safe-integer decimal strings', () => {
  assert.equal(artifactHistoryRevision('0'), 0)
  assert.equal(artifactHistoryRevision('7'), 7)
  assert.equal(artifactHistoryRevision(String(Number.MAX_SAFE_INTEGER)), Number.MAX_SAFE_INTEGER)
})

test('artifact history revisions refuse malformed, ambiguous, and unsafe values', () => {
  for (const value of [undefined, null, '', '-1', '+1', '01', '1.0', '1e2', ' 1', '1 ', '9007199254740992']) {
    assert.equal(artifactHistoryRevision(value), undefined, `reject ${String(value)}`)
  }
})
