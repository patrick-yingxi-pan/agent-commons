import test from 'node:test'
import assert from 'node:assert/strict'
import { providerSecretRotationId } from './providerSecretRotationIdentity.ts'

test('provider secret-rotation identity is stable and separated by tenant and provider', () => {
  const first = providerSecretRotationId('tenant-a', 'provider-a', 'logical-key')
  assert.equal(first, providerSecretRotationId('tenant-a', 'provider-a', 'logical-key'))
  assert.notEqual(first, providerSecretRotationId('tenant-b', 'provider-a', 'logical-key'))
  assert.notEqual(first, providerSecretRotationId('tenant-a', 'provider-b', 'logical-key'))
  assert.match(first, /^provider-secret-rotation-[a-f0-9]{24}$/)
})
