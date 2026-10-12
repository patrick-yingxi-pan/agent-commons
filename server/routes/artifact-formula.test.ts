/** Explicit formula cells retain authored source while reads and XLSX expose calculated text. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { ZipReader, Uint8ArrayReader, TextWriter } from '@zip.js/zip.js'
import { artifactContextId, artifactSnapshotText } from '../../contract/artifactSnapshot.ts'
import type { ArtifactContentLibrary, ArtifactItem } from '../../contract/index.ts'
import { call } from '../testkit/http.ts'

const OWNER = 'tenant-personal'
const READER = 'tenant-beta'
const FOREIGN = 'tenant-growthworks'
const headers = (tenant: string, extra: Record<string, string> = {}) => ({ 'x-tenant-id': tenant, ...extra })

const initial = {
  type: 'sheet',
  columns: ['Qty', 'Price', 'Total', 'Twice', 'Legacy formula text', 'Division error'],
  rows: [[
    '2', '3', { formula: '=SUM(A1:B1)' }, { formula: '(A1+B1)*2' }, '=SUM(A1:B1)', { formula: '=B1/0' },
  ], [
    '4', '5', { formula: '=SUM(A2:B2)' }, { formula: '=A2-B2' }, '=1+1', { formula: '=Q1' },
  ]],
  note: 'Authored sources remain editable.',
}

async function createSheet(name: string, body = initial) {
  const response = await call('POST', '/artifacts', { name, kind: 'sheet', body }, headers(OWNER, { 'idempotency-key': `formula-create-${randomUUID()}` }))
  assert.equal(response.status, 201, JSON.stringify(response.json))
  return response.json.artifact as ArtifactItem
}

async function artifactBody(id: string, tenant = OWNER) {
  const library = (await call('GET', '/artifact-content', undefined, headers(tenant))).json as ArtifactContentLibrary
  return library[id]
}

async function zipFiles(base64: string) {
  const reader = new ZipReader(new Uint8ArrayReader(Buffer.from(base64, 'base64')))
  try {
    const entries = await reader.getEntries()
    const files: Record<string, string> = {}
    for (const entry of entries) if (!entry.directory) files[entry.filename] = await entry.getData!(new TextWriter())
    return files
  } finally { await reader.close() }
}

test('formula source survives create, CAS edit, history restore, model snapshot and values-only XLSX', async () => {
  const stamp = randomUUID()
  const artifact = await createSheet(`formula-${stamp}.xlsx`)
  assert.deepEqual(await artifactBody(artifact.id), { ...initial, revision: 0 }, 'the saved body retains the explicit formula objects and literal formula-looking strings')

  const grant = await call('POST', '/grants', {
    subject: { kind: 'artifact', id: artifact.id }, audience: { kind: 'org', orgId: READER }, tier: 'view',
  }, headers(OWNER))
  assert.equal(grant.status, 200)
  assert.deepEqual(await artifactBody(artifact.id, READER), { ...initial, revision: 0 })
  assert.equal(await artifactBody(artifact.id, FOREIGN), undefined)

  const session = await call('POST', '/sessions', { firstMessage: `Formula snapshot ${stamp}` }, headers(OWNER))
  assert.equal(session.status, 200)
  const attached = await call('PATCH', `/sessions/${session.json.id}/context-state`, {
    operations: [], workspace: { workspaces: [], repos: [], connectors: [], attachments: [{
      id: artifactContextId(artifact.id), label: artifact.name, kind: 'artifact', artifactCaptureId: randomUUID(),
    }] },
  }, headers(OWNER))
  assert.equal(attached.status, 200, JSON.stringify(attached.json))
  const snapshot = attached.json.workspace.attachments[0].artifactSnapshot
  assert.equal(snapshot.revision, 0)
  assert.deepEqual(snapshot.body, initial, 'the model snapshot keeps authored formula sources and legacy literals')
  assert.equal(Object.hasOwn(snapshot, 'calculation'), false, 'the immutable body snapshot stays an exact authored copy')
  const modelText = JSON.parse(artifactSnapshotText(snapshot))
  assert.deepEqual(modelText.calculation, {
    version: 1,
    sheets: [{ id: 'sheet-1', rows: [
      ['2', '3', '5', '10', '=SUM(A1:B1)', '#DIV/0!'],
      ['4', '5', '9', '-1', '=1+1', '#REF!'],
    ] }],
  })
  assert.equal(artifactSnapshotText(snapshot), JSON.stringify({
    title: artifact.name, artifactKind: 'sheet', revision: 0, body: initial, calculation: modelText.calculation,
  }))

  const edited = structuredClone(initial)
  edited.rows[0]![0] = '4'
  const request = { content: edited, expectedRevision: 0 }
  const key = `formula-edit-${stamp}`
  const saved = await call('PATCH', `/artifacts/${artifact.id}/content`, request, headers(OWNER, { 'idempotency-key': key }))
  assert.equal(saved.status, 200, JSON.stringify(saved.json))
  assert.equal(saved.json.revision, 1)
  assert.deepEqual(await artifactBody(artifact.id), { ...edited, revision: 1 })
  const replay = await call('PATCH', `/artifacts/${artifact.id}/content`, request, headers(OWNER, { 'idempotency-key': key }))
  assert.equal(replay.status, 200)
  assert.equal(replay.json.revision, 1, 'same logical save does not append a duplicate body revision')
  assert.equal((await call('PATCH', `/artifacts/${artifact.id}/content`, { content: initial, expectedRevision: 0 }, headers(OWNER))).status, 409)
  assert.equal((await call('PATCH', `/artifacts/${artifact.id}/content`, request, headers(READER))).status, 404)
  assert.equal((await call('PATCH', `/artifacts/${artifact.id}/content`, request, headers(FOREIGN))).status, 404)

  const version0 = await call('GET', `/artifacts/${artifact.id}/history/0`, undefined, headers(OWNER))
  const version1 = await call('GET', `/artifacts/${artifact.id}/history/1`, undefined, headers(OWNER))
  assert.deepEqual(version0.json.version.body, initial)
  assert.deepEqual(version1.json.version.body, edited)
  const restored = await call('POST', `/artifacts/${artifact.id}/history/0/restore`, { expectedRevision: 1 }, headers(OWNER, { 'idempotency-key': `formula-restore-${stamp}` }))
  assert.equal(restored.status, 200, JSON.stringify(restored.json))
  assert.equal(restored.json.currentRevision, 2)
  assert.deepEqual(await artifactBody(artifact.id), { ...initial, revision: 2 }, 'restore restores formula source, not a flattened result')
  assert.deepEqual(await artifactBody(artifact.id, READER), { ...initial, revision: 2 })

  const exported = await call('GET', `/artifacts/${artifact.id}/export?format=xlsx`, undefined, headers(OWNER))
  assert.equal(exported.status, 200, JSON.stringify(exported.json))
  assert.equal(exported.json.revision, 2)
  const files = await zipFiles(exported.json.content)
  assert.ok(files['xl/sharedStrings.xml'])
  assert.doesNotMatch(Object.values(files).join('\n'), /<f(?:\s|>)/, 'formula source never becomes an executable XLSX formula node')
  for (const expected of ['5', '10', '9', '-1', '=SUM(A1:B1)', '=1+1', '#DIV/0!', '#REF!']) {
    assert.ok(files['xl/sharedStrings.xml']!.includes(expected), `values-only XLSX includes ${expected}`)
  }
  const readerExport = await call('GET', `/artifacts/${artifact.id}/export?format=xlsx`, undefined, headers(READER))
  assert.deepEqual(readerExport.json, exported.json, 'granted reader receives the same calculated export')
  assert.equal((await call('GET', `/artifacts/${artifact.id}/export?format=xlsx`, undefined, headers(FOREIGN))).status, 404)
  assert.equal((await call('GET', `/artifacts/${artifact.id}/history/0`, undefined, headers(FOREIGN))).status, 404)
})

test('formula evaluator returns stable explicit errors and leaves legacy formula-looking strings literal', async () => {
  const body = {
    type: 'sheet', columns: ['Input', 'Out', 'Literal'], rows: [[
      '0', { formula: '=A1/0' }, '=A1/0',
    ], [
      '1', { formula: '=SUM(A1:A2)' }, '=SUM(A1:A2)',
    ], [
      '2', { formula: '=UNKNOWN(A1)' }, '=UNKNOWN(A1)',
    ], [
      '3', { formula: '=A99' }, '=A99',
    ], [
      '4', { formula: '=A1+' }, '=A1+',
    ], [
      '5', { formula: '=1/0' }, '=1/0',
    ], [
      '6', { formula: '=1e999' }, '=1e999',
    ], [
      '7', { formula: '=B9' }, '=B9',
    ], [
      '8', { formula: '=B8' }, '=B8',
    ], [
      'word', { formula: '=A10+1' }, '=A10+1',
    ], [
      '9', { formula: '=SUM(A1:A1000000)' }, '=SUM(A1:A1000000)',
    ]],
  }
  const artifact = await createSheet(`formula-errors-${randomUUID()}.xlsx`, body)
  assert.deepEqual(await artifactBody(artifact.id), { ...body, revision: 0 }, 'error states do not rewrite authored formulas')
  const exported = await call('GET', `/artifacts/${artifact.id}/export?format=xlsx`, undefined, headers(OWNER))
  assert.equal(exported.status, 200)
  const files = await zipFiles(exported.json.content)
  const shared = files['xl/sharedStrings.xml']!
  for (const error of ['#DIV/0!', '#VALUE!', '#UNSUPPORTED!', '#REF!', '#FORMULA!', '#NUM!', '#CYCLE!', '#LIMIT!']) {
    assert.ok(shared.includes(error), `${error} is a visible calculated value`)
  }
  for (const literal of ['=A1/0', '=SUM(A1:A2)', '=UNKNOWN(A1)', '=A99', '=A1+', '=1/0', '=B9', '=B8', '=A10+1', '=SUM(A1:A1000000)']) {
    assert.ok(shared.includes(literal), `${literal} remains literal text without an explicit formula object`)
  }
})
