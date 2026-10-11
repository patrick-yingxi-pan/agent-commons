/** XLSX export is a fresh, read-authorized projection of a saved sheet body.
 * The response is JSON metadata plus a base64 ZIP; it is not a native-file
 * upload or a spreadsheet calculation engine. */
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { ZipReader, Uint8ArrayReader, TextWriter } from '@zip.js/zip.js'
import { SaxesParser } from 'saxes'
import type { ArtifactItem } from '../../contract/index.ts'
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
const XLSX_MEDIA = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

async function createSheet(name: string, tenant = OWNER, body = { type: 'sheet', columns: ['Name', 'Value'], rows: [['Ada', '=SUM(A1:A2)'], ['Grace', '2']], note: 'Literal values.' }) {
  const response = await call('POST', '/relations/ops', {
    op: { kind: 'save-artifact', artifact: { name, kind: 'sheet', meta: 'Sheet', body } },
  }, { 'x-tenant-id': tenant, 'idempotency-key': `xlsx-export-create-${name}` })
  assert.equal(response.status, 200)
  const row = (response.json.extraArtifacts as ArtifactItem[]).find((artifact) => artifact.name === name)
  assert.ok(row)
  return row
}

async function zipTexts(base64: string) {
  const reader = new ZipReader(new Uint8ArrayReader(Buffer.from(base64, 'base64')))
  try {
    const entries = await reader.getEntries()
    const files: Record<string, string> = {}
    for (const entry of entries) {
      if (entry.directory) continue
      files[entry.filename] = await entry.getData!(new TextWriter())
    }
    return files
  } finally {
    await reader.close()
  }
}

function xmlTextValues(xml: string): string[] {
  if (!xml) return []
  const values: string[] = []
  let inText = false
  const parser = new SaxesParser({ xmlns: false })
  parser.on('opentag', (tag) => { inText = tag.name === 't' })
  parser.on('text', (value) => { if (inText) values.push(value) })
  parser.on('closetag', (tag) => { if ((typeof tag === 'string' ? tag : tag.name) === 't') inText = false })
  parser.write(xml).close()
  return values
}

function worksheetValues(xml: string, shared: string[]): { values: string[]; formulaNodes: number } {
  const values: string[] = []
  let inValue = false
  let inText = false
  let type = ''
  let raw = ''
  let formulaNodes = 0
  const parser = new SaxesParser({ xmlns: false })
  parser.on('opentag', (tag) => {
    if (tag.name === 'c') type = String(tag.attributes.t ?? '')
    if (tag.name === 'v') { inValue = true; raw = '' }
    if (tag.name === 't') { inText = true; raw = '' }
    if (tag.name === 'f') formulaNodes += 1
  })
  parser.on('text', (value) => { if (inValue || inText) raw += value })
  parser.on('closetag', (tag) => {
    const name = typeof tag === 'string' ? tag : tag.name
    if (name === 't') {
      if (type === 'inlineStr') values.push(raw)
      inText = false
      return
    }
    if (name !== 'v') return
    values.push(type === 's' ? (shared[Number(raw)] ?? '') : raw)
    inValue = false
  })
  parser.write(xml).close()
  return { values, formulaNodes }
}

test('XLSX export returns an exact literal-value ZIP to owner and granted reader', async () => {
  const stamp = Date.now().toString(36)
  const artifact = await createSheet(`literal-${stamp}.xlsx`)
  const grant = await call('POST', '/grants', { subject: { kind: 'artifact', id: artifact.id }, audience: { kind: 'org', orgId: READER }, tier: 'view' }, { 'x-tenant-id': OWNER })
  assert.equal(grant.status, 200)

  const owner = await call('GET', `/artifacts/${artifact.id}/export?format=xlsx`, undefined, { 'x-tenant-id': OWNER })
  assert.equal(owner.status, 200)
  assert.equal(owner.json.artifactId, artifact.id)
  assert.equal(owner.json.filename, artifact.name)
  assert.equal(owner.json.mediaType, XLSX_MEDIA)
  assert.equal(owner.json.encoding, 'base64')
  assert.equal(owner.json.revision, 0)
  assert.match(owner.json.content, /^[A-Za-z0-9+/]+=*$/)
  const files = await zipTexts(owner.json.content)
  assert.ok(files['xl/workbook.xml'])
  assert.ok(files['xl/worksheets/sheet1.xml'])
  const sheetXml = files['xl/worksheets/sheet1.xml']
  const shared = xmlTextValues(files['xl/sharedStrings.xml'] ?? '')
  const parsed = worksheetValues(sheetXml, shared)
  assert.ok(parsed.values.includes('Ada'))
  assert.ok(parsed.values.includes('=SUM(A1:A2)'))
  assert.equal(parsed.formulaNodes, 0, 'formula-looking values remain literal cells')

  const reader = await call('GET', `/artifacts/${artifact.id}/export?format=xlsx`, undefined, { 'x-tenant-id': READER })
  assert.equal(reader.status, 200)
  assert.deepEqual(reader.json, owner.json, 'granted reader receives the same ZIP projection')

  const foreign = await call('GET', `/artifacts/${artifact.id}/export?format=xlsx`, undefined, { 'x-tenant-id': FOREIGN })
  assert.equal(foreign.status, 404)
  assert.equal((await call('DELETE', `/grants/${grant.json.id}`, undefined, { 'x-tenant-id': OWNER })).status, 200)
  assert.equal((await call('GET', `/artifacts/${artifact.id}/export?format=xlsx`, undefined, { 'x-tenant-id': READER })).status, 404)
})

