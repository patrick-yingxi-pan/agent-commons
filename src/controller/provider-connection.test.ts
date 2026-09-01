import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ModelProvider } from '../../contract/index.ts'
import {
  createProviderConnectionAttempt,
  replaceProviderConnectionCore,
} from './providerConnectionCore.ts'

const provider: ModelProvider = {
  id: 'provider-42',
  label: 'Private endpoint',
  modelFamily: 'claude',
  effortLevels: ['High'],
}

test('a device key reaches HTTP only as its generated reference and binds after acknowledgement', async () => {
  const calls: unknown[][] = []
  const attempt = createProviderConnectionAttempt(
    { baseURL: 'https://models.example/v1', model: 'opus' },
    3,
    'raw-device-key',
    'connection-1',
  )
  const result = await replaceProviderConnectionCore(
    provider.id,
    attempt,
    {
      async provision(secret) { calls.push(['provision', secret]); return `PROVIDER_DESKTOP_${'A'.repeat(32)}` },
      async update(id, patch, key) { calls.push(['update', id, patch, key]); return provider },
      async bind(reference, id) { calls.push(['bind', reference, id]) },
      async discard(reference) { calls.push(['discard', reference]) },
      definitiveFailure: () => false,
    },
  )
  assert.equal(result, provider)
  assert.deepEqual(calls, [
    ['provision', 'raw-device-key'],
    ['update', provider.id, {
      baseURL: 'https://models.example/v1',
      model: 'opus',
      apiKeyEnv: `PROVIDER_DESKTOP_${'A'.repeat(32)}`,
      expectedRevision: 3,
    }, 'connection-1'],
    ['bind', `PROVIDER_DESKTOP_${'A'.repeat(32)}`, provider.id],
  ])
  assert.equal(JSON.stringify(calls[1]).includes('raw-device-key'), false)
  assert.equal(attempt.deviceSecret, undefined, 'the raw key is released after vault provisioning')
})

test('a rejected server replacement discards the provisional key and preserves the error', async () => {
  const calls: unknown[][] = []
  const refusal = new Error('probe refused')
  const attempt = createProviderConnectionAttempt({}, 0, 'replacement-key', 'connection-2')
  await assert.rejects(
    () => replaceProviderConnectionCore(provider.id, attempt, {
      async provision() { calls.push(['provision']); return `PROVIDER_DESKTOP_${'B'.repeat(32)}` },
      async update() { calls.push(['update']); throw refusal },
      async bind() { calls.push(['bind']) },
      async discard(reference) { calls.push(['discard', reference]) },
      definitiveFailure: () => true,
    }),
    refusal,
  )
  assert.deepEqual(calls, [
    ['provision'],
    ['update'],
    ['discard', `PROVIDER_DESKTOP_${'B'.repeat(32)}`],
  ])
  assert.equal(attempt.reference, undefined)
  assert.equal(attempt.uncertain, false)
})

test('an uncertain acknowledgement reuses the exact key and provisioned reference on Retry', async () => {
  const calls: unknown[][] = []
  let updates = 0
  const attempt = createProviderConnectionAttempt({ model: 'opus' }, 7, 'replacement-key', 'connection-3')
  const dependencies = {
    async provision() { calls.push(['provision']); return `PROVIDER_DESKTOP_${'C'.repeat(32)}` },
    async update(id: string, patch: unknown, key: string) {
      calls.push(['update', id, patch, key])
      updates += 1
      if (updates === 1) throw new Error('socket closed')
      return { ...provider, connectionRevision: 8 }
    },
    async bind(reference: string, id: string) { calls.push(['bind', reference, id]) },
    async discard(reference: string) { calls.push(['discard', reference]) },
    definitiveFailure: () => false,
  }

  await assert.rejects(() => replaceProviderConnectionCore(provider.id, attempt, dependencies), /socket closed/)
  assert.equal(attempt.uncertain, true)
  assert.equal(calls.filter(([name]) => name === 'provision').length, 1)
  assert.equal(calls.some(([name]) => name === 'discard'), false)

  const result = await replaceProviderConnectionCore(provider.id, attempt, dependencies)
  assert.equal(result.connectionRevision, 8)
  assert.equal(attempt.uncertain, false)
  const updateCalls = calls.filter(([name]) => name === 'update')
  assert.equal(updateCalls.length, 2)
  assert.deepEqual(updateCalls[0], updateCalls[1], 'Retry retransmits the same body, reference, and logical key')
  assert.deepEqual(calls.at(-1), ['bind', `PROVIDER_DESKTOP_${'C'.repeat(32)}`, provider.id])
})

test('an interrupted post-ack binding stays successful for startup reconciliation', async () => {
  const calls: string[] = []
  const attempt = createProviderConnectionAttempt({}, 0, 'replacement-key', 'connection-4')
  const result = await replaceProviderConnectionCore(provider.id, attempt, {
    async provision() { return `PROVIDER_DESKTOP_${'D'.repeat(32)}` },
    async update() { calls.push('ack'); return provider },
    async bind() { calls.push('bind-failed'); throw new Error('ipc interrupted') },
    async discard() { calls.push('discard') },
    definitiveFailure: () => false,
  })
  assert.equal(result, provider)
  assert.deepEqual(calls, ['ack', 'bind-failed'])
})
