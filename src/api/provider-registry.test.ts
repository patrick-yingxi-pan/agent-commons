import test from 'node:test'
import assert from 'node:assert/strict'
import type { Identity, ModelProvider } from '../../contract/index.ts'
import { refreshAccount } from './account.ts'
import { peek, resetAll, setData } from './cache.ts'
import { keys } from './keys.ts'
import { fetchProviderRegistry } from './providerRegistry.ts'

const oldIdentity: Identity = {
  user: { id: 'user-ada', name: 'Ada' },
  tenant: { id: 'tenant-ada', name: 'Acme', kind: 'org' },
  role: 'member', local: false, via: 'session',
}
const oldProviders: ModelProvider[] = [{
  id: 'provider-old', label: 'Ada provider', kind: 'endpoint', modelFamily: 'claude', effortLevels: ['High'],
}]

test('provider registry revalidation fences cookie-only drift before replacing cached tenant truth', async () => {
  const savedFetch = globalThis.fetch
  try {
    // Simulate a reload: the resolved /me identity remains cached, but the
    // client has no selected account/generation to use as an echo fence.
    refreshAccount(null)
    resetAll()
    setData(keys.me, oldIdentity)
    setData(keys.providers, oldProviders)
    let source: string | null = null
    globalThis.fetch = async (_url, options) => {
      source = new Headers(options?.headers).get('X-Account-Transition-Source')
      if (source === 'session:user-ada') {
        return new Response(JSON.stringify({ error: { code: 'conflict', message: 'The current account changed before this action arrived.' } }), {
          status: 409,
          headers: { 'x-resolved-tenant': 'tenant-maya' },
        })
      }
      // The pre-fix unguarded fetch would accept this cookie-selected tenant.
      return new Response(JSON.stringify([{ id: 'provider-maya', label: 'Maya provider', kind: 'endpoint', modelFamily: 'claude', effortLevels: ['High'] }]), {
        headers: { 'x-resolved-tenant': 'tenant-maya' },
      })
    }

    await assert.rejects(() => fetchProviderRegistry(), /current account changed/)
    assert.equal(source, 'session:user-ada')
    assert.deepEqual(peek<ModelProvider[]>(keys.providers), oldProviders)
  } finally {
    globalThis.fetch = savedFetch
    refreshAccount(null)
    resetAll()
  }
})
