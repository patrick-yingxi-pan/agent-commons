import test from 'node:test'
import assert from 'node:assert/strict'
import type { Identity, ViewerModelPreferences } from '../../contract/index.ts'
import { keys } from './keys.ts'
import { peek, resetAll, setData } from './cache.ts'
import { accountGeneration, refreshAccount } from './account.ts'
import { AccountSwitchedError } from './client.ts'
import { assertModelPreferenceScope, readModelPreferences } from './modelPreferences.ts'
import {
  acceptModelPreferences,
  assertModelPreferenceMutationSource,
  modelPreferenceMutationResourceId,
  patchModelPreferences,
} from './modelPreferenceCommands.ts'

const identity: Identity = { user: { id: 'ada', name: 'Ada' }, tenant: { id: 'acme', name: 'Acme', kind: 'org' }, role: 'member', local: false, via: 'session' }
const initial: ViewerModelPreferences = { userId: 'ada', tenantId: 'acme', revision: 3, preferences: { providerId: 'provider-a', modelId: 'model-a', effort: 'High', fast: false, ultracode: true } }
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', 'x-resolved-tenant': 'acme' } })
const resourceId = () => modelPreferenceMutationResourceId({ tenantId: 'acme', userId: 'ada', accountGeneration: accountGeneration() })

test('personal preference hydration refuses another user even within the same tenant', async () => {
  assert.throws(() => assertModelPreferenceScope({ ...initial, userId: 'grace' }, identity), AccountSwitchedError)
  assert.throws(() => assertModelPreferenceScope({ ...initial, tenantId: 'other' }, identity), AccountSwitchedError)
  const fetch = globalThis.fetch
  try {
    globalThis.fetch = async () => json({ ...initial, userId: 'grace' })
    await assert.rejects(readModelPreferences(identity), AccountSwitchedError)
    globalThis.fetch = async () => json({ ...initial, tenantId: 'other' })
    await assert.rejects(readModelPreferences(identity), AccountSwitchedError)
  } finally { globalThis.fetch = fetch }
})

test('late preference acknowledgements never rewind a newer same-viewer record', () => {
  resetAll()
  setData(keys.modelPreferences('ada', 'acme'), { ...initial, revision: 8 })
  assert.equal(acceptModelPreferences(initial).revision, 8)
  assert.equal(peek<ViewerModelPreferences>(keys.modelPreferences('ada', 'acme'))?.revision, 8)
  resetAll()
})

test('a sparse preference write pins both identities and preserves orthogonal choices', async () => {
  const fetch = globalThis.fetch
  const calls: { method: string; body: any; key: string | null }[] = []
  try {
    refreshAccount({ userId: 'ada', tenantId: 'acme' })
    setData(keys.me, identity)
    setData(keys.modelPreferences('ada', 'acme'), initial)
    globalThis.fetch = async (_url, options) => {
      const body = JSON.parse(options!.body as string)
      calls.push({ method: options!.method!, body, key: new Headers(options!.headers).get('Idempotency-Key') })
      return json({ ...initial, revision: 4, preferences: body.preferences })
    }
    await patchModelPreferences(resourceId(), { providerId: 'provider-b', modelId: undefined }, 3, 'stable-key')
    assert.deepEqual(calls, [{ method: 'PATCH', key: 'stable-key', body: {
      expectedUserId: 'ada', expectedTenantId: 'acme', expectedRevision: 3,
      preferences: { providerId: 'provider-b', effort: 'High', ultracode: true, fast: false },
    } }])
    assert.equal(peek<ViewerModelPreferences>(keys.modelPreferences('ada', 'acme'))?.revision, 4)
  } finally { globalThis.fetch = fetch; resetAll(); refreshAccount(null) }
})

test('post-commit response loss reconciles the exact preference without another write', async () => {
  const fetch = globalThis.fetch
  let writes = 0
  let reads = 0
  try {
    refreshAccount({ userId: 'ada', tenantId: 'acme' })
    setData(keys.me, identity)
    setData(keys.modelPreferences('ada', 'acme'), initial)
    globalThis.fetch = async (_url, options) => {
      if (options?.method === 'PATCH') { writes++; throw new TypeError('response lost') }
      reads++
      return json({ ...initial, revision: 4, preferences: { ...initial.preferences, effort: 'Low' } })
    }
    const saved = await patchModelPreferences(resourceId(), { effort: 'Low' }, 3, 'one-change')
    assert.equal(saved.preferences.effort, 'Low')
    assert.equal(writes, 1)
    assert.equal(reads, 1)
  } finally { globalThis.fetch = fetch; resetAll(); refreshAccount(null) }
})

