import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ArtifactItem } from '../../contract/index.ts'
import { call } from '../testkit/http.ts'

let rpcId = 0
async function mcpTool(name: string, args: Record<string, unknown>, headers?: Record<string, string>) {
  const response = await call('POST', '/mcp', {
    jsonrpc: '2.0', id: ++rpcId, method: 'tools/call',
    params: { name, arguments: args },
  }, headers)
  const result = response.json.result
  const parsed = JSON.parse(result.content[0].text) as { status: number; body: any }
  return { status: parsed.status, body: parsed.body, isError: result.isError === true }
}

test('HTTP authored sheet and slides expose exact id-keyed structured content and revision zero', async () => {
  const stamp = Date.now().toString(36)
  const sheetBody = { type: 'sheet', columns: ['Name', 'Value'], rows: [['Ada', '=1+1']], note: 'Literal' }
  const slideBody = { type: 'slides', slides: [{ title: 'Launch', bullets: ['One', 'Two'] }] }
  const sheetResponse = await call('POST', '/relations/ops', { op: { kind: 'save-artifact', artifact: { name: `route-${stamp}.csv`, kind: 'sheet', meta: 'Sheet', body: sheetBody } } }, { 'x-tenant-id': 'tenant-personal', 'idempotency-key': `structured-sheet-${stamp}` })
  const slideResponse = await call('POST', '/relations/ops', { op: { kind: 'save-artifact', artifact: { name: `route-${stamp}.slides`, kind: 'slide', meta: 'Slides', body: slideBody } } }, { 'x-tenant-id': 'tenant-personal', 'idempotency-key': `structured-slide-${stamp}` })
  assert.equal(sheetResponse.status, 200)
  assert.equal(slideResponse.status, 200)
  const sheet = (sheetResponse.json.extraArtifacts as ArtifactItem[]).find((row) => row.name === `route-${stamp}.csv`)
  const slides = (slideResponse.json.extraArtifacts as ArtifactItem[]).find((row) => row.name === `route-${stamp}.slides`)
  assert.ok(sheet && slides)
  const library = (await call('GET', '/artifact-content', undefined, { 'x-tenant-id': 'tenant-personal' })).json
  assert.deepEqual(library[sheet.id], { ...sheetBody, revision: 0 })
  assert.deepEqual(library[slides.id], { ...slideBody, revision: 0 })
  assert.equal(library[sheet.id].rows[0][1], '=1+1')
  const grant = await call('POST', '/grants', { subject: { kind: 'artifact', id: sheet.id }, audience: { kind: 'org', orgId: 'tenant-beta' }, tier: 'view' }, { 'x-tenant-id': 'tenant-personal' })
  assert.equal(grant.status, 200)
  const readerLibrary = (await call('GET', '/artifact-content', undefined, { 'x-tenant-id': 'tenant-beta' })).json
  assert.deepEqual(readerLibrary[sheet.id], library[sheet.id], 'a granted reader receives the exact structured body')
  const foreignLibrary = (await call('GET', '/artifact-content', undefined, { 'x-tenant-id': 'tenant-growthworks' })).json
  assert.equal(foreignLibrary[sheet.id], undefined, 'a foreign tenant receives no structured body')
  for (const id of [sheet.id, slides.id]) {
    const exported = await call('GET', `/artifacts/${id}/export`, undefined, { 'x-tenant-id': 'tenant-personal' })
    assert.equal(exported.status, 409, 'Markdown export refuses rich artifact bodies')
    assert.equal(exported.json.error.code, 'capability_unavailable')
  }
  assert.equal((await call('DELETE', `/grants/${grant.json.id}`, undefined, { 'x-tenant-id': 'tenant-personal' })).status, 200)
  assert.equal((await call('GET', '/artifact-content', undefined, { 'x-tenant-id': 'tenant-beta' })).json[sheet.id], undefined, 'revocation withdraws the structured body')
})

test('HTTP structured validation is atomic and enforces the sheet/slide shape-kind boundary', async () => {
  const stamp = Date.now().toString(36)
  const before = (await call('GET', '/artifacts', undefined, { 'x-tenant-id': 'tenant-personal' })).json as ArtifactItem[]
  const malformed = await call('POST', '/relations/ops', { op: { kind: 'save-artifact', artifact: { name: `invalid-${stamp}.csv`, kind: 'sheet', meta: 'Sheet', body: { type: 'slides', slides: [] } } } }, { 'x-tenant-id': 'tenant-personal', 'idempotency-key': `structured-invalid-${stamp}` })
  assert.equal(malformed.status, 400)
  const after = (await call('GET', '/artifacts', undefined, { 'x-tenant-id': 'tenant-personal' })).json as ArtifactItem[]
  assert.equal(after.some((row) => row.name === `invalid-${stamp}.csv`), false)
  assert.equal(after.length, before.length)
})

