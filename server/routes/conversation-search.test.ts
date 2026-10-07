import { test } from 'node:test'
import assert from 'node:assert/strict'
import { call } from '../testkit/http.ts'
import { store } from '../store/index.ts'
import { buildRouter } from './index.ts'
import { catalogOf } from '../apiSurface.ts'

test('conversation search uses the ordinary session read wall, including view grants', async () => {
  const owner = store.createSession('Search fixture', store.defaultTenantId())
  store.appendMessage(owner.id, { id: 'search-user', role: 'user', content: 'A needle in the user turn' })
  store.appendMessage(owner.id, { id: 'search-assistant', role: 'assistant', content: 'A NEEDLE in the answer' })

  const own = await call('GET', `/sessions/${owner.id}/search?q=NEEDLE`)
  assert.equal(own.status, 200)
  assert.deepEqual(own.json.hits.map((hit: any) => hit.messageId), ['search-user', 'search-assistant'])
  assert.equal(own.json.query, 'needle')

  const hidden = await call('GET', `/sessions/${owner.id}/search?q=needle`, undefined, { 'x-tenant-id': 'tenant-search-outsider' })
  assert.equal(hidden.status, 404, 'foreign session existence remains hidden')
  const grant = store.createGrant({
    subject: { kind: 'session', id: owner.id },
    audience: { kind: 'org', orgId: 'tenant-beta' },
    tier: 'view',
  }, store.defaultTenantId())
  assert.equal(typeof grant, 'object')
  const shared = await call('GET', `/sessions/${owner.id}/search?q=needle`, undefined, { 'x-tenant-id': 'tenant-beta' })
  assert.equal(shared.status, 200, 'view readers receive the same scoped search capability')
  assert.deepEqual(shared.json.hits.map((hit: any) => hit.messageId), ['search-user', 'search-assistant'])
})

test('conversation search rejects malformed, duplicate, and overlong paging inputs', async () => {
  const session = store.createSession('Search input fixture', 'tenant-search-input')
  for (const path of [
    `/sessions/${session.id}/search`,
    `/sessions/${session.id}/search?q=x&offset=-1`,
    `/sessions/${session.id}/search?q=x&offset=01`,
    `/sessions/${session.id}/search?q=x&offset=1.2`,
    `/sessions/${session.id}/search?q=x&q=y`,
    `/sessions/${session.id}/search?q=x&q=x`,
    `/sessions/${session.id}/search?q=x&offset=0&offset=1`,
    `/sessions/${session.id}/search?q=${'x'.repeat(257)}`,
  ]) {
    const response = await call('GET', path, undefined, { 'x-tenant-id': 'tenant-search-input' })
    assert.equal(response.status, 400, path)
  }
  const empty = await call('GET', `/sessions/${session.id}/search?q=%20%20`, undefined, { 'x-tenant-id': 'tenant-search-input' })
  assert.equal(empty.status, 200)
  assert.deepEqual(empty.json, { query: '', offset: 0, total: 0, hits: [] })
})

test('conversation search is declared once in the route-owned capability catalog', () => {
  const operation = catalogOf(buildRouter()).find((item) => item.method === 'GET' && item.pattern === '/sessions/:id/search')
  assert.ok(operation)
  assert.equal(operation.capability, 'GET /sessions/:id/search')
  assert.equal(operation.query?.q && (operation.query.q as any).maxLength, 256)
  assert.equal((operation.query?.offset as any).pattern, '^(0|[1-9][0-9]*)$')
})
