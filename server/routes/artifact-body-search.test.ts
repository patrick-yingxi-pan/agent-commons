import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ArtifactItem } from '../../contract/index.ts'
import { call } from '../testkit/http.ts'

const owner = 'tenant-artifact-body-search-owner'
const reader = 'tenant-beta'
const foreign = 'tenant-growthworks'
const headers = (tenant: string, extra: Record<string, string> = {}) => ({ 'x-tenant-id': tenant, ...extra })
let serial = 0

async function createArtifact(name: string, kind: 'doc' | 'sheet' | 'slide', body: unknown, tenant = owner) {
  const key = `artifact-body-search-${Date.now()}-${++serial}`
  const response = await call('POST', '/artifacts', { name, kind, body }, headers(tenant, { 'idempotency-key': key }))
  assert.equal(response.status, 201, JSON.stringify(response.json))
  return response.json.artifact as ArtifactItem
}

const search = (query: string, offset = 0, tenant = owner) => {
  const params = new URLSearchParams({ q: query, type: 'artifact', offset: String(offset) })
  return call('GET', `/search?${params}`, undefined, headers(tenant))
}

function hits(response: { json: any }) {
  return response.json.groups[0].hits as Array<{ id: string; title: string; subtitle: string }>
}

test('ordinary Artifact search matches later Document blocks and every structured body field', async () => {
  const stamp = `${Date.now()}-${++serial}`
  const document = await createArtifact(`later-doc-${stamp}.md`, 'doc', `First excerpt only.\n\nA later paragraph contains body-doc-${stamp}.`)
  const sheet = await createArtifact(`later-sheet-${stamp}.csv`, 'sheet', {
    type: 'sheet', columns: ['Name', 'Value'], rows: [['Ada', `body-sheet-cell-${stamp}`]], note: `body-sheet-note-${stamp}`,
  })
  const workbook = await createArtifact(`later-workbook-${stamp}.xlsx`, 'sheet', {
    type: 'workbook', sheets: [
      { id: 'overview', name: 'Overview', columns: ['Metric'], rows: [['ordinary']] },
      { id: 'details', name: 'Details', columns: ['Metric', 'Value'], rows: [['Later', `body-workbook-cell-${stamp}`]], note: `body-workbook-note-${stamp}` },
    ],
  })
  const slides = await createArtifact(`later-slides-${stamp}.slides`, 'slide', {
    type: 'slides', slides: [
      { title: 'Opening', bullets: ['Visible opening'] },
      { title: `body-slide-title-${stamp}`, bullets: [`body-slide-bullet-${stamp}`] },
    ],
  })

  const cases = [
    [`body-doc-${stamp}`, document.id],
    [`body-sheet-cell-${stamp}`, sheet.id],
    [`body-sheet-note-${stamp}`, sheet.id],
    [`body-workbook-cell-${stamp}`, workbook.id],
    [`body-workbook-note-${stamp}`, workbook.id],
    [`body-slide-title-${stamp}`, slides.id],
    [`body-slide-bullet-${stamp}`, slides.id],
  ] as const
  for (const [query, expectedId] of cases) {
    const response = await search(query)
    assert.equal(response.status, 200)
    assert.ok(hits(response).some((hit) => hit.id === expectedId), `${query} should locate its exact current Artifact`)
  }
})

test('current-body match snippets stay bounded and retain the original matching text near the end', async () => {
  const stamp = `${Date.now()}-${++serial}`
  const query = `bounded-body-match-${stamp}`
  const longText = `${'preface '.repeat(120)}${query} ${'tail '.repeat(120)}`
  const artifact = await createArtifact(`bounded-${stamp}.md`, 'doc', longText)
  const response = await search(query)
  const hit = hits(response).find((candidate) => candidate.id === artifact.id)
  assert.ok(hit, 'a match near the end of a long current body remains findable')
  assert.ok(hit.subtitle.length <= 320, 'body previews are bounded')
  assert.ok(hit.subtitle.includes(query), 'the bounded preview preserves the matched text')
})

