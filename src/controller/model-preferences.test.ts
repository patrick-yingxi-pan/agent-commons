import test from 'node:test'
import assert from 'node:assert/strict'
import { updateModelPreferences, retryModelPreference } from './modelPreferences.ts'
import { keys } from '../api/keys.ts'
import { peek, resetAll, setData } from '../api/cache.ts'
import { refreshAccount } from '../api/account.ts'
import type { Identity, ViewerModelPreferences } from '../../contract/index.ts'

const identity: Identity = { user: { id: 'ada', name: 'Ada' }, tenant: { id: 'acme', name: 'Acme', kind: 'org' }, role: 'member', local: false, via: 'session' }
const record: ViewerModelPreferences = { userId: 'ada', tenantId: 'acme', revision: 1, preferences: { providerId: 'provider-a', effort: 'High', fast: false, ultracode: false } }
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'x-resolved-tenant': 'acme' } })
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
const seed = () => {
  refreshAccount({ userId: 'ada', tenantId: 'acme' })
  setData(keys.me, identity)
  setData(keys.modelPreferences('ada', 'acme'), record)
}

test('the preference hold coalesces only identical intent, never another setup completion', async () => {
  const fetch = globalThis.fetch
  let release!: () => void
  try {
    seed()
    globalThis.fetch = async (_url, options) => {
      const body = JSON.parse(options!.body as string)
      return new Promise<Response>((resolve) => { release = () => resolve(json({ ...record, revision: 2, preferences: body.preferences })) })
    }
    const first = updateModelPreferences({ effort: 'Low' })
    assert.equal(updateModelPreferences({ effort: 'Low' }), first)
    assert.equal(await updateModelPreferences({ providerId: 'new-provider', modelId: undefined }), 'discarded')
    await tick()
    release()
    assert.equal(await first, 'applied')
    assert.equal(peek<ViewerModelPreferences>(keys.modelPreferences('ada', 'acme'))?.preferences.providerId, 'provider-a')
  } finally { globalThis.fetch = fetch; refreshAccount(null); resetAll() }
})

test('explicit Retry rebases sparse intent and keeps its key after conflict', async () => {
  const fetch = globalThis.fetch
  const calls: { key: string | null; body: any }[] = []
  try {
    seed()
    const newer = { ...record, revision: 2, preferences: { ...record.preferences, fast: true } }
    globalThis.fetch = async (_url, options) => {
      if (options?.method === 'GET') return json(newer)
      const body = JSON.parse(options!.body as string)
      calls.push({ key: new Headers(options!.headers).get('Idempotency-Key'), body })
      if (calls.length === 1) return json({ error: { code: 'conflict', message: 'changed elsewhere' } }, 409)
      return json({ ...newer, revision: 3, preferences: body.preferences })
    }
    const outcome = updateModelPreferences({ effort: 'Low' })
    await tick()
    assert.equal(calls.length, 1, 'no automatic conflict replay')
    retryModelPreference()
    assert.equal(await outcome, 'applied')
    assert.equal(calls.length, 2)
    assert.equal(calls[0].key, calls[1].key)
    assert.equal(calls[1].body.expectedRevision, 2)
    assert.deepEqual(calls[1].body.preferences, { ...newer.preferences, effort: 'Low' })
  } finally { globalThis.fetch = fetch; refreshAccount(null); resetAll() }
})

test('account switching discards old preference completion without publishing it', async () => {
  const fetch = globalThis.fetch
  let release!: () => void
  try {
    seed()
    globalThis.fetch = async () => new Promise<Response>((resolve) => { release = () => resolve(json({ ...record, revision: 2 })) })
    const outcome = updateModelPreferences({ effort: 'Low' })
    await tick()
    refreshAccount({ userId: 'grace', tenantId: 'acme' })
    resetAll()
    assert.equal(await outcome, 'discarded')
    release()
    await tick()
    assert.equal(peek(keys.modelPreferences('ada', 'acme')), undefined)
  } finally { globalThis.fetch = fetch; refreshAccount(null); resetAll() }
})
