import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseRetainedApiTokenMintIntents,
  releaseApiTokenMintIntent,
  retainApiTokenMintIntent,
  retainedApiTokenMintIntent,
} from './apiTokenMintIntentPersistence.ts'

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

test('retained mint coordinates bridge restart without storing a bearer', () => {
  const values = installStorage()
  const intent = { identityKey: 'user-a:tenant-a:session', label: 'Laptop', intentId: 'logical-key-a' }
  retainApiTokenMintIntent(intent)

  assert.deepEqual(retainedApiTokenMintIntent(intent.identityKey), intent)
  const persisted = [...values.values()].join('')
  assert.match(persisted, /logical-key-a/)
  assert.doesNotMatch(persisted, /Bearer|tokenValue|session:/)

  releaseApiTokenMintIntent(intent)
  assert.equal(retainedApiTokenMintIntent(intent.identityKey), null)
  delete (globalThis as { localStorage?: unknown }).localStorage
})

test('retained mint parsing rejects malformed rows and bounds account history', () => {
  const rows = Array.from({ length: 9 }, (_, index) => ({
    identityKey: `user-${index}:tenant:session`,
    intentId: `key-${index}`,
    retainedAt: index,
  }))
  const parsed = parseRetainedApiTokenMintIntents(JSON.stringify([
    ...rows,
    { identityKey: '', intentId: 'bad', retainedAt: 20 },
    { identityKey: 'bad', intentId: '', retainedAt: 21 },
  ]))
  assert.equal(parsed.length, 6)
  assert.equal(parsed[0]?.intentId, 'key-8')
  assert.deepEqual(parseRetainedApiTokenMintIntents('{bad'), [])
})
