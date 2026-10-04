import assert from 'node:assert/strict'
import { test } from 'node:test'
import { store } from '../store/index.ts'
import { call } from '../testkit/http.ts'

test('cached Artifact, graph and social success cannot disclose retained content after Trash', async () => {
  const tenant = 'tenant-trash-replay-owner'
  const owner = { 'x-tenant-id': tenant }
  const created = await call('POST', '/artifacts', { name: 'Cached Trash artifact.md', kind: 'doc', body: 'Original cached body.' }, { ...owner, 'idempotency-key': 'trash-replay-create' })
  assert.equal(created.status, 201)
  const id = created.json.artifact.id
  const subject = { kind: 'artifact', id }
  const operations: Array<{ method: string; path: string; body: unknown; key: string }> = []
  async function prime(method: string, path: string, body: unknown) {
    const key = `trash-replay-operation-${operations.length}`
    const headers = { ...owner, 'idempotency-key': key }
    const first = await call(method, path, body, headers)
    assert.ok(first.status >= 200 && first.status < 300, `${path}: ${JSON.stringify(first.json)}`)
    const replay = await call(method, path, { ignoredRetryBody: true }, headers)
    assert.equal(replay.headers['idempotency-replayed'], 'true', `${path}: prerequisite actually populated cache`)
    assert.deepEqual(replay.json, first.json)
    operations.push({ method, path, body, key })
    return first.json
  }
  await prime('PATCH', `/artifacts/${id}/content`, { block: 0, text: 'Private edited body.', expectedRevision: 0 })
  await prime('PATCH', `/artifacts/${id}`, { name: 'Private cached name.md', expectedRevision: 0 })
  await prime('POST', '/grants', { subject, audience: { kind: 'link' }, tier: 'view' })
  const discussion = await prime('POST', '/discussions', { anchor: { ref: subject }, firstPost: 'Private initial post.' })
  const replied = await prime('POST', `/discussions/${discussion.id}/posts`, { body: 'Private reply.' })
  await prime('POST', `/discussions/${discussion.id}/posts/${discussion.posts[0].id}/react`, { reacted: true })
  await prime('POST', `/discussions/${discussion.id}/posts/${discussion.posts[0].id}/report`, {})
  await prime('DELETE', `/discussions/${discussion.id}/posts/${replied.posts.at(-1).id}`, undefined)
  await prime('POST', `/discussions/${discussion.id}/resolve`, { state: 'resolved', expectedStateRevision: 0 })
  const offer = await call('POST', '/proposals', { subject, delta: { kind: 'suggestion', text: 'Private proposal.' }, rationale: 'Preserve its ledger.' }, owner)
  assert.equal(offer.status, 200)
  await prime('POST', `/proposals/${offer.json.id}/land`, undefined)
  const decline = await call('POST', '/proposals', { subject, delta: { kind: 'suggestion', text: 'Private declined proposal.' }, rationale: 'Preserve this ledger too.' }, owner)
  assert.equal(decline.status, 200)
  await prime('POST', `/proposals/${decline.json.id}/decline`, undefined)
  await prime('POST', '/relations/ops', { op: { kind: 'refile-artifact', artifactId: id, artifactName: 'Private cached name.md', projectId: null, projectName: '' } })
  await prime('POST', '/projects', { name: 'A cached full-graph creation' })
  store.setArtifactLifecycle(id, 'trashed', 0, tenant)
  for (const op of operations) {
    const retry = await call(op.method, op.path, { anotherIgnoredBody: true }, { ...owner, 'idempotency-key': op.key })
    assert.equal(retry.status, 404, `${op.path}: replays must recheck current visibility`)
    assert.equal(retry.headers['idempotency-replayed'], undefined)
    assert.equal(JSON.stringify(retry.json).includes('Private'), false)
  }
  store.setArtifactLifecycle(id, 'active', 1, tenant)
  for (const op of operations) {
    const retry = await call(op.method, op.path, op.body, { ...owner, 'idempotency-key': op.key })
    assert.equal(retry.headers['idempotency-replayed'], 'true', `${op.path}: refusal did not erase receipt or rerun effects`)
  }
  assert.equal(store.artifactContent(tenant)[id]?.revision, 1, 'body edit never ran twice')
})

test('an in-flight duplicate rechecks access after waiting for the original mutation', async () => {
  const tenant = 'tenant-trash-inflight-owner'
  const owner = { 'x-tenant-id': tenant }
  const created = await call('POST', '/artifacts', { name: 'In-flight Trash.md', kind: 'doc', body: 'Before.' }, { ...owner, 'idempotency-key': 'inflight-create' })
  assert.equal(created.status, 201)
  const id = created.json.artifact.id
  let marked = false
  const off = store.subscribe((event) => {
    if (event.type !== 'artifact.changed' || event.artifactId !== id || marked) return
    marked = true
    queueMicrotask(() => store.setArtifactLifecycle(id, 'trashed', 0, tenant))
  })
  try {
    const headers = { ...owner, 'idempotency-key': 'inflight-content' }
    const body = { block: 0, text: 'Saved before Trash.', expectedRevision: 0 }
    const [original, waiter] = await Promise.all([
      call('PATCH', `/artifacts/${id}/content`, body, headers),
      call('PATCH', `/artifacts/${id}/content`, body, headers),
    ])
    assert.equal(original.status, 200)
    assert.equal(marked, true)
    assert.equal(waiter.status, 404, 'a completed wait is not a visibility lease')
    assert.equal(waiter.headers['idempotency-replayed'], undefined)
  } finally { off() }
})
