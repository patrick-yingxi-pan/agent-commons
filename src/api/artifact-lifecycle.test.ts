import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ArtifactItem } from '../../contract/cowork.ts'
import type { ArtifactLifecycleSnapshot } from '../../contract/artifactLifecycle.ts'
import type { RelationGraph } from '../../contract/api.ts'
import {
  acceptArtifactLifecycle,
  artifactLifecycleIsActive,
  isArtifactLifecycleActive,
  reconcileArtifactLifecycle,
  transitionArtifactLifecycle,
} from './artifactLifecycle.ts'
import { API_BASE } from './client.ts'
import { keys, paths } from './keys.ts'
import { peek, resetAll, setData } from './cache.ts'

const artifact: ArtifactItem = {
  id: 'lifecycle-api-artifact', name: 'notes.md', kind: 'doc', meta: 'Notes',
  source: 'Conversation', projectId: '', editedAt: 1, own: true,
}
const snapshot = (state: 'active' | 'trashed', revision: number): ArtifactLifecycleSnapshot => ({
  artifact,
  lifecycle: { state, revision, changedAt: revision * 10 },
})
const response = (value: unknown): Response => new Response(JSON.stringify(value), {
  status: 200,
  headers: { 'content-type': 'application/json' },
})

test('artifact lifecycle acknowledgements and reads cannot rewind a newer lifecycle projection', (t) => {
  t.after(() => resetAll())
  const newer = snapshot('active', 2)
  setData(keys.artifactLifecycle(artifact.id), newer)
  assert.equal(acceptArtifactLifecycle(snapshot('trashed', 1)), newer)
  assert.equal(peek(keys.artifactLifecycle(artifact.id)), newer)
})

test('accepted Trash/restore snapshots update cached lists and prune graph rows without changing graph revision', (t) => {
  t.after(() => resetAll())
  const row = { ...artifact, metadataRevision: 3, name: 'renamed.md' }
  const graph = {
    revision: 7,
    extraArtifacts: [row],
    artifactProject: { [artifact.id]: 'project-a' },
    artifactSource: { [artifact.id]: 'context-a' },
  } as RelationGraph
  setData(keys.artifacts, [row])
  setData(keys.relations, graph)
  setData(keys.artifactTrash, [])

  acceptArtifactLifecycle({ ...snapshot('trashed', 1), artifact: { ...artifact, metadataRevision: 2, name: 'old.md' } })
  assert.deepEqual(peek(keys.artifacts), [])
  assert.deepEqual(peek(keys.artifactTrash), [{ artifact: { ...row, lifecycleRevision: 1, saveOrigin: undefined }, trashedAt: 10 }])
  assert.deepEqual(peek<RelationGraph>(keys.relations)?.extraArtifacts, [])
  assert.deepEqual(peek<RelationGraph>(keys.relations)?.artifactProject, {})
  assert.deepEqual(peek<RelationGraph>(keys.relations)?.artifactSource, {})
  assert.equal(peek<RelationGraph>(keys.relations)?.revision, 7)

  acceptArtifactLifecycle(snapshot('active', 2))
  assert.deepEqual(peek(keys.artifactTrash), [])
  assert.deepEqual(peek(keys.artifacts), [{ ...row, lifecycleRevision: 2, saveOrigin: undefined }])
  assert.deepEqual(peek<RelationGraph>(keys.relations)?.extraArtifacts, [], 'restore waits for the authoritative graph refresh')
  assert.equal(peek<RelationGraph>(keys.relations)?.revision, 7)
})

test('a higher lifecycle revision on any cached artifact row fences a stale snapshot', (t) => {
  t.after(() => resetAll())
  const newerRow = { ...artifact, lifecycleRevision: 2 }
  setData(keys.artifacts, [newerRow])
  const accepted = acceptArtifactLifecycle(snapshot('trashed', 1))
  assert.equal(accepted.lifecycle.state, 'active')
  assert.equal(accepted.lifecycle.revision, 2)
  assert.deepEqual(peek(keys.artifacts), [{ ...newerRow, lifecycleRevision: 2, metadataRevision: 0, saveOrigin: undefined }])
})

test('live registry rows follow the newer of their lifecycle revision and known snapshot', (t) => {
  t.after(() => resetAll())
  const staleRow = { ...artifact, lifecycleRevision: 0 }
  const trashed = snapshot('trashed', 1)
  const restored = snapshot('active', 2)
  assert.equal(artifactLifecycleIsActive(staleRow, trashed), false)
  assert.equal(artifactLifecycleIsActive({ ...artifact, lifecycleRevision: 1 }, restored), true)
  assert.equal(artifactLifecycleIsActive({ ...artifact, lifecycleRevision: 3 }, trashed), false)
  setData(keys.artifactLifecycle(artifact.id), trashed)
  assert.equal(isArtifactLifecycleActive(staleRow), false)
})

test('transition sends the frozen compare-and-swap request and accepts only its exact acknowledgement', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch; resetAll() })
  const calls: Array<{ url: string; method?: string; body?: string | null; key?: string | null; source?: string | null }> = []
  globalThis.fetch = async (input, init) => {
    calls.push({
      url: String(input),
      method: init?.method,
      body: init?.body as string | null | undefined,
      key: new Headers(init?.headers).get('Idempotency-Key'),
      source: new Headers(init?.headers).get('X-Account-Transition-Source'),
    })
    return response(snapshot('trashed', 1))
  }

  const result = await transitionArtifactLifecycle(artifact.id, {
    state: 'trashed', expectedRevision: 0,
  }, 'lifecycle-key', 'user-ada')

  assert.equal(result.lifecycle.revision, 1)
  assert.deepEqual(calls, [{
    url: `${API_BASE}${paths.artifactLifecycle(artifact.id)}`,
    method: 'PATCH',
    body: JSON.stringify({ state: 'trashed', expectedRevision: 0 }),
    key: 'lifecycle-key',
    source: 'session:user-ada',
  }])
})

test('a later lifecycle cycle does not reconcile an earlier user action as success', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch; resetAll() })
  globalThis.fetch = async () => response(snapshot('active', 2))
  assert.equal(await reconcileArtifactLifecycle(artifact.id, 'trashed', 0, null), false)
})
