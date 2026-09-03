import test from 'node:test'
import assert from 'node:assert/strict'
import { isSessionCreationId, sessionCreationId } from './sessionCreationIdentity.ts'

test('draft materialization identity is deterministic, tenant-scoped, and opaque', () => {
  const key = 'draft-materialization-key-that-must-not-leak'
  const first = sessionCreationId('tenant-a', key)
  assert.equal(first, sessionCreationId('tenant-a', key))
  assert.notEqual(first, sessionCreationId('tenant-b', key))
  assert.equal(isSessionCreationId(first), true)
  assert.equal(isSessionCreationId('sess-123'), false)
  assert.doesNotMatch(first, /tenant-a|materialization-key/)
})
