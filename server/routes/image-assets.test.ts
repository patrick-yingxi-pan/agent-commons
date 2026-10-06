import { test } from 'node:test'
import assert from 'node:assert/strict'
import { call, callRaw } from '../testkit/http.ts'
import { ImageAssetRegistry } from '../imageAssets.ts'
import { store } from '../store/index.ts'

const A = 'image-route-owner'
const B = 'tenant-beta'
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

function image(extra = '') {
  const data = PNG + extra
  return { mimeType: 'image/png', data, width: 1, height: 1, byteLength: Buffer.from(data, 'base64').byteLength }
}

async function upload(tenant = A, value = image()) {
  return call('POST', '/image-assets', value, { 'x-tenant-id': tenant })
}

async function getContent(id: string, tenant: string) {
  return callRaw('GET', `/image-assets/${id}/content`, undefined, { 'x-tenant-id': tenant })
}

test('image upload deduplicates per tenant and returns only a reference', async () => {
  const first = await upload()
  assert.equal(first.status, 200)
  assert.match(first.json.id, /^img-[a-f0-9]{64}$/)
  assert.equal('data' in first.json, false)
  const duplicate = await upload()
  assert.deepEqual(duplicate.json, first.json)
  const other = await upload(B)
  assert.equal(other.status, 200)
  assert.notEqual(other.json.id, first.json.id)
})

test('private original download is exact, tenant-only, and never shared or model input', async () => {
  const original = { name: 'original.svg', data: 'PHN2Zy8+', byteLength: 6 }
  const uploaded = await upload(A, { image: image(), original })
  assert.equal(uploaded.status, 200)
  assert.equal(uploaded.json.originalByteLength, 6)
  const path = `/image-assets/${uploaded.json.id}/original`
  assert.equal((await callRaw('GET', path, undefined, { 'x-tenant-id': A })).headers['cache-control'], 'no-store', 'private source bytes must not enter browser or intermediary caches')
  assert.deepEqual((await call('GET', path, undefined, { 'x-tenant-id': A })).json, { id: uploaded.json.id, original })
  const session = (await call('POST', '/sessions', { firstMessage: 'private originals' }, { 'x-tenant-id': A })).json
  const workspace = { workspaces: [], repos: [], connectors: [], attachments: [{ id: 'original-photo', label: 'original.svg', kind: 'photo', image: uploaded.json }] }
  assert.equal((await call('PATCH', `/sessions/${session.id}/context-state`, { operations: [], workspace }, { 'x-tenant-id': A })).status, 200)
  assert.equal((await call('POST', '/grants', { subject: { kind: 'session', id: session.id }, audience: { kind: 'org', orgId: B }, tier: 'view' }, { 'x-tenant-id': A })).status, 200)
  assert.equal((await getContent(uploaded.json.id, B)).status, 200)
  for (const tenant of [B, 'private-original-stranger']) assert.equal((await call('GET', path, undefined, { 'x-tenant-id': tenant })).status, 404)
  const visible = await call('GET', `/sessions/${session.id}`, undefined, { 'x-tenant-id': B })
  assert.equal(JSON.stringify(visible.json).includes(original.data), false)
  assert.deepEqual({ ...store.sessionImageInput(session.id) }, { [uploaded.json.id]: image() })
  const legacy = await upload()
  assert.equal((await call('GET', `/image-assets/${legacy.json.id}/original`, undefined, { 'x-tenant-id': A })).status, 404)
  const mcp = await call('POST', '/mcp', { jsonrpc: '2.0', id: 'original-download', method: 'tools/call', params: { name: 'get_image_assets_by_id_original', arguments: { id: uploaded.json.id } } }, { 'x-tenant-id': A })
  assert.deepEqual(JSON.parse(mcp.json.result.content[0].text).body, { id: uploaded.json.id, original })
})

