import test from 'node:test'
import assert from 'node:assert/strict'
import { isSessionCompactionId, sessionCompactionId } from './sessionCompactionIdentity.ts'

test('Session compaction receipt identity is deterministic, scoped, and opaque', () => {
  const id = sessionCompactionId('tenant-a', 'session-a', 'retry-key')
  assert.equal(id, sessionCompactionId('tenant-a', 'session-a', 'retry-key'))
  assert.match(id, /^session-compaction-[a-f0-9]{24}$/)
  assert.equal(isSessionCompactionId(id), true)
  assert.notEqual(id, sessionCompactionId('tenant-b', 'session-a', 'retry-key'))
  assert.notEqual(id, sessionCompactionId('tenant-a', 'session-b', 'retry-key'))
  assert.notEqual(id, sessionCompactionId('tenant-a', 'session-a', 'another-key'))
  assert.doesNotMatch(id, /tenant|session-a|retry-key/)
  assert.equal(isSessionCompactionId('session-compaction-not-a-receipt'), false)
})
