/** Retention is internal until the complete Trash UI/API checkpoint. Existing
 * public doors must already suspend canonical artifacts while retained. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { store } from '../store/index.ts'
import { call } from '../testkit/http.ts'
import { docBlockId } from '../documentIdentity.ts'

test('HTTP and MCP suspend artifact bodies, exports, grants and review threads; restore honors revocation', async () => {
  const tenant = 'tenant-trash-route-owner'
  const owner = { 'x-tenant-id': tenant }
  const reader = { 'x-tenant-id': 'tenant-beta' }
  const created = await call('POST', '/artifacts', { name: 'Trash route saved body.md', kind: 'doc', body: 'Saved route body.' }, { ...owner, 'idempotency-key': 'trash-routes' })
  assert.equal(created.status, 201)
  const id = created.json.artifact.id
  const subject = { kind: 'artifact', id }
  const shared = await call('POST', '/grants', { subject, audience: { kind: 'org', orgId: 'tenant-beta' }, tier: 'propose' }, owner)
  assert.equal(shared.status, 200)
  const link = await call('POST', '/grants', { subject, audience: { kind: 'link' }, tier: 'view' }, owner)
  assert.equal(link.status, 200)
  const offered = await call('POST', '/proposals', { subject, delta: { kind: 'artifact-patch', block: 0, text: 'Proposed route body.' }, rationale: 'Retain review history.' }, reader)
  assert.equal(offered.status, 200)
  const reads = [`/artifacts/${id}`, `/artifacts/${id}/export`, `/artifacts/${id}/export?format=docx`, `/grants?kind=artifact&id=${id}`, `/proposals?kind=artifact&id=${id}`, `/proposals/${offered.json.id}`, `/discussions/${offered.json.discussionId}`]
  const discussionSubject = { kind: 'discussion', id: offered.json.discussionId }
  const nested = await call('POST', '/discussions', { anchor: { ref: discussionSubject }, firstPost: 'Nested retained discussion.' }, reader)
  assert.equal(nested.status, 200)
  const nestedLink = await call('POST', '/grants', { subject: discussionSubject, audience: { kind: 'link' }, tier: 'view' }, reader)
  assert.equal(nestedLink.status, 200)
  assert.equal((await call('GET', `/discussions/${nested.json.id}`, undefined, reader)).status, 200)
  for (const path of reads) assert.equal((await call('GET', path, undefined, reader)).status, 200, `live prerequisite ${path}`)
  store.setArtifactLifecycle(id, 'trashed', 0, tenant)
  assert.equal((await call('GET', `/discussions/${nested.json.id}`, undefined, reader)).status, 404, 'nested social refs inherit root retention')
  assert.equal((await call('POST', '/grants', { subject: discussionSubject, audience: { kind: 'link' }, tier: 'view' }, reader)).status, 404)
  assert.equal((await call('POST', '/grants/redeem', { token: nestedLink.json.audience.token }, owner)).status, 404)
  for (const headers of [owner, reader, { 'x-tenant-id': 'tenant-trash-route-foreign' }]) {
    for (const path of reads) assert.equal((await call('GET', path, undefined, headers)).status, 404, `Trash closes ${path}`)
    assert.equal((await call('GET', '/artifact-content', undefined, headers)).json[id], undefined)
    assert.equal((await call('PATCH', `/artifacts/${id}`, { name: 'Must not change', expectedRevision: 0 }, headers)).status, 404)
    assert.equal((await call('PATCH', `/artifacts/${id}/content`, { block: 0, text: 'Must not change', expectedRevision: 0 }, headers)).status, 404)
    const mcp = await call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_artifact_content', arguments: {} } }, headers)
    assert.equal(JSON.parse(mcp.json.result.content[0].text).body[id], undefined)
  }
  assert.equal((await call('POST', '/grants/redeem', { token: link.json.audience.token }, reader)).status, 404)
  assert.equal((await call('POST', '/grants', { subject, audience: { kind: 'link' }, tier: 'view' }, owner)).status, 404)
  assert.equal((await call('POST', `/proposals/${offered.json.id}/land`, undefined, owner)).status, 404)
  assert.equal((await call('DELETE', `/grants/${shared.json.id}`, undefined, owner)).status, 200, 'revocation remains available while its subject is retained')
  store.setArtifactLifecycle(id, 'active', 1, tenant)
  assert.equal((await call('GET', `/artifacts/${id}`, undefined, owner)).status, 200)
  assert.equal((await call('GET', `/artifacts/${id}`, undefined, reader)).status, 404, 'restore never recreates revoked sharing')
  const review = await call('GET', `/proposals/${offered.json.id}`, undefined, owner)
  assert.equal(review.status, 200)
  assert.equal(review.json.state, 'offered', 'Trash preserved the pending review without landing it')
  const body = (await call('GET', '/artifact-content', undefined, owner)).json[id]
  assert.deepEqual(body.blocks, [{ id: docBlockId(id, 0, 0), p: 'Saved route body.' }])
  assert.equal(body.revision, 0)
})
