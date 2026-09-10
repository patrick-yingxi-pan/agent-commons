import test from 'node:test'
import assert from 'node:assert/strict'
import type { Identity, ModelProvider } from '../../contract/index.ts'
import { refreshAccount } from './account.ts'
import { peek, resetAll, setData } from './cache.ts'
import { keys } from './keys.ts'
import { AccountSwitchedError } from './client.ts'
import { providerCreationId } from './providerCreationIdentity.ts'
import { captureProviderCreationSource } from './providerCreationRevision.ts'
import { applyProviderCreation, clearProviderCreationResults, reconcileProviderCreation, takeProviderCreationResult } from './providerCreationCommands.ts'

function select(userId = 'ada') {
  refreshAccount({ userId, tenantId: 'tenant-a' })
  resetAll()
  const identity: Identity = {
    user: { id: userId, name: userId }, tenant: { id: 'tenant-a', name: 'A', kind: 'org' },
    role: 'member', local: false, via: 'session',
  }
  setData(keys.me, identity)
  setData(keys.providers, [])
}
const intent = () => ({
  ...captureProviderCreationSource('tenant-a'), intentId: 'test-logical-key',
  request: { label: 'Test relay', kind: 'session' as const, modelFamily: 'claude', effortLevels: ['High'] },
})
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'x-resolved-tenant': 'tenant-a' } })
const cleanup = () => { refreshAccount(null); resetAll(); clearProviderCreationResults() }

test('registration and same-key secret recovery pin the initiating browser account', async () => {
  const fetch = globalThis.fetch
  try {
    select()
    const input = intent()
    const provider = { id: await providerCreationId(input.tenantId, input.intentId), label: input.request.label, kind: 'session' }
    const headers: Headers[] = []
    globalThis.fetch = async (_url, options) => {
      assert.equal(new Headers(options?.headers).get('X-Account-Transition-Source'), 'session:ada',
        'recovery reads carry the same frozen source as provider writes')
      if (options?.method === 'GET') return json([provider])
      headers.push(new Headers(options?.headers))
      return json({ ...provider, secret: 'test-only-relay-secret' })
    }
    await applyProviderCreation(input, input.intentId)
    assert.equal(await reconcileProviderCreation(input, input.intentId), true)
    assert.equal(headers.length, 2)
    for (const header of headers) {
      assert.equal(header.get('X-Account-Transition-Source'), 'session:ada')
      assert.equal(header.get('Idempotency-Key'), input.intentId)
    }
    assert.equal(takeProviderCreationResult(input.intentId)?.secret, 'test-only-relay-secret')
    assert.equal(JSON.stringify(peek(keys.providers)).includes('test-only-relay-secret'), false)
  } finally { globalThis.fetch = fetch; cleanup() }
})

test('an obsolete activation cannot issue either provider writes or reconciliation reads', async () => {
  const fetch = globalThis.fetch
  try {
    select()
    const input = intent()
    select('grace')
    let calls = 0
    globalThis.fetch = async () => { calls += 1; return json([]) }
    await assert.rejects(() => applyProviderCreation(input, input.intentId), AccountSwitchedError)
    await assert.rejects(() => reconcileProviderCreation(input, input.intentId), AccountSwitchedError)
    assert.equal(calls, 0)
  } finally { globalThis.fetch = fetch; cleanup() }
})

test('a provider acknowledgement must name the exact frozen tenant and logical key', async () => {
  const fetch = globalThis.fetch
  try {
    select()
    const input = intent()
    globalThis.fetch = async () => json({ id: 'provider-unrelated', label: input.request.label })
    await assert.rejects(() => applyProviderCreation(input, input.intentId), /Unexpected provider creation identity/)
    assert.deepEqual(peek<ModelProvider[]>(keys.providers), [])
    assert.equal(takeProviderCreationResult(input.intentId), undefined)
  } finally { globalThis.fetch = fetch; cleanup() }
})
