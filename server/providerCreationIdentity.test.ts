import test from 'node:test'
import assert from 'node:assert/strict'
import { providerCreationId } from './providerCreationIdentity.ts'

test('provider creation identity is deterministic, tenant-scoped, and opaque', () => {
  const key = 'provider-create-key-that-must-not-leak'
  const first = providerCreationId('tenant-a', key)
  assert.equal(first, providerCreationId('tenant-a', key))
  assert.notEqual(first, providerCreationId('tenant-b', key))
  assert.match(first, /^provider-new-[a-f0-9]{24}$/)
  assert.doesNotMatch(first, /tenant-a|provider-create-key/)
})