test('ordinary body search follows current artifact grants and revocation, not foreign visibility', async () => {
  const stamp = `${Date.now()}-${++serial}`
  const query = `shared-current-body-${stamp}`
  const artifact = await createArtifact(`shared-${stamp}.md`, 'doc', `First paragraph.\n\n${query}`)
  const grant = await call('POST', '/grants', {
    subject: { kind: 'artifact', id: artifact.id }, audience: { kind: 'org', orgId: reader }, tier: 'view',
  }, headers(owner))
  assert.equal(grant.status, 200)

  for (const tenant of [owner, reader]) {
    const response = await search(query, 0, tenant)
    assert.ok(hits(response).some((hit) => hit.id === artifact.id), `${tenant} can find the readable body`)
  }
  const privateResult = await search(query, 0, foreign)
  assert.equal(privateResult.json.groups[0].total, 0, 'an unrelated tenant cannot search private body text')

  const revoked = await call('DELETE', `/grants/${grant.json.id}`, undefined, headers(owner))
  assert.equal(revoked.status, 200)
  const afterRevocation = await search(query, 0, reader)
  assert.equal(afterRevocation.json.groups[0].total, 0, 'body search rechecks the live grant on every request')
})

test('ordinary body search tracks edits and excludes history-only and trashed content', async () => {
  const stamp = `${Date.now()}-${++serial}`
  const historical = `old-body-search-${stamp}`
  const current = `new-body-search-${stamp}`
  const artifact = await createArtifact(`edited-${stamp}.md`, 'doc', `Unchanged opening excerpt.\n\n${historical}`)
  const edited = await call('PATCH', `/artifacts/${artifact.id}/content`, {
    block: 1, text: current, expectedRevision: 0,
  }, headers(owner))
  assert.equal(edited.status, 200)

  const currentResult = await search(current)
  assert.ok(hits(currentResult).some((hit) => hit.id === artifact.id))
  const oldOrdinary = await search(historical)
  assert.equal(oldOrdinary.json.groups[0].total, 0, 'old-only text is not included in ordinary search')
  const explicitHistory = await call('GET', `/search?${new URLSearchParams({ q: historical, type: 'artifactVersion' })}`, undefined, headers(owner))
  assert.ok(explicitHistory.json.groups[0].hits.some((hit: any) => hit.id === artifact.id), 'history remains available only through its explicit category')

  const trashed = await call('PATCH', `/artifacts/${artifact.id}/lifecycle`, { state: 'trashed', expectedRevision: 0 }, headers(owner))
  assert.equal(trashed.status, 200)
  const afterTrash = await search(current)
  assert.equal(afterTrash.json.groups[0].total, 0, 'Trash bodies do not enter ordinary Artifact search')
})

test('ordinary body hits retain exact ids for same-name Artifacts and page with true totals/order', async () => {
  const stamp = `${Date.now()}-${++serial}`
  const duplicateName = `same-name-${stamp}.md`
  const needle = `exact-body-only-${stamp}`
  const matching = await createArtifact(duplicateName, 'doc', `First body.\n\n${needle}`)
  const nonmatching = await createArtifact(duplicateName, 'doc', 'A separate body with no matching text.')
  const duplicateSearch = await search(needle)
  assert.deepEqual(hits(duplicateSearch).map((hit) => hit.id), [matching.id], 'same-name content is never borrowed between exact identities')
  assert.notEqual(matching.id, nonmatching.id)

  const manyNeedle = `paged-current-body-${stamp}`
  const created: string[] = []
  for (let index = 0; index < 23; index += 1) {
    const artifact = await createArtifact(`paged-${stamp}-${index}.md`, 'doc', `Opening.\n\n${manyNeedle} row-${index}`)
    created.push(artifact.id)
  }
  const listed = (await call('GET', '/artifacts', undefined, headers(owner))).json as ArtifactItem[]
  const expectedOrder = listed.filter((row) => created.includes(row.id)).map((row) => row.id)
  const pages = await Promise.all([0, 20, 40].map((offset) => search(manyNeedle, offset)))
  assert.deepEqual(pages.map((page) => page.status), [200, 200, 200])
  assert.deepEqual(pages.flatMap((page) => hits(page).map((hit) => hit.id)), expectedOrder)
  assert.deepEqual(pages.map((page) => page.json.groups[0].total), [23, 23, 23])
  assert.deepEqual(pages.map((page) => hits(page).length), [20, 3, 0])
})
