import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ArtifactContentLibrary, ArtifactItem } from '../../contract/index.ts'
import { call } from '../testkit/http.ts'

const OWNER = 'tenant-personal'
const READER = 'tenant-beta'
const FOREIGN = 'tenant-growthworks'

test('one workbook identity carries every tab through owner CAS, shared reads, and the write wall', async () => {
  const stamp = Date.now().toString(36)
  const name = `workbook-${stamp}.xlsx`
  const body = {
    type: 'workbook',
    sheets: [
      { id: 'overview', name: 'Overview', columns: ['Metric', 'Value'], rows: [['Users', '42']] },
      { id: 'detail', name: 'Detail', columns: ['Metric', 'Value'], rows: [['Formula', '=SUM(A1:A2)']], note: 'Literal only.' },
    ],
  }
  const graphBeforeInvalid = (await call('GET', '/relations', undefined, { 'x-tenant-id': OWNER })).json
  const invalid = await call('POST', '/artifacts', {
    name: `invalid-${name}`, kind: 'sheet', body: { ...body, sheets: [body.sheets[0], { ...body.sheets[1], name: 'overview' }] },
  }, { 'x-tenant-id': OWNER, 'idempotency-key': `workbook-invalid-${stamp}` })
  assert.equal(invalid.status, 400)
  assert.deepEqual((await call('GET', '/relations', undefined, { 'x-tenant-id': OWNER })).json, graphBeforeInvalid, 'invalid workbook creation does not mutate graph or registry')
  assert.equal(((await call('GET', '/artifacts', undefined, { 'x-tenant-id': OWNER })).json as ArtifactItem[]).some((artifact) => artifact.name === `invalid-${name}`), false)

  const created = await call('POST', '/artifacts', { name, kind: 'sheet', body, projectId: null }, {
    'x-tenant-id': OWNER, 'idempotency-key': `workbook-create-${stamp}`,
  })
  assert.equal(created.status, 201)
  const row = created.json.artifact as ArtifactItem
  assert.equal(row.kind, 'sheet')
  const ownerLibrary = (await call('GET', '/artifact-content', undefined, { 'x-tenant-id': OWNER })).json as ArtifactContentLibrary
  assert.deepEqual(ownerLibrary[row.id], { ...body, revision: 0 })

  const grant = await call('POST', '/grants', {
    subject: { kind: 'artifact', id: row.id }, audience: { kind: 'org', orgId: READER }, tier: 'view',
  }, { 'x-tenant-id': OWNER })
  assert.equal(grant.status, 200)
  const readerBefore = (await call('GET', '/artifact-content', undefined, { 'x-tenant-id': READER })).json as ArtifactContentLibrary
  assert.deepEqual(readerBefore[row.id], ownerLibrary[row.id], 'one grant exposes the exact workbook and all ordered tabs')
  const foreignBefore = (await call('GET', '/artifact-content', undefined, { 'x-tenant-id': FOREIGN })).json as ArtifactContentLibrary
  assert.equal(foreignBefore[row.id], undefined)

  const edited = structuredClone(body)
  edited.sheets[1]!.rows[0]![1] = 'updated literal'
  const edit = await call('PATCH', `/artifacts/${row.id}/content`, { content: edited, expectedRevision: 0 }, {
    'x-tenant-id': OWNER, 'idempotency-key': `workbook-edit-${stamp}`,
  })
  assert.equal(edit.status, 200)
  assert.deepEqual(await bodyFor(row.id, OWNER), { ...edited, revision: 1 })
  assert.deepEqual(await bodyFor(row.id, READER), { ...edited, revision: 1 })

  const stale = await call('PATCH', `/artifacts/${row.id}/content`, { content: body, expectedRevision: 0 }, { 'x-tenant-id': OWNER })
  assert.equal(stale.status, 409)
  const malformed = await call('PATCH', `/artifacts/${row.id}/content`, {
    content: { ...edited, sheets: [edited.sheets[0], { ...edited.sheets[1], columns: [] }] }, expectedRevision: 1,
  }, { 'x-tenant-id': OWNER })
  assert.equal(malformed.status, 400)
  const demotion = await call('PATCH', `/artifacts/${row.id}/content`, {
    content: { type: 'sheet', columns: ['Only'], rows: [['Would discard Detail']] }, expectedRevision: 1,
  }, { 'x-tenant-id': OWNER })
  assert.equal(demotion.status, 400, 'a workbook cannot be replaced by a legacy one-tab body')
  assert.deepEqual(await bodyFor(row.id, OWNER), { ...edited, revision: 1 }, 'all refused writes preserve the committed tabs')
  assert.equal((await call('PATCH', `/artifacts/${row.id}/content`, { content: edited, expectedRevision: 1 }, { 'x-tenant-id': READER })).status, 404)
  assert.equal((await call('PATCH', `/artifacts/${row.id}/content`, { content: edited, expectedRevision: 1 }, { 'x-tenant-id': FOREIGN })).status, 404)
})

test('a legacy single-sheet artifact can be promoted once into a workbook under the same identity', async () => {
  const stamp = Date.now().toString(36)
  const created = await call('POST', '/artifacts', {
    name: `promote-${stamp}.xlsx`, kind: 'sheet', body: { type: 'sheet', columns: ['A'], rows: [['legacy']] },
  }, { 'x-tenant-id': OWNER, 'idempotency-key': `promote-create-${stamp}` })
  assert.equal(created.status, 201)
  const id = created.json.artifact.id as string
  const promoted = {
    type: 'workbook',
    sheets: [{ id: 'sheet-1', name: 'Sheet', columns: ['A'], rows: [['legacy']] },
      { id: 'details', name: 'Details', columns: ['B'], rows: [['new tab']] }],
  }
  const edit = await call('PATCH', `/artifacts/${id}/content`, { content: promoted, expectedRevision: 0 }, {
    'x-tenant-id': OWNER, 'idempotency-key': `promote-edit-${stamp}`,
  })
  assert.equal(edit.status, 200)
  assert.deepEqual(await bodyFor(id), { ...promoted, revision: 1 })
})

async function bodyFor(id: string, tenant = OWNER) {
  const library = (await call('GET', '/artifact-content', undefined, { 'x-tenant-id': tenant })).json as ArtifactContentLibrary
  return library[id]
}
