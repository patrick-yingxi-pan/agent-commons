import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ModelProvider } from '../../contract/index.ts'
import { replaceProviderConnectionCore } from './providerConnectionCore.ts'

const provider: ModelProvider = {
  id: 'provider-42',
  label: 'Private endpoint',
  modelFamily: 'claude',
  effortLevels: ['High'],
}

test('a device key reaches HTTP only as its generated reference and binds after acknowledgement', async () => {
  const calls: unknown[][] = []
  const result = await replaceProviderConnectionCore(
    provider.id,
    { baseURL: 'https://models.example/v1', model: 'opus' },
    'raw-device-key',
    {
      async provision(secret) { calls.push(['provision', secret]); return `PROVIDER_DESKTOP_${'A'.repeat(32)}` },
      async update(id, patch) { calls.push(['update', id, patch]); return provider },
      async bind(reference, id) { calls.push(['bind', reference, id]) },
      async discard(reference) { calls.push(['discard', reference]) },
    },
  )
  assert.equal(result, provider)
  assert.deepEqual(calls, [
    ['provision', 'raw-device-key'],
    ['update', provider.id, {
      baseURL: 'https://models.example/v1',
      model: 'opus',
      apiKeyEnv: `PROVIDER_DESKTOP_${'A'.repeat(32)}`,
    }],
    ['bind', `PROVIDER_DESKTOP_${'A'.repeat(32)}`, provider.id],
  ])
  assert.equal(JSON.stringify(calls[1]).includes('raw-device-key'), false)
})

test('a rejected server replacement discards the provisional key and preserves the error', async () => {
  const calls: unknown[][] = []
  const refusal = new Error('probe refused')
  await assert.rejects(
    () => replaceProviderConnectionCore(provider.id, {}, 'replacement-key', {
      async provision() { calls.push(['provision']); return `PROVIDER_DESKTOP_${'B'.repeat(32)}` },
      async update() { calls.push(['update']); throw refusal },
      async bind() { calls.push(['bind']) },
      async discard(reference) { calls.push(['discard', reference]) },
    }),
    refusal,
  )
  assert.deepEqual(calls, [
    ['provision'],
    ['update'],
    ['discard', `PROVIDER_DESKTOP_${'B'.repeat(32)}`],
  ])
})

test('an interrupted post-ack binding stays successful for startup reconciliation', async () => {
  const calls: string[] = []
  const result = await replaceProviderConnectionCore(provider.id, {}, 'replacement-key', {
    async provision() { return `PROVIDER_DESKTOP_${'C'.repeat(32)}` },
    async update() { calls.push('ack'); return provider },
    async bind() { calls.push('bind-failed'); throw new Error('ipc interrupted') },
    async discard() { calls.push('discard') },
  })
  assert.equal(result, provider)
  assert.deepEqual(calls, ['ack', 'bind-failed'])
})
