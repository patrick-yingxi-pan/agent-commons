/** Structured artifact body edits share the owner-only content route with the
 * legacy prose-block editor, but require a complete typed body and CAS. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ZipReader, Uint8ArrayReader, TextWriter } from '@zip.js/zip.js'
import type { ArtifactContentLibrary, ArtifactItem } from '../../contract/index.ts'
import type { StructuredArtifactBody } from '../../contract/artifactAuthoring.ts'
import { call } from '../testkit/http.ts'

const OWNER = 'tenant-personal'
const READER = 'tenant-beta'
const FOREIGN = 'tenant-growthworks'

async function createStructured(name: string, kind: 'sheet' | 'slide', body?: StructuredArtifactBody) {
  const response = await call('POST', '/relations/ops', {
    op: { kind: 'save-artifact', artifact: { name, kind, meta: kind === 'sheet' ? 'Sheet' : 'Slides', ...(body ? { body } : {}) } },
  }, { 'x-tenant-id': OWNER, 'idempotency-key': `structured-edit-create-${name}` })
  assert.equal(response.status, 200)
  const row = (response.json.extraArtifacts as ArtifactItem[]).find((artifact) => artifact.name === name)
  assert.ok(row)
  return row
}

async function artifactBody(id: string, tenant = OWNER) {
  const library = (await call('GET', '/artifact-content', undefined, { 'x-tenant-id': tenant })).json as ArtifactContentLibrary
  return library[id]
}

async function zipTexts(base64: string) {
  const reader = new ZipReader(new Uint8ArrayReader(Buffer.from(base64, 'base64')))
  try {
    const entries = await reader.getEntries()
    const files: Record<string, string> = {}
    for (const entry of entries) {
      if (!entry.directory) files[entry.filename] = await entry.getData!(new TextWriter())
    }
    return files
  } finally {
    await reader.close()
  }
}

test('owner structured edits advance once, replay, preserve authority, and export edited bodies', async (t) => {
  const stamp = Date.now().toString(36)
  const sheetBody: StructuredArtifactBody = { type: 'sheet', columns: ['Name', 'Value'], rows: [['Ada', '1']] }
  const slideBody: StructuredArtifactBody = { type: 'slides', slides: [{ title: 'Launch', bullets: ['One'] }] }
  const sheetNext: StructuredArtifactBody = { type: 'sheet', columns: ['Name', 'Value'], rows: [['Edited Ada', '9']] }
  const slideNext: StructuredArtifactBody = { type: 'slides', slides: [{ title: 'Edited launch', bullets: ['Edited bullet'] }] }
  const sheet = await createStructured(`edit-${stamp}.csv`, 'sheet', sheetBody)
  const slide = await createStructured(`edit-${stamp}.slides`, 'slide', slideBody)
  const sheetGrant = await call('POST', '/grants', { subject: { kind: 'artifact', id: sheet.id }, audience: { kind: 'org', orgId: READER }, tier: 'view' }, { 'x-tenant-id': OWNER })
  const slideGrant = await call('POST', '/grants', { subject: { kind: 'artifact', id: slide.id }, audience: { kind: 'org', orgId: READER }, tier: 'view' }, { 'x-tenant-id': OWNER })
  assert.equal(sheetGrant.status, 200)
  assert.equal(slideGrant.status, 200)
  const renamed = await call('PATCH', `/artifacts/${sheet.id}`, { name: `renamed-${stamp}.csv`, expectedRevision: 0 }, { 'x-tenant-id': OWNER })
  assert.equal(renamed.status, 200)
  const originalSheetRow = structuredClone(renamed.json)
  const originalSlideRow = structuredClone(slide)
  const editNow = Math.max(originalSheetRow.editedAt, originalSlideRow.editedAt) + 1_000
  t.mock.method(Date, 'now', () => editNow)

  const sheetRequest = { content: sheetNext, expectedRevision: 0 }
  const sheetEdit = await call('PATCH', `/artifacts/${sheet.id}/content`, sheetRequest, { 'x-tenant-id': OWNER, 'idempotency-key': `structured-edit-sheet-${stamp}` })
  assert.equal(sheetEdit.status, 200)
  assert.equal(sheetEdit.json.revision, 1)
  assert.deepEqual(await artifactBody(sheet.id), { ...sheetNext, revision: 1 })
  const sheetRowAfterEdit = ((await call('GET', '/artifacts', undefined, { 'x-tenant-id': OWNER })).json as ArtifactItem[]).find((row) => row.id === sheet.id)
  assert.ok(sheetRowAfterEdit)
  assert.equal(sheetRowAfterEdit.editedAt, editNow, 'the structured body edit advances canonical recency')
  assert.equal(sheetRowAfterEdit.metadataRevision, originalSheetRow.metadataRevision, 'body recency is independent from name ordering')
  const sheetReplay = await call('PATCH', `/artifacts/${sheet.id}/content`, sheetRequest, { 'x-tenant-id': OWNER, 'idempotency-key': `structured-edit-sheet-${stamp}` })
  assert.equal(sheetReplay.status, 200)
  assert.equal(sheetReplay.json.revision, 1, 'logical replay does not advance twice')
  const sheetRowAfterReplay = ((await call('GET', '/artifacts', undefined, { 'x-tenant-id': OWNER })).json as ArtifactItem[]).find((row) => row.id === sheet.id)
  assert.equal(sheetRowAfterReplay?.editedAt, sheetRowAfterEdit.editedAt, 'logical replay keeps the first committed edit time')

  const slideEdit = await call('PATCH', `/artifacts/${slide.id}/content`, { content: slideNext, expectedRevision: 0 }, { 'x-tenant-id': OWNER, 'idempotency-key': `structured-edit-slide-${stamp}` })
  assert.equal(slideEdit.status, 200)
  assert.equal(slideEdit.json.revision, 1)
  assert.deepEqual(await artifactBody(slide.id), { ...slideNext, revision: 1 })
  const slideRowAfterEdit = ((await call('GET', '/artifacts', undefined, { 'x-tenant-id': OWNER })).json as ArtifactItem[]).find((row) => row.id === slide.id)
  assert.ok(slideRowAfterEdit)
  assert.equal(slideRowAfterEdit.editedAt, editNow, 'slide body recency is projected through the artifact registry')
  assert.equal(slideRowAfterEdit.metadataRevision, originalSlideRow.metadataRevision)

  const stale = await call('PATCH', `/artifacts/${sheet.id}/content`, { content: { ...sheetNext, rows: [['Stale', '0']] }, expectedRevision: 0 }, { 'x-tenant-id': OWNER })
  assert.equal(stale.status, 409)
  assert.deepEqual(await artifactBody(sheet.id), { ...sheetNext, revision: 1 })

  for (const [artifact, row] of [[sheet, originalSheetRow], [slide, originalSlideRow]] as const) {
    const current = ((await call('GET', '/artifacts', undefined, { 'x-tenant-id': OWNER })).json as ArtifactItem[]).find((candidate) => candidate.id === artifact.id)
    assert.deepEqual(current?.saveOrigin, row.saveOrigin, 'body edit preserves independent save origin')
  }
  const sheetGrants = await call('GET', `/grants?kind=artifact&id=${sheet.id}`, undefined, { 'x-tenant-id': OWNER })
  const slideGrants = await call('GET', `/grants?kind=artifact&id=${slide.id}`, undefined, { 'x-tenant-id': OWNER })
  assert.equal(sheetGrants.status, 200)
  assert.equal(slideGrants.status, 200)
  assert.ok((sheetGrants.json as Array<{ id: string }>).some((grant) => grant.id === sheetGrant.json.id))
  assert.ok((slideGrants.json as Array<{ id: string }>).some((grant) => grant.id === slideGrant.json.id))

  const sheetExport = await call('GET', `/artifacts/${sheet.id}/export?format=xlsx`, undefined, { 'x-tenant-id': OWNER })
  assert.equal(sheetExport.status, 200)
  assert.equal(sheetExport.json.filename, `renamed-${stamp}.xlsx`)
  const sheetFiles = await zipTexts(sheetExport.json.content)
  assert.match(sheetFiles['xl/sharedStrings.xml'], /Edited Ada/)
  const slideExport = await call('GET', `/artifacts/${slide.id}/export?format=pptx`, undefined, { 'x-tenant-id': OWNER })
  assert.equal(slideExport.status, 200)
  const slideFiles = await zipTexts(slideExport.json.content)
  assert.match(slideFiles['ppt/slides/slide1.xml'], /Edited launch/)
  assert.match(slideFiles['ppt/slides/slide1.xml'], /Edited bullet/)

  const readerSheet = await artifactBody(sheet.id, READER)
  const readerSlide = await artifactBody(slide.id, READER)
  assert.deepEqual(readerSheet, { ...sheetNext, revision: 1 })
  assert.deepEqual(readerSlide, { ...slideNext, revision: 1 })
  assert.equal((await call('PATCH', `/artifacts/${sheet.id}/content`, { content: sheetNext, expectedRevision: 1 }, { 'x-tenant-id': READER })).status, 404)
  assert.equal((await call('PATCH', `/artifacts/${slide.id}/content`, { content: slideNext, expectedRevision: 1 }, { 'x-tenant-id': FOREIGN })).status, 404)
})

test('structured body PATCH is strict, atomic, and cannot change artifact kind', async () => {
  const stamp = Date.now().toString(36)
  const sheet = await createStructured(`strict-${stamp}.csv`, 'sheet', { type: 'sheet', columns: ['A'], rows: [['ok']] })
  const before = await artifactBody(sheet.id)
  const cases: Array<{ label: string; body: unknown }> = [
    { label: 'missing expectedRevision', body: { content: { type: 'sheet', columns: ['A'], rows: [['missing']] } } },
    { label: 'null content', body: { content: null, expectedRevision: 0 } },
    { label: 'array content', body: { content: [], expectedRevision: 0 } },
    { label: 'unknown body field', body: { content: { type: 'sheet', columns: ['A'], rows: [['unknown']], extra: true }, expectedRevision: 0 } },
    { label: 'mixed legacy and structured patch', body: { block: 0, text: 'legacy', content: { type: 'sheet', columns: ['A'], rows: [['mixed']] }, expectedRevision: 0 } },
    { label: 'kind change', body: { content: { type: 'slides', slides: [{ title: 'wrong', bullets: [] }] }, expectedRevision: 0 } },
    { label: 'malformed structured body', body: { content: { type: 'sheet', columns: ['A', 'B'], rows: [['sparse']] }, expectedRevision: 0 } },
  ]
  for (const candidate of cases) {
    const response = await call('PATCH', `/artifacts/${sheet.id}/content`, candidate.body, { 'x-tenant-id': OWNER })
    assert.equal(response.status, 400, candidate.label)
    assert.deepEqual(await artifactBody(sheet.id), before, `${candidate.label}: body unchanged`)
  }
  assert.equal((await call('PATCH', `/artifacts/${sheet.id}/content`, { content: null, expectedRevision: 0 }, { 'x-tenant-id': READER })).status, 404, 'reader null body remains behind ownership wall')
  assert.equal((await call('PATCH', `/artifacts/${sheet.id}/content`, [], { 'x-tenant-id': FOREIGN })).status, 404, 'foreign array body remains behind ownership wall')
})

test('structured body PATCH refuses metadata-only rows without minting content', async () => {
  const stamp = Date.now().toString(36)
  const saved = await createStructured(`metadata-only-${stamp}.csv`, 'sheet')
  assert.equal(await artifactBody(saved.id), undefined)
  const edited = await call('PATCH', `/artifacts/${saved.id}/content`, { content: { type: 'sheet', columns: ['A'], rows: [['now']] }, expectedRevision: 0 }, { 'x-tenant-id': OWNER })
  assert.equal(edited.status, 400)
  assert.equal(await artifactBody(saved.id), undefined)
  const exported = await call('GET', `/artifacts/${saved.id}/export?format=xlsx`, undefined, { 'x-tenant-id': OWNER })
  assert.equal(exported.status, 409)
})

test('body-bearing document saves reject names that cannot survive metadata persistence', async () => {
  const before = (await call('GET', '/artifacts', undefined, { 'x-tenant-id': OWNER })).json
  for (const name of ['x'.repeat(241), 'unsafe\u0000name.md', 'unsafe\u202ename.md']) {
    const response = await call('POST', '/relations/ops', {
      op: { kind: 'save-artifact', artifact: { name, kind: 'doc', meta: 'Document', body: 'Preserved prose.' } },
    }, { 'x-tenant-id': OWNER })
    assert.equal(response.status, 400, JSON.stringify(name))
  }
  assert.deepEqual((await call('GET', '/artifacts', undefined, { 'x-tenant-id': OWNER })).json, before)
})
