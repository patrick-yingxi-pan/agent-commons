import assert from 'node:assert/strict'
import { test } from 'node:test'
import { docBlockText } from '../../contract/content.ts'
import { artifactCreationId } from '../artifactCreationIdentity.ts'
import { ConflictError } from '../conflict.ts'
import { store } from './index.ts'

const owner = 'tenant-artifact-history-owner'
const reader = 'tenant-beta'

function createDocument(key: string) {
  const id = artifactCreationId(owner, key)
  const created = store.createArtifact({ name: `${key}.md`, kind: 'doc', body: 'Initial retained text.\n\nSecond paragraph.' }, owner, id)
  assert.ok(created && created !== 'invalid')
  return created.artifact
}

test('body writes capture one baseline and restore appends a durable monotonic receipt', () => {
  const artifact = createDocument(`history-${Date.now()}`)
  const initial = store.artifactContent(owner)[artifact.id]!
  assert.equal(initial.type, 'doc')
  if (initial.type !== 'doc') return
  const original = docBlockText(initial.blocks[0]!)!
  const updated = store.updateArtifactBlock(artifact.id, 0, 'Edited version one.', 0)!
  assert.equal(updated.revision, 1)
  const listed = store.artifactHistoryPage(artifact.id, owner)?.versions
  assert.deepEqual(listed?.map(({ revision, reason }) => ({ revision, reason })), [
    { revision: 1, reason: 'edit' },
    { revision: 0, reason: 'baseline' },
  ])
  assert.match(listed?.[0]?.savedAt ?? '', /^\d{4}-\d\d-\d\dT/)
  assert.equal(listed?.[1]?.savedAt, null, 'the pre-history baseline does not invent a timestamp')
  const restored = store.restoreArtifactHistoryVersion(artifact.id, 0, 1, owner, 'user-history-owner', 'restore-key-1')!
  assert.equal(restored.version.revision, 2)
  assert.equal(restored.version.reason, 'restore')
  assert.equal(restored.version.restoredFromRevision, 0)
  assert.equal(restored.version.body.type, 'doc')
  if (restored.version.body.type === 'doc') assert.equal(docBlockText(restored.version.body.blocks[0]!), original)
  const next = store.updateArtifactBlock(artifact.id, 0, 'A later distinct edit.', 2)!
  assert.equal(next.revision, 3)
  const replay = store.restoreArtifactHistoryVersion(artifact.id, 0, 1, owner, 'user-history-owner', 'restore-key-1')!
  assert.equal(replay.currentRevision, 3, 'replay reports present truth')
  assert.equal(replay.version.revision, 2, 'replay returns exact historic mutation receipt')
  assert.equal(store.artifactContent(owner)[artifact.id]?.revision, 3, 'replay does not overwrite current content')
  if (replay.version.body.type === 'doc') replay.version.body.blocks[0] = { p: 'mutated response' }
  const mutableCurrent = store.artifactContent(owner)[artifact.id]!
  if (mutableCurrent.type === 'doc') mutableCurrent.blocks[0] = { p: 'mutated current' }
  assert.equal(store.artifactHistoryVersion(artifact.id, 0, owner)?.version.body.type === 'doc'
    ? docBlockText(store.artifactHistoryVersion(artifact.id, 0, owner)!.version.body.blocks[0]!)
    : undefined, original, 'history snapshots stay detached from response/current body objects')
  assert.throws(() => store.restoreArtifactHistoryVersion(artifact.id, 1, 2, owner, 'user-history-owner', 'restore-key-1'), ConflictError)
  assert.equal(store.artifactHistoryPage(artifact.id, reader), undefined, 'granted/shared readers cannot read owner history')
})

test('history survives Trash while restore requires active owner state', () => {
  const artifact = createDocument(`history-trash-${Date.now()}`)
  store.updateArtifactBlock(artifact.id, 0, 'Create the first retained version.', 0)
  store.setArtifactLifecycle(artifact.id, 'trashed', 0, owner)
  assert.equal(store.artifactHistoryPage(artifact.id, owner)?.versions.length, 2)
  assert.throws(() => store.restoreArtifactHistoryVersion(artifact.id, 0, 1, owner, 'user-history-owner', 'trashed-restore-key'), ConflictError)
})

test('history accepts a same-kind restoration from Workbook back to Sheet', () => {
  const id = artifactCreationId(owner, `history-workbook-${Date.now()}`)
  const created = store.createArtifact({ name: 'history.sheet', kind: 'sheet', body: { type: 'sheet', columns: ['A'], rows: [['Original']] } }, owner, id)
  assert.ok(created && created !== 'invalid')
  const expanded = store.updateStructuredArtifactContent(id, {
    type: 'workbook', sheets: [{ id: 'tab-1', name: 'Data', columns: ['A'], rows: [['Expanded']] }],
  }, 0, owner)
  assert.equal(expanded?.type, 'workbook')
  const restored = store.restoreArtifactHistoryVersion(id, 0, 1, owner, 'user-history-owner', `workbook-restore-${Date.now()}`)
  assert.equal(restored?.version.body.type, 'sheet', 'explicit historical restoration may reverse a whole-body type transition within Sheet kind')
  assert.equal(store.artifactContent(owner)[id]?.type, 'sheet')
})

test('history retains a legacy prose body above the authoring-only total limit', () => {
  const id = artifactCreationId(owner, `history-large-${Date.now()}`)
  const raw = Array.from({ length: 12 }, () => 'x'.repeat(1_700)).join('\n\n')
  const created = store.createArtifact({ name: 'large-history.md', kind: 'doc', body: raw }, owner, id)
  assert.ok(created && created !== 'invalid')
  const initial = store.artifactContent(owner)[id]!
  assert.equal(initial.type, 'doc')
  if (initial.type !== 'doc') return
  const first = store.updateArtifactBlock(id, 0, 'a'.repeat(2_000), 0)!
  const size = (first.type === 'doc' ? first.blocks.reduce((sum, block) => sum + (docBlockText(block)?.length ?? 0), 0) : 0)
  assert.ok(size > 20_000, 'per-block edits can validly exceed the separate authoring-body cap')
  const second = store.updateArtifactBlock(id, 1, 'b'.repeat(2_000), 1)!
  assert.equal(second.revision, 2, 'a history-aware edit does not regress a previously valid legacy body')
  assert.equal(store.artifactHistoryPage(id, owner)?.versions.length, 3)
})
