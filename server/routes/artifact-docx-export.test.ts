/** DOCX adds a format, not a new identity, persistence slice, or access door. */
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { extractDocx } from '../../src/lib/docxExtraction.ts'
import { DOCX_MEDIA_TYPE, type ArtifactItem } from '../../contract/index.ts'
import { call } from '../testkit/http.ts'
import { store } from '../store/index.ts'
import { closePersistence, loadState } from '../persistence/persist.ts'

before(() => {
  process.env.PERSIST_BACKEND = 'sqlite'
  process.env.DATABASE_PATH = ':memory:'
  store.initPersistence()
})
after(() => closePersistence())

const OWNER = 'tenant-personal'
const READER = 'tenant-beta'
const FOREIGN = 'tenant-growthworks'
let sequence = 0
async function create(body = 'First paragraph.\n\nSecond paragraph.', name = `word-${Date.now()}-${++sequence}.md`, kind = 'doc') {
  const result = await call('POST', '/relations/ops', {
    op: { kind: 'save-artifact', artifact: { name, kind, meta: 'Document', body } },
  }, { 'x-tenant-id': OWNER, 'idempotency-key': `word-${Date.now()}-${++sequence}` })
  assert.equal(result.status, 200)
  const row = (result.json.extraArtifacts as ArtifactItem[]).find((item) => item.name === name)
  assert.ok(row)
  return row
}
const download = (id: string, tenant = OWNER, query = 'format=docx') =>
  call('GET', `/artifacts/${id}/export?${query}`, undefined, { 'x-tenant-id': tenant })
async function extracted(response: Awaited<ReturnType<typeof download>>) {
  assert.equal(response.status, 200)
  assert.equal(response.json.mediaType, DOCX_MEDIA_TYPE)
  assert.equal(response.json.encoding, 'base64')
  const result = await extractDocx(Buffer.from(response.json.content, 'base64'))
  assert.equal(result.documentImport.status, 'ready')
  return result.text
}
async function share(id: string) {
  const result = await call('POST', '/grants', { subject: { kind: 'artifact', id }, audience: { kind: 'org', orgId: READER }, tier: 'view' }, { 'x-tenant-id': OWNER })
  assert.equal(result.status, 200)
  return result.json.id as string
}

test('DOCX exports exact saved identity, current edits and rename without mutating state', async () => {
  const row = await create()
  const title = row.name.slice(0, -3)
  const grant = await share(row.id)
  const first = await download(row.id)
  assert.equal(first.json.artifactId, row.id)
  assert.equal(first.json.filename, `${title}.docx`)
  assert.equal(first.json.revision, 0)
  assert.equal(await extracted(first), `${title}\nFirst paragraph.\nSecond paragraph.`)
  assert.deepEqual((await download(row.id, READER)).json, first.json)
  assert.equal((await call('PATCH', `/artifacts/${row.id}/content`, { block: 1, text: 'Edited <literal> & 🚀.', expectedRevision: 0 }, { 'x-tenant-id': OWNER })).status, 200)
  assert.equal((await call('PATCH', `/artifacts/${row.id}`, { name: 'renamed-brief.md', expectedRevision: 0 }, { 'x-tenant-id': OWNER })).status, 200)
  const before = loadState()
  assert.ok(before?.graph.extraArtifacts.some(artifact => artifact.id === row.id), 'the compared snapshot contains this test document')
  const events: string[] = []
  const off = store.subscribe((event) => events.push(event.type))
  try {
    const current = await download(row.id, READER)
    assert.equal(current.json.filename, 'renamed-brief.docx')
    assert.equal(current.json.revision, 1)
    assert.equal(await extracted(current), `${title}\nFirst paragraph.\nEdited <literal> & 🚀.`)
    const implicit = await call('GET', `/artifacts/${row.id}/export`, undefined, { 'x-tenant-id': OWNER })
    const explicit = await download(row.id, OWNER, 'format=markdown')
    assert.equal(implicit.status, 200)
    assert.equal(implicit.json.mediaType, 'text/markdown;charset=utf-8')
    assert.deepEqual(explicit.json, implicit.json, 'omitted format still means Markdown')
    assert.deepEqual(loadState(), before)
    assert.deepEqual(events, [])
  } finally { off() }
  assert.equal((await call('DELETE', `/grants/${grant}`, undefined, { 'x-tenant-id': OWNER })).status, 200)
  assert.equal((await download(row.id, READER)).status, 404)
  assert.equal((await download(row.id, FOREIGN)).status, 404)
  assert.equal((await download('missing', READER)).status, 404)
})