test('generated MCP creates and reads the same structured artifact projection, including rich-export refusal', async () => {
  const stamp = Date.now().toString(36)
  const tenant = 'tenant-personal'
  const body = { type: 'sheet', columns: ['Name', 'Value'], rows: [['Ada', '=1+1']] }
  const created = await mcpTool('post_relations_ops', {
    body: { op: { kind: 'save-artifact', artifact: { name: `mcp-${stamp}.csv`, kind: 'sheet', meta: 'Sheet', body } } },
  }, { 'x-tenant-id': tenant, 'idempotency-key': `structured-mcp-${stamp}` })
  assert.equal(created.status, 200)
  const row = (created.body.extraArtifacts as ArtifactItem[]).find((candidate) => candidate.name === `mcp-${stamp}.csv`)
  assert.ok(row)
  const content = await mcpTool('get_artifact_content', {}, { 'x-tenant-id': tenant })
  assert.equal(content.status, 200)
  assert.deepEqual(content.body[row.id], { ...body, revision: 0 })
  const exported = await mcpTool('get_artifacts_by_id_export', { id: row.id }, { 'x-tenant-id': tenant })
  assert.equal(exported.status, 409)
  assert.equal(exported.body.error.code, 'capability_unavailable')
  assert.equal(exported.isError, true)
})

test('save-artifact rejects primitive metadata for every authored kind before graph or body mutation', async () => {
  const stamp = Date.now().toString(36)
  const bodies = {
    doc: 'A valid document body.\n\nA second paragraph.',
    sheet: { type: 'sheet', columns: ['A'], rows: [['x']] },
    slide: { type: 'slides', slides: [{ title: 'Slide', bullets: ['x'] }] },
  } as const
  const beforeGraph = (await call('GET', '/relations', undefined, { 'x-tenant-id': 'tenant-personal' })).json
  const beforeContent = (await call('GET', '/artifact-content', undefined, { 'x-tenant-id': 'tenant-personal' })).json
  const cases: Array<{ kind: keyof typeof bodies; field: 'meta' | 'excerpt'; value: unknown; label: string }> = []
  for (const kind of Object.keys(bodies) as Array<keyof typeof bodies>) {
    cases.push({ kind, field: 'meta', value: 17, label: `${kind} numeric meta` })
    cases.push({ kind, field: 'meta', value: null, label: `${kind} null meta` })
    cases.push({ kind, field: 'meta', value: undefined, label: `${kind} absent meta` })
    cases.push({ kind, field: 'excerpt', value: 17, label: `${kind} numeric excerpt` })
    cases.push({ kind, field: 'excerpt', value: null, label: `${kind} null excerpt` })
  }
  for (const [index, candidate] of cases.entries()) {
    const name = `invalid-metadata-${stamp}-${index}.${candidate.kind === 'doc' ? 'md' : candidate.kind === 'sheet' ? 'csv' : 'slides'}`
    const artifact: Record<string, unknown> = {
      name,
      kind: candidate.kind,
      meta: 'Document',
      body: bodies[candidate.kind],
    }
    if (candidate.field === 'meta') artifact.meta = candidate.value
    else artifact.excerpt = candidate.value
    const response = await call('POST', '/relations/ops', { op: { kind: 'save-artifact', artifact } }, { 'x-tenant-id': 'tenant-personal', 'idempotency-key': `invalid-metadata-${stamp}-${index}` })
    assert.equal(response.status, 400, candidate.label)
    assert.equal(response.json.error.code, 'bad_request', candidate.label)
    const afterGraph = (await call('GET', '/relations', undefined, { 'x-tenant-id': 'tenant-personal' })).json
    const afterContent = (await call('GET', '/artifact-content', undefined, { 'x-tenant-id': 'tenant-personal' })).json
    assert.deepEqual(afterGraph, beforeGraph, `${candidate.label}: graph unchanged`)
    assert.deepEqual(afterContent, beforeContent, `${candidate.label}: body library unchanged`)
  }
  const validWithoutExcerpt = await call('POST', '/relations/ops', {
    op: { kind: 'save-artifact', artifact: { name: `metadata-absent-excerpt-${stamp}.csv`, kind: 'sheet', meta: 'Sheet', body: bodies.sheet } },
  }, { 'x-tenant-id': 'tenant-personal', 'idempotency-key': `metadata-absent-excerpt-${stamp}` })
  assert.equal(validWithoutExcerpt.status, 200, 'excerpt is optional')
})
