import test from 'node:test'
import assert from 'node:assert/strict'
import {
  bindProviderCreationCredential,
  discardProviderCreationCredential,
  prepareProviderCreationCredential,
} from './providerCreationCredentialCore.ts'

function harness(reference = `PROVIDER_DESKTOP_${'A'.repeat(32)}`) {
  const calls: unknown[][] = []
  return {
    calls,
    deps: {
      async provision(secret: string) { calls.push(['provision', secret]); return reference },
      async bind(ref: string, providerId: string) { calls.push(['bind', ref, providerId]) },
      async discard(ref: string) { calls.push(['discard', ref]) },
    },
  }
}

test('a raw endpoint key becomes one reusable reference and binds only after provider acknowledgement', async () => {
  const h = harness()
  const attempt = { deviceSecret: 'raw-provider-key' }
  await prepareProviderCreationCredential(attempt, h.deps)
  await prepareProviderCreationCredential(attempt, h.deps)
  assert.equal(attempt.deviceSecret, undefined)
  assert.equal(attempt.credentialReference, `PROVIDER_DESKTOP_${'A'.repeat(32)}`)
  assert.deepEqual(h.calls, [['provision', 'raw-provider-key']])

  await bindProviderCreationCredential(attempt, 'provider-new-abc', h.deps)
  assert.deepEqual(h.calls.at(-1), ['bind', `PROVIDER_DESKTOP_${'A'.repeat(32)}`, 'provider-new-abc'])
})

test('a definitive refusal discards only its exact provisional key', async () => {
  const h = harness(`PROVIDER_DESKTOP_${'B'.repeat(32)}`)
  const attempt = { deviceSecret: 'raw-provider-key' }
  await prepareProviderCreationCredential(attempt, h.deps)
  await discardProviderCreationCredential(attempt, h.deps)
  await discardProviderCreationCredential(attempt, h.deps)
  assert.equal(attempt.credentialReference, undefined)
  assert.deepEqual(h.calls, [
    ['provision', 'raw-provider-key'],
    ['discard', `PROVIDER_DESKTOP_${'B'.repeat(32)}`],
  ])
})
