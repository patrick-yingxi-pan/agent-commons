import assert from 'node:assert/strict'
import test from 'node:test'

import { applyGraphOp, emptyGraph, opAppliedInGraph } from './graph.ts'
import { artifactFromDraft, artifactMatchesSave, type RelationOp } from './relations.ts'

const draft = {
  name: 'weekly-report.md',
  kind: 'doc' as const,
  meta: 'Document',
  body: '# Weekly report',
}

function saveOp(overrides: Partial<Extract<RelationOp, { kind: 'save-artifact' }>> = {}) {
  return {
    kind: 'save-artifact' as const,
    artifact: draft,
    sessionId: 'session-1',
    sessionTitle: 'Research notes',
    ownerTenantId: 'tenant-a',
    ...overrides,
  }
}

test('artifactFromDraft stamps immutable display-name-independent save origin', () => {
  const item = artifactFromDraft(draft, 'artifact-1', 'Research notes', '', 10, 'session-1', 'tenant-a')

  assert.deepEqual(item.saveOrigin, { name: 'weekly-report.md', source: 'Research notes' })
  assert.equal(item.name, 'weekly-report.md')
  assert.equal(item.source, 'Research notes')
  assert.equal(item.tenantId, 'tenant-a')
})

test('a renamed projected artifact still satisfies its original save and replay is idempotent', () => {
  const op = saveOp()
  const initial = applyGraphOp(emptyGraph(), op, () => 'artifact-1', 10)
  const renamed = { ...initial.extraArtifacts[0], name: 'renamed-weekly-report.md' }
  const projected = { ...initial, extraArtifacts: [renamed] }

  assert.equal(artifactMatchesSave(renamed, op), true)
  assert.equal(opAppliedInGraph(projected, op), true)

  const replay = applyGraphOp(projected, op, () => 'unexpected-duplicate', 20)
  assert.deepEqual(replay, projected)
})

test('save origin and tenant identity prevent foreign or same-name aliasing', () => {
  const op = saveOp()
  const item = artifactFromDraft(draft, 'artifact-1', 'Research notes', '', 10, 'session-1', 'tenant-a')

  assert.equal(artifactMatchesSave(item, { ...op, ownerTenantId: 'tenant-b' }), false)
  assert.equal(
    artifactMatchesSave(
      { ...item, name: 'renamed-weekly-report.md', saveOrigin: { name: 'other.md', source: 'Other notes' } },
      op,
    ),
    false,
  )
})

test('legacy raw artifacts use their original name and source as a compatibility fallback', () => {
  const op = saveOp()
  const stamped = artifactFromDraft(draft, 'artifact-1', 'Research notes', '', 10, 'session-1', 'tenant-a')
  const { saveOrigin: _saveOrigin, ...legacy } = stamped

  assert.equal(artifactMatchesSave(legacy, op), true)
  assert.equal(artifactMatchesSave({ ...legacy, name: 'renamed-weekly-report.md' }, op), false)
})
