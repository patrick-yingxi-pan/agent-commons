import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ArtifactDeletionPreview, ArtifactDeletionResult } from '../../contract/artifactDeletion.ts'
import type { ArtifactItem } from '../../contract/cowork.ts'
import type { RelationGraph } from '../../contract/api.ts'
import type { ArtifactLifecycleSnapshot } from '../../contract/artifactLifecycle.ts'
import { API_BASE } from './client.ts'
import { keys, paths } from './keys.ts'
import { artifactHistoryKey } from './artifactHistoryKeys.ts'
import { peek, resetAll, setData } from './cache.ts'
import { acceptArtifactLifecycle, artifactLifecycleIsActive } from './artifactLifecycle.ts'
import { clearArtifactPermanentAbsences } from './artifactPermanentAbsences.ts'
import {
  deleteArtifactPermanently,
  readArtifactDeletionPreview,
  reconcileArtifactPermanentDeletion,
} from './artifactDeletion.ts'

const artifact: ArtifactItem = {
  id: 'delete/api artifact', name: 'reviewed.md', kind: 'doc', meta: 'Notes',
  source: 'Conversation', projectId: 'project-a', editedAt: 1, own: true, lifecycleRevision: 1,
}
const preview: ArtifactDeletionPreview = {
  artifactId: artifact.id,
  artifactName: artifact.name,
  lifecycleRevision: 1,
  reviewToken: 'a'.repeat(64),
  counts: { versions: 2, shares: 1, discussions: 3, proposals: 4 },
}
const response = (value: unknown, status = 200): Response => new Response(
  value === undefined ? undefined : JSON.stringify(value),
  { status, headers: { 'content-type': 'application/json' } },
)

test('deletion preview uses its declared path and initiating identity and validates the exact trashed subject', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch; clearArtifactPermanentAbsences(); resetAll() })
  let request: { url: string; method?: string; source: string | null } | undefined
  globalThis.fetch = async (input, init) => {
    request = {
      url: String(input),
      method: init?.method,
      source: new Headers(init?.headers).get('X-Account-Transition-Source'),
    }
    return response(preview)
  }
  assert.equal(paths.artifactDeletionPreview(artifact.id), '/artifacts/delete%2Fapi%20artifact/deletion-preview')
  assert.deepEqual(await readArtifactDeletionPreview(artifact.id, 'user-ada'), preview)
  assert.deepEqual(request, {
    url: `${API_BASE}${paths.artifactDeletionPreview(artifact.id)}`,
    method: 'GET',
    source: 'session:user-ada',
  })

  globalThis.fetch = async () => response({ ...preview, artifactId: 'another-artifact' })
  await assert.rejects(readArtifactDeletionPreview(artifact.id, 'user-ada'), /did not match/)
  globalThis.fetch = async () => response({ ...preview, lifecycleRevision: 2 })
  await assert.rejects(readArtifactDeletionPreview(artifact.id, 'user-ada'), /did not match/)
})

test('acknowledged permanent deletion sends exact review and publishes authoritative absence', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch; clearArtifactPermanentAbsences(); resetAll() })
  const graph: RelationGraph = {
    revision: 8,
    extraArtifacts: [artifact],
    artifactProject: { [artifact.id]: 'project-a' },
    artifactSource: { [artifact.id]: 'session-a' },
  } as RelationGraph
  setData(keys.artifacts, [artifact])
  setData(keys.artifactTrash, [{ artifact, trashedAt: 10 }])
  setData(keys.relations, graph)
  setData(keys.artifactContent, { [artifact.id]: { type: 'doc', title: 'Review', blocks: [] } })
  const lifecycle: ArtifactLifecycleSnapshot = { artifact, lifecycle: { state: 'trashed', revision: 1, changedAt: 10 } }
  setData(keys.artifactLifecycle(artifact.id), lifecycle)
  setData(`${artifactHistoryKey(artifact.id)}:newest`, { artifactId: artifact.id, privateBody: 'reviewed old version' })
  setData(`${artifactHistoryKey(artifact.id)}:version:0`, { artifactId: artifact.id, privateBody: 'older version' })
  let call: { url: string; method?: string; body?: string | null; key: string | null; source: string | null } | undefined
  const receipt: ArtifactDeletionResult = { artifactId: artifact.id, deleted: true }
  globalThis.fetch = async (input, init) => {
    call = {
      url: String(input),
      method: init?.method,
      body: init?.body as string | null | undefined,
      key: new Headers(init?.headers).get('Idempotency-Key'),
      source: new Headers(init?.headers).get('X-Account-Transition-Source'),
    }
    return response(receipt)
  }
  const request = { expectedLifecycleRevision: 1, reviewToken: preview.reviewToken }
  assert.deepEqual(await deleteArtifactPermanently(artifact.id, request, 'delete-logical-key', 'user-ada'), receipt)
  assert.deepEqual(call, {
    url: `${API_BASE}${paths.artifact(artifact.id)}`,
    method: 'DELETE',
    body: JSON.stringify(request),
    key: 'delete-logical-key',
    source: 'session:user-ada',
  })
  assert.deepEqual(peek(keys.artifacts), [])
  assert.deepEqual(peek(keys.artifactTrash), [])
  assert.deepEqual(peek<RelationGraph>(keys.relations)?.extraArtifacts, [])
  assert.deepEqual(peek<RelationGraph>(keys.relations)?.artifactProject, {})
  assert.deepEqual(peek<RelationGraph>(keys.relations)?.artifactSource, {})
  assert.equal(peek<RelationGraph>(keys.relations)?.revision, 8, 'absence does not mint a relation revision')
  assert.deepEqual(peek(keys.artifactContent), {})
  assert.equal(peek(keys.artifactLifecycle(artifact.id)), undefined)
  assert.equal(peek(`${artifactHistoryKey(artifact.id)}:newest`), undefined)
  assert.equal(peek(`${artifactHistoryKey(artifact.id)}:version:0`), undefined)

  // Even a delayed command/event acknowledgement with an old live row cannot
  // make the deleted identity eligible for relation consumers again.
  const activeSnapshot: ArtifactLifecycleSnapshot = { artifact: { ...artifact, lifecycleRevision: 2 }, lifecycle: { state: 'active', revision: 2, changedAt: 20 } }
  acceptArtifactLifecycle(activeSnapshot)
  setData(keys.relations, { ...graph, extraArtifacts: [artifact] })
  assert.equal(artifactLifecycleIsActive(artifact, undefined), false)
  assert.equal(peek(keys.artifactLifecycle(artifact.id)), undefined)
})

test('reconciliation proves deletion only from lifecycle 404 for the initiating account', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch; clearArtifactPermanentAbsences(); resetAll() })
  let source: string | null = null
  globalThis.fetch = async (_input, init) => {
    source = new Headers(init?.headers).get('X-Account-Transition-Source')
    return response({ error: { code: 'not_found', message: 'Artifact not found.' } }, 404)
  }
  assert.equal(await reconcileArtifactPermanentDeletion(artifact.id, 'user-ada'), true)
  assert.equal(source, 'session:user-ada')

  clearArtifactPermanentAbsences()
  globalThis.fetch = async () => response({ error: { code: 'internal', message: 'temporary read failure' } }, 503)
  await assert.rejects(reconcileArtifactPermanentDeletion(artifact.id, 'user-ada'), /temporary read failure/)
})