test('XLSX export follows rename, is read-only, and keeps Markdown behavior explicit', async () => {
  const stamp = Date.now().toString(36)
  const artifact = await createSheet(`rename-${stamp}.xlsx`)
  const events: string[] = []
  const off = store.subscribe((event) => events.push(event.type))
  try {
    const renamed = await call('PATCH', `/artifacts/${artifact.id}`, { name: `renamed-${stamp}.xlsx`, expectedRevision: 0 }, { 'x-tenant-id': OWNER })
    assert.equal(renamed.status, 200)
    events.length = 0
    const before = loadState()
    assert.ok(before?.graph.extraArtifacts.some(row => row.id === artifact.id), 'the compared snapshot contains this test spreadsheet')
    const xlsx = await call('GET', `/artifacts/${artifact.id}/export?format=xlsx`, undefined, { 'x-tenant-id': OWNER })
    assert.equal(xlsx.status, 200)
    assert.equal(xlsx.json.filename, `renamed-${stamp}.xlsx`)
    assert.equal(xlsx.json.revision, 0)
    const omitted = await call('GET', `/artifacts/${artifact.id}/export`, undefined, { 'x-tenant-id': OWNER })
    const markdown = await call('GET', `/artifacts/${artifact.id}/export?format=markdown`, undefined, { 'x-tenant-id': OWNER })
    assert.equal(omitted.status, 409)
    assert.deepEqual(markdown.json, omitted.json)
    assert.deepEqual(loadState(), before, 'exports do not mutate persisted state')
  } finally {
    off()
  }
  assert.deepEqual(events, [], 'exports publish no events')
})

test('XLSX query validation is strict behind the artifact visibility wall', async () => {
  const stamp = Date.now().toString(36)
  const artifact = await createSheet(`query-${stamp}.xlsx`)
  for (const query of [`format=ods`, `format=`, `format=xlsx&format=markdown`, `format=xlsx&format=xlsx`]) {
    const owner = await call('GET', `/artifacts/${artifact.id}/export?${query}`, undefined, { 'x-tenant-id': OWNER })
    assert.equal(owner.status, 400, query)
    assert.equal(owner.json.error.code, 'bad_request')
    const foreign = await call('GET', `/artifacts/${artifact.id}/export?${query}`, undefined, { 'x-tenant-id': FOREIGN })
    assert.equal(foreign.status, 404, `${query}: foreign wall precedes query disclosure`)
  }
  assert.equal((await call('GET', '/artifacts/missing/export?format=ods', undefined, { 'x-tenant-id': OWNER })).status, 404)
})

test('XLSX export rechecks the read wall after its async ZIP writer yields', async () => {
  const stamp = Date.now().toString(36)
  const artifact = await createSheet(`race-${stamp}.xlsx`)
  const grant = await call('POST', '/grants', { subject: { kind: 'artifact', id: artifact.id }, audience: { kind: 'org', orgId: READER }, tier: 'view' }, { 'x-tenant-id': OWNER })
  assert.equal(grant.status, 200)
  const pending = store.exportArtifactSpreadsheet(artifact.id, READER)
  assert.equal(store.revokeGrant(grant.json.id, OWNER), 'ok')
  assert.equal(await pending, undefined, 'revocation wins before the async export resolves')
})

test('XLSX export refuses metadata-only sheets without borrowing a fixture body', async () => {
  const stamp = Date.now().toString(36)
  const saved = await call('POST', '/relations/ops', { op: { kind: 'save-artifact', artifact: { name: 'query-perf.sheet', kind: 'sheet', meta: 'Sheet' } } }, { 'x-tenant-id': OWNER, 'idempotency-key': `xlsx-metadata-only-${stamp}` })
  assert.equal(saved.status, 200)
  const row = (saved.json.extraArtifacts as ArtifactItem[]).find((artifact) => artifact.name === 'query-perf.sheet' && artifact.id !== 'a5')
  assert.ok(row)
  const exported = await call('GET', `/artifacts/${row.id}/export?format=xlsx`, undefined, { 'x-tenant-id': OWNER })
  assert.equal(exported.status, 409)
  assert.equal(exported.json.error.code, 'capability_unavailable')
})