test('a different newer preference never proves a lost write applied', async () => {
  const fetch = globalThis.fetch
  try {
    refreshAccount({ userId: 'ada', tenantId: 'acme' })
    setData(keys.me, identity)
    setData(keys.modelPreferences('ada', 'acme'), initial)
    globalThis.fetch = async (_url, options) => options?.method === 'PATCH'
      ? json({ error: { code: 'internal', message: 'uncertain' } }, 500)
      : json({ ...initial, revision: 4, preferences: { ...initial.preferences, effort: 'Medium' } })
    await assert.rejects(patchModelPreferences(resourceId(), { effort: 'Low' }, 3, 'uncertain'), /uncertain/)
    assert.equal(peek<ViewerModelPreferences>(keys.modelPreferences('ada', 'acme'))?.preferences.effort, 'Medium')
  } finally { globalThis.fetch = fetch; resetAll(); refreshAccount(null) }
})

test('an account switch fences both the response and its preference publication', async () => {
  const fetch = globalThis.fetch
  let release!: () => void
  try {
    refreshAccount({ userId: 'ada', tenantId: 'acme' })
    setData(keys.me, identity)
    setData(keys.modelPreferences('ada', 'acme'), initial)
    globalThis.fetch = async () => ({
      status: 200, ok: true, headers: new Headers({ 'x-resolved-tenant': 'acme' }),
      text: () => new Promise<string>((resolve) => { release = () => resolve(JSON.stringify({ ...initial, revision: 4 })) }),
    }) as Response
    const write = patchModelPreferences(resourceId(), { effort: 'Low' }, 3, 'old-viewer')
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    refreshAccount({ userId: 'grace', tenantId: 'acme' })
    resetAll()
    release()
    await assert.rejects(write, AccountSwitchedError)
    assert.equal(peek(keys.modelPreferences('ada', 'acme')), undefined)
  } finally { globalThis.fetch = fetch; resetAll(); refreshAccount(null) }
})

test('a frozen source is refused before any delayed write can issue', async () => {
  const fetch = globalThis.fetch
  let calls = 0
  try {
    refreshAccount({ userId: 'ada', tenantId: 'acme' })
    setData(keys.me, identity)
    setData(keys.modelPreferences('ada', 'acme'), initial)
    const stale = resourceId()
    refreshAccount({ userId: 'grace', tenantId: 'acme' })
    setData(keys.me, { ...identity, user: { id: 'grace', name: 'Grace' } })
    globalThis.fetch = async () => { calls++; return json(initial) }
    assert.throws(() => assertModelPreferenceMutationSource({ tenantId: 'acme', userId: 'ada', accountGeneration: accountGeneration() - 1 }), AccountSwitchedError)
    await assert.rejects(patchModelPreferences(stale, { effort: 'Low' }, 3, 'stale'), AccountSwitchedError)
    assert.equal(calls, 0)
  } finally { globalThis.fetch = fetch; resetAll(); refreshAccount(null) }
})

test('a same-tenant cookie drift is promoted from CAS conflict to account recovery', async () => {
  const fetch = globalThis.fetch
  const methods: string[] = []
  try {
    refreshAccount({ userId: 'ada', tenantId: 'acme' })
    setData(keys.me, identity)
    setData(keys.modelPreferences('ada', 'acme'), initial)
    globalThis.fetch = async (_url, options) => {
      methods.push(options?.method ?? 'GET')
      return options?.method === 'PATCH'
        ? json({ error: { code: 'conflict', message: 'scope changed' } }, 409)
        : json({ ...initial, userId: 'grace' })
    }
    await assert.rejects(patchModelPreferences(resourceId(), { effort: 'Low' }, 3, 'drifted'), AccountSwitchedError)
    assert.deepEqual(methods, ['PATCH', 'GET'])
  } finally { globalThis.fetch = fetch; resetAll(); refreshAccount(null) }
})

test('Retry accepts exact newer desired state after an earlier lost acknowledgement', async () => {
  const fetch = globalThis.fetch
  const methods: string[] = []
  try {
    refreshAccount({ userId: 'ada', tenantId: 'acme' })
    setData(keys.me, identity)
    setData(keys.modelPreferences('ada', 'acme'), initial)
    globalThis.fetch = async (_url, options) => {
      methods.push(options?.method ?? 'GET')
      return options?.method === 'PATCH'
        ? json({ error: { code: 'conflict', message: 'already advanced' } }, 409)
        : json({ ...initial, revision: 4, preferences: { ...initial.preferences, effort: 'Low' } })
    }
    const represented = await patchModelPreferences(resourceId(), { effort: 'Low' }, 3, 'lost-ack')
    assert.equal(represented.revision, 4)
    assert.equal(represented.preferences.effort, 'Low')
    assert.deepEqual(methods, ['PATCH', 'GET'])
  } finally { globalThis.fetch = fetch; resetAll(); refreshAccount(null) }
})
