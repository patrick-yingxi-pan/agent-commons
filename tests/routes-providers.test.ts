/** Provider CRUD on the wire (docs/agent-commons.md, D9) — the Agents hub's create /
 *  patch / delete. POST validates the plan against the account plan (the cascade root,
 *  D8); DELETE refuses the protected default and any provider an Agent still binds (409).
 *  The in-memory store is shared across the run, so each case uses its own labels and
 *  only deletes what it created (never the default, which other tests resolve to). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../server/store.ts'
import { DEFAULT_PROVIDER_ID } from '../server/data/providers.ts'
import { call } from './helpers/http.ts'

test('POST creates a provider; GET lists it; PATCH edits its fields', async () => {
  const created = await call('POST', '/providers', {
    label: 'Wire provider',
    modelFamily: 'open',
    effortLevels: ['Low', 'High'],
  })
  assert.equal(created.status, 200)
  assert.ok(created.json.id.startsWith('provider-'))
  assert.equal(created.json.modelFamily, 'open')

  const one = await call('GET', `/providers/${created.json.id}`)
  assert.equal(one.status, 200)
  assert.equal(one.json.label, 'Wire provider')

  const patched = await call('PATCH', `/providers/${created.json.id}`, {
    label: 'Renamed',
    modelFamily: 'claude',
  })
  assert.equal(patched.status, 200)
  assert.equal(patched.json.label, 'Renamed')
  assert.equal(patched.json.modelFamily, 'claude')
  // The patch is a real merge — the untouched effort levels survive.
  assert.deepEqual(patched.json.effortLevels, ['Low', 'High'])
})

test('POST without required fields is a 400; PATCH of an unknown id is a 404', async () => {
  const bad = await call('POST', '/providers', { label: 'No family' })
  assert.equal(bad.status, 400)
  assert.equal(bad.json.error.code, 'bad_request')

  const missing = await call('PATCH', '/providers/no-such-provider', { label: 'x' })
  assert.equal(missing.status, 404)
  assert.equal(missing.json.error.code, 'not_found')
})

test('POST with an over-account plan is a 400 (the D8 cascade root)', async () => {
  const over = await call('POST', '/providers', {
    label: 'Greedy tier',
    modelFamily: 'claude',
    effortLevels: ['High'],
    plan: { windows: [{ label: '5-hour limit', ceiling: 99_000_000 }] },
  })
  assert.equal(over.status, 400)
  assert.equal(over.json.error.code, 'bad_request')
})

test('DELETE removes an unbound provider; a second DELETE 404s', async () => {
  const created = await call('POST', '/providers', {
    label: 'Disposable',
    modelFamily: 'claude',
    effortLevels: ['Low'],
  })
  const del = await call('DELETE', `/providers/${created.json.id}`)
  assert.equal(del.status, 200)
  assert.deepEqual(del.json, { ok: true })

  const again = await call('DELETE', `/providers/${created.json.id}`)
  assert.equal(again.status, 404)
})

test('DELETE refuses the default provider (409 — sessions resolve to it)', async () => {
  const del = await call('DELETE', `/providers/${DEFAULT_PROVIDER_ID}`)
  assert.equal(del.status, 409)
  assert.equal(del.json.error.code, 'conflict')
})

test('DELETE refuses a provider an Agent still binds (409)', async () => {
  const provider = store.createProvider({ label: 'Bound', modelFamily: 'claude', effortLevels: ['Low'] })
  store.createAgent({
    label: 'Binder',
    systemPrompt: 'p',
    tools: [],
    instructions: '',
    providerId: provider.id,
  })
  const blocked = await call('DELETE', `/providers/${provider.id}`)
  assert.equal(blocked.status, 409)
  assert.equal(blocked.json.error.code, 'conflict')
})
