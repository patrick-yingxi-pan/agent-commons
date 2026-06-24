/** Integration tests for the session↔context binding — the attachment of record
 *  (Primitive 1 of docs/shared-resource-coordination.md) — through the real
 *  router + store. The store is the singleton the router uses, so a `call` that
 *  attaches is visible to a direct `store.resolveSessionContext` read. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { call } from './helpers/http.ts'
import { store } from '../server/store.ts'

test('a seeded session lists its attached contexts', async () => {
  const { status, json } = await call('GET', '/sessions/insights-launch/contexts')
  assert.equal(status, 200)
  assert.ok(Array.isArray(json))
  assert.ok(json.some((c: any) => c.id === 'repo-insights'))
})

test('a session with no bindings lists an empty array', async () => {
  const { status, json } = await call('GET', '/sessions/nope-no-binding/contexts')
  assert.equal(status, 200)
  assert.deepEqual(json, [])
})

test('attach returns the new list and defaults scope to *', async () => {
  const { status, json } = await call('POST', '/sessions/sc-1/contexts', {
    id: 'c-a',
    type: 'folder',
    label: 'Folder A',
  })
  assert.equal(status, 200)
  assert.equal(json.length, 1)
  assert.equal(json[0].id, 'c-a')
  assert.equal(json[0].scope, '*')
})

test('attach is idempotent by id — re-attaching replaces, not duplicates', async () => {
  await call('POST', '/sessions/sc-2/contexts', { id: 'c-b', type: 'repo', label: 'R', scope: '~/a' })
  const { json } = await call('POST', '/sessions/sc-2/contexts', {
    id: 'c-b',
    type: 'repo',
    label: 'R2',
    scope: '~/b',
  })
  assert.equal(json.length, 1)
  assert.equal(json[0].label, 'R2')
  assert.equal(json[0].scope, '~/b')
})

test('attach without id/type/label is 400 bad_request', async () => {
  const { status, json } = await call('POST', '/sessions/sc-3/contexts', { type: 'folder' })
  assert.equal(status, 400)
  assert.equal(json.error.code, 'bad_request')
})

test('detach removes the context and returns the new list', async () => {
  await call('POST', '/sessions/sc-4/contexts', { id: 'c-c', type: 'folder', label: 'C', scope: '*' })
  const { status, json } = await call('DELETE', '/sessions/sc-4/contexts/c-c')
  assert.equal(status, 200)
  assert.deepEqual(json, [])
})

test('detach an unattached context is 404 not_found', async () => {
  const { status, json } = await call('DELETE', '/sessions/sc-5/contexts/ghost')
  assert.equal(status, 404)
  assert.equal(json.error.code, 'not_found')
})

test('resolveSessionContext finds an attached context (the mediation lookup)', async () => {
  await call('POST', '/sessions/sc-6/contexts', { id: 'c-d', type: 'repo', label: 'D', scope: '~/d' })
  const ctx = store.resolveSessionContext('sc-6', 'c-d')
  assert.equal(ctx?.scope, '~/d')
  assert.equal(store.resolveSessionContext('sc-6', 'absent'), undefined)
})