test('original metadata is name/length only, owner-only, and fenced by account source', async () => {
  const original = { name: 'private-source.svg', data: 'PHN2Zy8+', byteLength: 6 }
  const uploaded = await upload(A, { image: image(), original })
  assert.equal(uploaded.status, 200)
  const path = `/image-assets/${uploaded.json.id}/original?metadata=1`
  assert.equal((await callRaw('GET', path, undefined, { 'x-tenant-id': A })).headers['cache-control'], 'no-store', 'private filenames and lengths must not enter caches')
  const owner = await call('GET', path, undefined, { 'x-tenant-id': A })
  assert.equal(owner.status, 200)
  assert.deepEqual(owner.json, { id: uploaded.json.id, name: original.name, byteLength: original.byteLength })
  assert.equal('data' in owner.json, false, 'metadata never carries source bytes')
  for (const tenant of [B, 'private-original-metadata-stranger']) {
    assert.equal((await call('GET', path, undefined, { 'x-tenant-id': tenant })).status, 404)
  }
  assert.equal((await call('GET', `/image-assets/${uploaded.json.id}/original?metadata=true`, undefined, { 'x-tenant-id': A })).status, 400,
    'metadata accepts only the exact supported value')
  const stale = await call('GET', path, undefined, {
    'x-tenant-id': A,
    'x-account-transition-source': 'session:account-that-is-not-current',
  })
  assert.equal(stale.status, 409, 'a stale active-account source cannot read original metadata')
  assert.equal((await call('GET', `/image-assets/${uploaded.json.id}/original`, undefined, { 'x-tenant-id': A })).json.original.data, original.data,
    'the owner can still retrieve the original after rejected reads')
})

test('image upload rejects a stale account transition source before storing', async () => {
  const tenant = `image-stale-${Date.now()}`
  const expected = new ImageAssetRegistry().put(tenant, image())
  const before = await getContent(expected.id, tenant)
  assert.equal(before.status, 404, 'the expected content id is absent before the rejected upload')
  const rejected = await call('POST', '/image-assets', image(), {
    'x-tenant-id': tenant,
    'x-account-transition-source': 'session:account-that-is-not-current',
  })
  assert.equal(rejected.status, 409)
  assert.equal(rejected.json.error.code, 'conflict')
  assert.equal((await getContent(expected.id, tenant)).status, 404, 'stale transition did not store the asset')
})

test('content is owner-readable, shared-viewer-readable, and existence-hidden otherwise', async () => {
  const uploaded = await upload()
  const ownerContent = await getContent(uploaded.json.id, A)
  assert.equal(ownerContent.status, 200)
  assert.equal(ownerContent.headers['content-type'], 'image/png')
  const session = (await call('POST', '/sessions', { firstMessage: 'image sharing' }, { 'x-tenant-id': A })).json
  const workspace = { workspaces: [], repos: [], connectors: [], attachments: [{ id: 'photo-share', label: 'share.png', kind: 'photo', image: uploaded.json }] }
  assert.equal((await call('PATCH', `/sessions/${session.id}/context-state`, { operations: [], workspace }, { 'x-tenant-id': A })).status, 200)
  const grant = await call('POST', '/grants', { subject: { kind: 'session', id: session.id }, audience: { kind: 'org', orgId: B }, tier: 'view' }, { 'x-tenant-id': A })
  assert.equal(grant.status, 200)
  assert.equal((await getContent(uploaded.json.id, B)).status, 200)
  assert.equal((await getContent(uploaded.json.id, 'image-route-stranger')).status, 404)
  assert.equal((await getContent('img-unknown', B)).status, 404)
  assert.equal((await call('PATCH', `/sessions/${session.id}/context-state`, { operations: [], workspace }, { 'x-tenant-id': B })).status, 403)
  assert.equal((await call('DELETE', `/grants/${grant.json.id}`, undefined, { 'x-tenant-id': A })).status, 200)
  assert.equal((await getContent(uploaded.json.id, B)).status, 404)
  assert.equal((await getContent(uploaded.json.id, A)).status, 200)
})