test('DOCX refuses malformed format only after the exact visibility wall', async () => {
  const row = await create()
  for (const query of ['format=', 'format=doc', 'format=DOCX', 'format=docx&format=docx', 'format=docx&format=markdown']) {
    const own = await download(row.id, OWNER, query)
    assert.equal(own.status, 400, query)
    assert.equal(own.json.error.code, 'bad_request')
    assert.equal((await download(row.id, FOREIGN, query)).status, 404, query)
  }
})

test('DOCX rechecks access after asynchronous serialization and never mixes saved revisions', async () => {
  const row = await create()
  const grant = await share(row.id)
  const pending = store.exportArtifactWord(row.id, READER)
  assert.equal(store.revokeGrant(grant, OWNER), 'ok')
  assert.equal(await pending, undefined, 'revocation wins before bytes leave the read boundary')
  const old = store.exportArtifactWord(row.id, OWNER)
  assert.equal((await call('PATCH', `/artifacts/${row.id}/content`, { block: 0, text: 'New first.', expectedRevision: 0 }, { 'x-tenant-id': OWNER })).status, 200)
  const snapshot = await old
  assert.ok(snapshot)
  assert.equal(snapshot.revision, 0)
  assert.equal((await extractDocx(Buffer.from(snapshot.content, 'base64'))).text, `${row.name.slice(0, -3)}\nFirst paragraph.\nSecond paragraph.`)
  assert.equal((await download(row.id)).json.revision, 1)
})

test('DOCX refuses metadata-only, wrong-kind and XML-incompatible bodies without losing saved text', async () => {
  // This distinct same-named metadata row must not borrow the seeded body.
  const meta = await call('POST', '/relations/ops', { op: { kind: 'save-artifact', artifact: { name: 'insights-onepager.md', kind: 'doc', meta: 'Document' } } }, { 'x-tenant-id': OWNER, 'idempotency-key': `word-metadata-${Date.now()}` })
  assert.equal(meta.status, 200)
  const row = (meta.json.extraArtifacts as ArtifactItem[]).find((item) => item.name === 'insights-onepager.md')!
  assert.ok(row)
  assert.notEqual(row.id, 'a1')
  assert.equal((await download(row.id)).status, 409)
  const sheet = await call('POST', '/artifacts', { name: 'wrong-kind.xlsx', kind: 'sheet', body: { type: 'sheet', columns: ['A'], rows: [['B']] } }, { 'x-tenant-id': OWNER, 'idempotency-key': `word-sheet-${Date.now()}` })
  assert.equal(sheet.status, 201)
  assert.equal((await download(sheet.json.artifact.id)).status, 409)
  const invalid = await create('Keep\u0000this text.')
  const refused = await download(invalid.id)
  assert.equal(refused.status, 409)
  assert.equal(refused.json.error.code, 'capability_unavailable')
  assert.match(refused.json.error.message, /control characters/)
  assert.equal((await call('GET', '/artifact-content', undefined, { 'x-tenant-id': OWNER })).json[invalid.id].blocks[0].p, 'Keep\u0000this text.')
  assert.equal((await download(invalid.id, OWNER, 'format=markdown')).status, 200, 'refusal does not damage the existing export')
})
