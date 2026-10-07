import assert from 'node:assert/strict'
import { test } from 'node:test'
import { store } from '../store/index.ts'
import { call } from '../testkit/http.ts'

const owner = 'tenant-artifact-version-search-owner'
const reader = 'tenant-beta'
const foreign = 'tenant-growthworks'
const headers = (tenant: string, extra: Record<string, string> = {}) => ({ 'x-tenant-id': tenant, ...extra })
let serial = 0

async function createDocument(text: string) {
  const id = ++serial
  const created = await call('POST', '/artifacts', {
    name: `version-search-${Date.now()}-${id}.md`, kind: 'doc', body: text,
  }, headers(owner, { 'idempotency-key': `version-search-create-${Date.now()}-${id}` }))
  assert.equal(created.status, 201, JSON.stringify(created.json))
  return created.json.artifact as { id: string; name: string }
}

async function editFirstBlock(id: string, text: string, expectedRevision: number) {
  const response = await call('PATCH', `/artifacts/${id}/content`, {
    block: 0, text, expectedRevision,
  }, headers(owner))
  assert.equal(response.status, 200, JSON.stringify(response.json))
}

const search = (q: string, type?: string, offset?: number, tenant = owner) => {
  const params = new URLSearchParams()
  params.set('q', q)
  if (type) params.set('type', type)
  if (offset !== undefined) params.set('offset', String(offset))
  return call('GET', `/search?${params}`, undefined, headers(tenant))
}

test('historical Artifact text is opt-in and a hit exposes metadata plus a bounded snippet only', async () => {
  const stamp = Date.now()
  const oldText = `archived-only-${stamp}`
  const artifact = await createDocument(oldText)
  await editFirstBlock(artifact.id, `current-only-${stamp}`, 0)

  const overview = await search(oldText)
  assert.equal(overview.status, 200)
  assert.equal(overview.json.groups.some((group: any) => group.type === 'artifactVersion'), false,
    'default overview does not search historical bodies')
  assert.equal(overview.json.groups.some((group: any) => group.hits.some((hit: any) => hit.id === artifact.id)), false)

  const explicit = await search(oldText, 'artifactVersion')
  assert.equal(explicit.status, 200)
  assert.deepEqual(explicit.json.page, { type: 'artifactVersion', offset: 0 })
  const group = explicit.json.groups[0]
  assert.equal(group.type, 'artifactVersion')
  assert.equal(group.total, 1)
  assert.deepEqual(group.hits[0], {
    type: 'artifactVersion', id: artifact.id, title: artifact.name,
    subtitle: oldText, revision: 0, savedAt: null, reason: 'baseline', trashed: false,
    match: { revision: 0, field: 'doc.block.0.p' },
  })
  assert.equal(JSON.stringify(explicit.json).includes('current-only-'), false)
  assert.equal(Object.hasOwn(group.hits[0], 'body'), false)
})

test('artifact version category pages every retained revision newest-first with a true total', async () => {
  const needle = `all-revisions-${Date.now()}`
  const expected: Array<{ id: string; revision: number }> = []
  for (let index = 0; index < 11; index += 1) {
    const artifact = await createDocument(`${needle} initial ${index}`)
    await editFirstBlock(artifact.id, `${needle} edited ${index}`, 0)
    expected.push({ id: artifact.id, revision: 1 }, { id: artifact.id, revision: 0 })
  }
  expected.sort((a, b) => a.id.localeCompare(b.id) || b.revision - a.revision)

  const pages = await Promise.all([0, 20, 40].map((offset) => search(needle, 'artifactVersion', offset)))
  const beyond = await search(needle, 'artifactVersion', 80)
  const empty = await search('', 'artifactVersion')
  assert.deepEqual(pages.map((response) => response.status), [200, 200, 200])
  assert.deepEqual(pages.flatMap((response) => response.json.groups[0].hits.map((hit: any) => ({ id: hit.id, revision: hit.revision }))), expected)
  for (const [index, response] of pages.entries()) {
    assert.equal(response.json.groups.length, 1)
    assert.equal(response.json.groups[0].total, 22)
    assert.equal(response.json.groups[0].hits.length, index === 0 ? 20 : index === 1 ? 2 : 0)
    assert.deepEqual(response.json.page, { type: 'artifactVersion', offset: index * 20 })
  }
  assert.equal(beyond.json.groups[0].total, 22)
  assert.deepEqual(beyond.json.groups[0].hits, [])
  assert.equal(empty.json.groups[0].total, 0)
  assert.deepEqual(empty.json.groups[0].hits, [])
})

test('owner-only version search includes Trash, excludes shared and foreign readers, and forgets permanent deletion', async () => {
  const needle = `private-version-${Date.now()}`
  const artifact = await createDocument(`${needle} original`)
  await editFirstBlock(artifact.id, `${needle} current`, 0)
  const grant = await call('POST', '/grants', {
    subject: { kind: 'artifact', id: artifact.id },
    audience: { kind: 'org', orgId: reader }, tier: 'view',
  }, headers(owner))
  assert.equal(grant.status, 200)

  for (const tenant of [reader, foreign]) {
    const result = await search(needle, 'artifactVersion', 0, tenant)
    assert.equal(result.status, 200)
    assert.equal(result.json.groups[0].total, 0)
    assert.deepEqual(result.json.groups[0].hits, [])
  }

  const trash = await call('PATCH', `/artifacts/${artifact.id}/lifecycle`, {
    state: 'trashed', expectedRevision: 0,
  }, headers(owner))
  assert.equal(trash.status, 200)
  const trashed = await search(needle, 'artifactVersion')
  assert.equal(trashed.json.groups[0].total, 2)
  assert.ok(trashed.json.groups[0].hits.every((hit: any) => hit.trashed === true))

  const preview = await call('GET', `/artifacts/${artifact.id}/deletion-preview`, undefined, headers(owner))
  assert.equal(preview.status, 200)
  const deleted = await call('DELETE', `/artifacts/${artifact.id}`, {
    expectedLifecycleRevision: preview.json.lifecycleRevision,
    reviewToken: preview.json.reviewToken,
  }, headers(owner, { 'idempotency-key': `version-search-delete-${Date.now()}` }))
  assert.equal(deleted.status, 200)
  const afterDeletion = await search(needle, 'artifactVersion')
  assert.equal(afterDeletion.json.groups[0].total, 0)
  assert.deepEqual(afterDeletion.json.groups[0].hits, [])
})

test('artifact version search bounds trimmed query and preserves strict duplicate/page parameter policy', async () => {
  const tooLong = await search(`  ${'x'.repeat(257)}  `, 'artifactVersion')
  assert.equal(tooLong.status, 400)
  assert.equal(tooLong.json.error.code, 'bad_request')
  assert.throws(() => store.searchAll(owner, ` ${'x'.repeat(257)} `, { type: 'artifactVersion', offset: 0 }), /limited to 256/)
  assert.equal((await call('GET', '/search?q=x&type=artifactVersion&type=agent', undefined, headers(owner))).status, 400)
  assert.equal((await call('GET', '/search?q=x&offset=1', undefined, headers(owner))).status, 400)
})