test('context-state rejects forged, mismatched, and foreign image references atomically', async () => {
  const owner = (await call('POST', '/sessions', { firstMessage: 'atomic image' }, { 'x-tenant-id': A })).json
  const uploaded = await upload(A)
  const base = { workspaces: [], repos: [], connectors: [], attachments: [] }
  const forged = { ...uploaded.json, byteLength: uploaded.json.byteLength + 1 }
  const bad = await call('PATCH', `/sessions/${owner.id}/context-state`, { operations: [], workspace: { ...base, attachments: [{ id: 'bad', label: 'bad.png', kind: 'photo', image: forged }] } }, { 'x-tenant-id': A })
  assert.equal(bad.status, 400)
  assert.deepEqual((await call('GET', `/sessions/${owner.id}`, undefined, { 'x-tenant-id': A })).json.workspace.attachments, [])
  const foreign = await upload(B)
  const foreignAttempt = await call('PATCH', `/sessions/${owner.id}/context-state`, { operations: [], workspace: { ...base, attachments: [{ id: 'foreign', label: 'foreign.png', kind: 'photo', image: foreign.json }] } }, { 'x-tenant-id': A })
  assert.equal(foreignAttempt.status, 400)
})

test('image upload body budget is larger than ordinary JSON but rejects oversized snapshots', async () => {
  const base = Buffer.from(PNG, 'base64')
  const payload = Buffer.alloc(1_100_000)
  const chunk = Buffer.alloc(12 + payload.length)
  chunk.writeUInt32BE(payload.length, 0)
  chunk.write('tEXt', 4)
  payload.copy(chunk, 8)
  const largeBytes = Buffer.concat([base.subarray(0, base.length - 12), chunk, base.subarray(base.length - 12)])
  const large = await upload(A, { mimeType: 'image/png', data: largeBytes.toString('base64'), width: 1, height: 1, byteLength: largeBytes.length })
  assert.equal(large.status, 200, 'a valid >1MiB JSON request reaches the image route')
  const oversized = await upload(A, { ...image(), data: PNG + 'A'.repeat(4_200_000), byteLength: Buffer.from(PNG + 'A'.repeat(4_200_000), 'base64').byteLength })
  assert.equal(oversized.status, 400)
})

test('image upload accepts an 8 MiB original whose JSON body exceeds 8 MiB', async () => {
  const sourceBytes = Buffer.alloc(8 * 1024 * 1024)
  const original = { name: 'large-original.png', data: sourceBytes.toString('base64'), byteLength: sourceBytes.length }
  const uploaded = await upload(A, { image: image(), original })
  assert.equal(uploaded.status, 200, JSON.stringify(uploaded.json?.error ?? uploaded.json))
  assert.equal(uploaded.json.originalByteLength, sourceBytes.length)
  const metadata = await call('GET', `/image-assets/${uploaded.json.id}/original?metadata=1`, undefined, { 'x-tenant-id': A })
  assert.deepEqual(metadata.json, { id: uploaded.json.id, name: original.name, byteLength: sourceBytes.length })
})

test('MCP tools/call preserves image upload references and binary read content', async () => {
  const uploaded = await call('POST', '/mcp', { jsonrpc: '2.0', id: 'image-mcp-upload', method: 'tools/call', params: { name: 'post_image_assets', arguments: { body: image() } } }, { 'x-tenant-id': A })
  assert.equal(uploaded.status, 200)
  const ref = JSON.parse(uploaded.json.result.content[0].text).body
  assert.match(ref.id, /^img-[a-f0-9]{64}$/)
  const content = await call('POST', '/mcp', { jsonrpc: '2.0', id: 'image-mcp-read', method: 'tools/call', params: { name: 'get_image_assets_by_id_content', arguments: { id: ref.id } } }, { 'x-tenant-id': A })
  assert.equal(content.status, 200)
  assert.equal(content.json.result.content[0].type, 'image')
  assert.equal(content.json.result.content[0].data, image().data)
  const foreign = await call('POST', '/mcp', { jsonrpc: '2.0', id: 'image-mcp-foreign', method: 'tools/call', params: { name: 'get_image_assets_by_id_content', arguments: { id: ref.id } } }, { 'x-tenant-id': 'image-route-stranger' })
  assert.equal(foreign.json.result.isError, true)
  assert.equal(JSON.parse(foreign.json.result.content[0].text).status, 404)
})
