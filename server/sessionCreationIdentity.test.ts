import test from 'node:test'
import assert from 'node:assert/strict'
import { dispatchSessionId, isDispatchSessionId, manualDispatchRunId } from './dispatchIdentity.ts'
import {
  isDraftSessionCreationId,
  isForkSessionCreationId,
  isSessionCreationId,
  sessionCreationId,
  sessionForkCreationId,
} from './sessionCreationIdentity.ts'

test('draft materialization identity is deterministic, tenant-scoped, and opaque', () => {
  const key = 'draft-materialization-key-that-must-not-leak'
  const first = sessionCreationId('tenant-a', key)
  assert.equal(first, sessionCreationId('tenant-a', key))
  assert.notEqual(first, sessionCreationId('tenant-b', key))
  assert.equal(isSessionCreationId(first), true)
  assert.equal(isDraftSessionCreationId(first), true)
  assert.equal(isSessionCreationId('sess-123'), false)
  assert.doesNotMatch(first, /tenant-a|materialization-key/)
})

test('conversation branch identity is deterministic, tenant-scoped, opaque, and disjoint from drafts', () => {
  const key = 'continue-from-here-key-that-must-not-leak'
  const fork = sessionForkCreationId('tenant-a', key)
  assert.equal(fork, sessionForkCreationId('tenant-a', key))
  assert.notEqual(fork, sessionForkCreationId('tenant-b', key))
  assert.notEqual(fork, sessionCreationId('tenant-a', key))
  assert.equal(isSessionCreationId(fork), true)
  assert.equal(isForkSessionCreationId(fork), true)
  assert.equal(isDraftSessionCreationId(fork), false)
  assert.doesNotMatch(fork, /tenant-a|continue-from-here-key/)
})

test('Dispatch conversations share durable retirement without colliding with drafts or branches', () => {
  const key = 'dispatch-identity-key'
  const id = dispatchSessionId(manualDispatchRunId('owner', key))
  assert.equal(isDispatchSessionId(id), true)
  assert.equal(isSessionCreationId(id), true)
  assert.notEqual(id, sessionCreationId('owner', key))
  assert.notEqual(id, sessionForkCreationId('owner', key))
  assert.notEqual(id, dispatchSessionId(manualDispatchRunId('foreign', key)))
  assert.throws(() => dispatchSessionId('legacy-seed-id'))
})
