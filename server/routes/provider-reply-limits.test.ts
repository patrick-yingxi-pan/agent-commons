import assert from 'node:assert/strict'
import { test } from 'node:test'
import { call } from '../testkit/http.ts'
import { store } from '../store/index.ts'

test('reply limits are private-config truth, revisioned, bounded and tenant scoped', async (t) => {
  const headers = { 'x-tenant-id': 'tenant-reply-limit-owner' }
  const created = await call('POST', '/providers', {
    label: 'Reply limit', modelFamily: 'custom', effortLevels: [],
    replyOutputTokens: 65536,
    config: { model: 'local-test', replyOutputTokens: 4096 },
  }, headers)
  assert.equal(created.status, 200)
  const id = created.json.id
  t.after(() => store.deleteProvider(id))
  assert.equal(created.json.replyOutputTokens, 4096, 'public caller annotations cannot forge the effective limit')
  assert.equal(store.getProvider(id).replyOutputTokens, undefined, 'read annotations do not persist on the provider row')
  assert.equal(store.providerConfig(id).replyOutputTokens, 4096)
  assert.equal((await call('GET', `/providers/${id}`, undefined, { 'x-tenant-id': 'foreign-reply-limit' })).status, 404)
  assert.equal((await call('PATCH', `/providers/${id}`, { replyOutputTokens: 16384 }, headers)).status, 400,
    'ordinary definition editing cannot alter connection limits')

  const changed = await call('PATCH', `/providers/${id}/connection`, { replyOutputTokens: 16384, expectedRevision: 0 }, headers)
  assert.equal(changed.status, 200)
  assert.equal(changed.json.replyOutputTokens, 16384)
  assert.equal(changed.json.connectionRevision, 1)
  assert.equal((await call('PATCH', `/providers/${id}/connection`, { replyOutputTokens: 128, expectedRevision: 0 }, headers)).status, 409)
  assert.equal(store.providerConfig(id).replyOutputTokens, 16384)

  for (const value of [127, 65537, 1.5, '8192', true]) {
    const refused = await call('PATCH', `/providers/${id}/connection`, { replyOutputTokens: value, expectedRevision: 1 }, headers)
    assert.equal(refused.status, 400, JSON.stringify(value))
    assert.equal(store.providerConfig(id).replyOutputTokens, 16384)
  }
  const unrelated = await call('PATCH', `/providers/${id}/connection`, { model: 'changed-id', expectedRevision: 1 }, headers)
  assert.equal(unrelated.status, 200)
  assert.equal(unrelated.json.replyOutputTokens, 16384, 'absent numeric patch preserves the current limit')
  const cleared = await call('PATCH', `/providers/${id}/connection`, { replyOutputTokens: null, expectedRevision: 2 }, headers)
  assert.equal(cleared.status, 200)
  assert.equal(cleared.json.replyOutputTokens, 1024, 'explicit null restores legacy protocol behavior')
  assert.equal(store.providerConfig(id).replyOutputTokens, undefined)
})

test('malformed reply limits cannot mint a provider or start an outbound conformance probe', async () => {
  const count = store.listProviders().length
  for (const replyOutputTokens of [null, 0, 127, 65537, 0.5, '8192', false]) {
    const result = await call('POST', '/providers', {
      label: 'Invalid reply limit', modelFamily: 'custom', effortLevels: [],
      config: { baseURL: 'http://127.0.0.1:1', model: 'unused', replyOutputTokens },
    })
    assert.equal(result.status, 400)
    assert.match(JSON.stringify(result.json), /replyOutputTokens/)
    assert.equal(store.listProviders().length, count)
  }
})
