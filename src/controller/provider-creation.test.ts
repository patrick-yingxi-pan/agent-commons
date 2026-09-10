import test from 'node:test'
import assert from 'node:assert/strict'
import type { Identity } from '../../contract/index.ts'
import { refreshAccount } from '../api/account.ts'
import { keys } from '../api/keys.ts'
import { resetAll, setData } from '../api/cache.ts'
import { enqueueProviderCreation, retryProviderCreation } from './providerCreationMutations.ts'

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
const reference = `PROVIDER_DESKTOP_${'A'.repeat(32)}`
const identity = (userId: string): Identity => ({
  user: { id: userId, name: userId }, tenant: { id: 'tenant-a', name: 'A', kind: 'org' },
  role: 'member', local: false, via: 'session',
})
function select(userId: string) {
  refreshAccount({ userId, tenantId: 'tenant-a' })
  resetAll()
  setData(keys.me, identity(userId))
}

test('switching account during native provisioning never submits the abandoned provider', { timeout: 5_000 }, async () => {
  const savedFetch = globalThis.fetch
  const savedWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const requests: string[] = []
  const discarded: string[] = []
  let release!: (value: string) => void
  let settled!: () => void
  const resumed = new Promise<void>((resolve) => { settled = resolve })
  try {
    select('ada')
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { agentCommonsDesktop: { credentials: {
      provision: async () => new Promise<string>((resolve) => { release = resolve }),
      bind: async () => assert.fail('an abandoned provider cannot bind a key'),
      discard: async (value: string) => { discarded.push(value); settled() },
    } } } })
    globalThis.fetch = async (_url, options) => {
      requests.push(String(options?.method))
      settled()
      return new Response(JSON.stringify({ id: 'wrong-provider', label: 'Must not be sent', kind: 'endpoint' }), {
        headers: { 'x-resolved-tenant': 'tenant-a' },
      })
    }
    const outcome = enqueueProviderCreation({
      tenantId: 'tenant-a', deviceSecret: 'test-only-secret',
      request: { label: 'Must not be sent', modelFamily: 'claude', effortLevels: ['High'] },
    })
    await tick()
    assert.equal(typeof release, 'function', 'the native wait is actually pending')
    select('grace')
    assert.equal((await outcome).outcome, 'discarded')
    release(reference)
    await resumed
    assert.deepEqual(requests, [], 'resuming old intent cannot POST under the newly selected account')
    assert.deepEqual(discarded, [reference], 'only the exact never-submitted provisional key can be discarded')
  } finally {
    globalThis.fetch = savedFetch
    if (savedWindow) Object.defineProperty(globalThis, 'window', savedWindow)
    else Reflect.deleteProperty(globalThis, 'window')
    refreshAccount(null)
    resetAll()
  }
})

test('switching after submission preserves the uncertain key without binding or publishing it', { timeout: 5_000 }, async () => {
  const savedFetch = globalThis.fetch
  const savedWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const effects: string[] = []
  let release!: () => void
  let submitted!: () => void
  const started = new Promise<void>((resolve) => { submitted = resolve })
  try {
    select('ada')
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { agentCommonsDesktop: { credentials: {
      provision: async () => reference,
      bind: async () => { effects.push('bind') },
      discard: async () => { effects.push('discard') },
    } } } })
    globalThis.fetch = async (_url, options) => {
      effects.push(String(options?.method))
      assert.equal(new Headers(options?.headers).get('X-Account-Transition-Source'), 'session:ada')
      assert.equal(JSON.parse(String(options?.body)).config.apiKeyEnv, reference)
      return new Promise<Response>((resolve) => {
        release = () => resolve(new Response(JSON.stringify({ id: 'late-provider' }), {
          headers: { 'x-resolved-tenant': 'tenant-a' },
        }))
        submitted()
      })
    }
    const outcome = enqueueProviderCreation({
      tenantId: 'tenant-a', deviceSecret: 'test-only-secret',
      request: { label: 'Uncertain provider', modelFamily: 'claude', effortLevels: ['High'] },
    })
    await started
    assert.equal(typeof release, 'function', 'the provider request has actually started')
    select('grace')
    assert.equal((await outcome).outcome, 'discarded')
    release()
    await tick()
    await tick()
    assert.deepEqual(effects, ['POST'], 'uncertain submitted keys remain available to startup reconciliation')
  } finally {
    globalThis.fetch = savedFetch
    if (savedWindow) Object.defineProperty(globalThis, 'window', savedWindow)
    else Reflect.deleteProperty(globalThis, 'window')
    refreshAccount(null)
    resetAll()
  }
})

test('a refused retry cannot discard a key that an earlier uncertain submission may use', { timeout: 5_000 }, async () => {
  const savedFetch = globalThis.fetch
  const savedWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const effects: string[] = []
  const reached: Array<() => void> = []
  const reads = [0, 1].map(() => new Promise<void>((resolve) => { reached.push(resolve) }))
  let writes = 0
  let readCount = 0
  try {
    select('ada')
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { agentCommonsDesktop: { credentials: {
      provision: async () => reference,
      bind: async () => { effects.push('bind') },
      discard: async () => { effects.push('discard') },
    } } } })
    globalThis.fetch = async (_url, options) => {
      if (options?.method === 'POST') writes += 1
      else reached[readCount++]?.()
      return new Response(JSON.stringify({ error: {
        code: writes === 1 ? 'internal' : 'conflict',
        message: writes === 1 ? 'Acknowledgement lost after a possible commit.' : 'The session cookie changed.',
      } }), { status: writes === 1 ? 503 : 409 })
    }
    const outcome = enqueueProviderCreation({
      tenantId: 'tenant-a', deviceSecret: 'test-only-secret',
      request: { label: 'Possibly committed provider', modelFamily: 'claude', effortLevels: ['High'] },
    })
    await reads[0]
    await tick()
    retryProviderCreation()
    await reads[1]
    await tick()
    assert.equal(writes, 2)
    assert.deepEqual(effects, [], 'a later refusal says nothing about the first request’s commit')
    select('grace')
    assert.equal((await outcome).outcome, 'discarded')
  } finally {
    globalThis.fetch = savedFetch
    if (savedWindow) Object.defineProperty(globalThis, 'window', savedWindow)
    else Reflect.deleteProperty(globalThis, 'window')
    refreshAccount(null)
    resetAll()
  }
})
