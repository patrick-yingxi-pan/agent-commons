import assert from 'node:assert/strict'
import { test } from 'node:test'
import { docBlockText } from '../../contract/content.ts'
import { artifactCreationId } from '../artifactCreationIdentity.ts'
import { store } from '../store/index.ts'
import { call, callFresh } from '../testkit/http.ts'

const owner = 'tenant-artifact-history-route-owner'
const reader = 'tenant-beta'
const headers = (tenant: string, extra: Record<string, string> = {}) => ({ 'x-tenant-id': tenant, ...extra })

function createDocument(key: string) {
  const id = artifactCreationId(owner, key)
  const created = store.createArtifact({ name: `${key}.md`, kind: 'doc', body: 'Before restore.\n\nSecond paragraph.' }, owner, id)
  assert.ok(created && created !== 'invalid')
  return created.artifact
}

test('artifact history routes are owner-only, bounded, and expose only current bodies to shared reads', async () => {
  const artifact = createDocument(`history-route-${Date.now()}`)
  assert.ok(store.createGrant({ subject: { kind: 'artifact', id: artifact.id }, audience: { kind: 'org', orgId: reader }, tier: 'view' }, owner))
  const initial = store.artifactContent(owner)[artifact.id]!
  assert.equal(initial.type, 'doc')
  if (initial.type !== 'doc') return
  const original = docBlockText(initial.blocks[0]!)!
  store.updateArtifactBlock(artifact.id, 0, 'After the first edit.', 0)
  const listed = await call('GET', `/artifacts/${artifact.id}/history`, undefined, headers(owner))
  assert.equal(listed.status, 200)
  assert.deepEqual(listed.json.versions.map((entry: any) => entry.revision), [1, 0])
  assert.equal(Object.hasOwn(listed.json.versions[0], 'body'), false)
  assert.equal((await call('GET', `/artifacts/${artifact.id}/history?limit=51`, undefined, headers(owner))).status, 400)
  assert.equal((await call('GET', `/artifacts/${artifact.id}/history`, undefined, headers(reader))).status, 404)
  const details = await call('GET', `/artifacts/${artifact.id}/history/0`, undefined, headers(owner))
  assert.equal(details.json.version.body.blocks[0].p, original)
  assert.ok((await call('GET', '/artifact-content', undefined, headers(reader))).json[artifact.id], 'granted reader still receives current body')

  const key = `history-route-restore-${Date.now()}`
  const path = `/artifacts/${artifact.id}/history/0/restore`
  const restored = await call('POST', path, { expectedRevision: 1 }, headers(owner, { 'idempotency-key': key }))
  assert.equal(restored.status, 200)
  assert.equal(restored.json.currentRevision, 2)
  assert.equal(restored.json.version.reason, 'restore')
  const alteredRetry = await call('POST', path, { expectedRevision: 0 }, headers(owner, { 'idempotency-key': key }))
  assert.equal(alteredRetry.status, 409, 'durable restore key cannot replay altered body intent')

  store.updateArtifactBlock(artifact.id, 0, 'Current body after restore.', 2)
  const restartRetry = await callFresh('POST', path, { expectedRevision: 1 }, headers(owner, { 'idempotency-key': key }))
  assert.equal(restartRetry.status, 200)
  assert.equal(restartRetry.json.currentRevision, 3)
  assert.equal(restartRetry.json.version.revision, 2)
  const current = (await call('GET', '/artifact-content', undefined, headers(owner))).json[artifact.id]
  assert.equal(docBlockText(current.blocks[0]), 'Current body after restore.')
  const stale = await call('POST', `/artifacts/${artifact.id}/history/1/restore`, { expectedRevision: 1 }, headers(owner, { 'idempotency-key': `${key}-stale` }))
  assert.equal(stale.status, 409)
  assert.equal((await call('GET', `/artifacts/${artifact.id}/history`, undefined, headers(owner))).json.currentRevision, 3)
})

test('Artifact history restore honors account-source fencing and remains readable in Trash', async () => {
  const artifact = createDocument(`history-trash-route-${Date.now()}`)
  store.updateArtifactBlock(artifact.id, 0, 'Saved version.', 0)
  const staleSource = await call('POST', `/artifacts/${artifact.id}/history/0/restore`, { expectedRevision: 1 }, headers(owner, {
    'idempotency-key': `stale-source-${Date.now()}`, 'x-account-transition-source': 'session:not-current',
  }))
  assert.equal(staleSource.status, 409)
  store.setArtifactLifecycle(artifact.id, 'trashed', 0, owner)
  assert.equal((await call('GET', `/artifacts/${artifact.id}/history`, undefined, headers(owner))).status, 200)
  const restore = await call('POST', `/artifacts/${artifact.id}/history/0/restore`, { expectedRevision: 1 }, headers(owner, {
    'idempotency-key': `trash-restore-${Date.now()}`,
  }))
  assert.equal(restore.status, 409)
})

test('an exact committed restore receipt remains replayable after Trash', async () => {
  const artifact = createDocument(`history-trash-replay-${Date.now()}`)
  store.updateArtifactBlock(artifact.id, 0, 'Changed before restore.', 0)
  const path = `/artifacts/${artifact.id}/history/0/restore`
  const key = `restore-before-trash-${Date.now()}`
  const first = await call('POST', path, { expectedRevision: 1 }, headers(owner, { 'idempotency-key': key }))
  assert.equal(first.status, 200)
  store.setArtifactLifecycle(artifact.id, 'trashed', 0, owner)
  const replay = await callFresh('POST', path, { expectedRevision: 1 }, headers(owner, { 'idempotency-key': key }))
  assert.equal(replay.status, 200, 'lost-ack replay returns the exact prior receipt despite later Trash')
  assert.equal(replay.json.version.revision, first.json.version.revision)
})
