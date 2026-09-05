import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseRetainedProviderSecretRotationIntents,
  releaseProviderSecretRotationIntent,
  retainProviderSecretRotationIntent,
  retainedProviderSecretRotationIntent,
} from './providerSecretRotationIntentPersistence.ts'

function installStorage() {
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
    },
  })
  return values
}

test('retained rotation coordinates bridge reload without storing the bearer', () => {
  const values = installStorage()
  const intent = {
    identityKey: 'user-a:tenant-a:session',
    tenantId: 'tenant-a',
    providerId: 'provider-a',
    expectedRevision: 4,
    intentId: 'logical-rotation-a',
  }
  retainProviderSecretRotationIntent(intent)
  assert.deepEqual(retainedProviderSecretRotationIntent(intent.identityKey), intent)
  const persisted = [...values.values()].join('')
  assert.match(persisted, /logical-rotation-a/)
  assert.doesNotMatch(persisted, /rv_live_|secret|bearer/i)
  releaseProviderSecretRotationIntent(intent)
  assert.equal(retainedProviderSecretRotationIntent(intent.identityKey), null)
  delete (globalThis as { localStorage?: unknown }).localStorage
})

test('retained rotation parsing rejects malformed rows and bounds account history', () => {
  const rows = Array.from({ length: 9 }, (_, index) => ({
    identityKey: `user-${index}:tenant:session`,
    tenantId: 'tenant',
    providerId: `provider-${index}`,
    expectedRevision: index,
    intentId: `key-${index}`,
    retainedAt: index,
  }))
  const parsed = parseRetainedProviderSecretRotationIntents(JSON.stringify([
    ...rows,
    { ...rows[0], identityKey: '', retainedAt: 20 },
    { ...rows[0], expectedRevision: -1, retainedAt: 21 },
  ]))
  assert.equal(parsed.length, 6)
  assert.equal(parsed[0]?.intentId, 'key-8')
  assert.deepEqual(parseRetainedProviderSecretRotationIntents('{bad'), [])
})
