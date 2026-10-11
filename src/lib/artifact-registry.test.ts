import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ArtifactItem } from '../../contract/index.ts'
import { ROOT, read, stripComments } from '../../tests/helpers/source.ts'
import { join } from 'node:path'
import { registryRows } from './registryRows.ts'

const row = (id: string, extra: Partial<ArtifactItem> = {}): ArtifactItem => ({
  id, name: 'notes.md', kind: 'doc', meta: 'Document', source: '',
  projectId: '', editedAt: 1, ...extra,
})

test('acknowledged authored rows appear immediately and only once after registry refresh', () => {
  const created = Object.freeze(row('authored', { editedAt: 2 }))
  const seed = Object.freeze(row('seed', { name: 'seed.md' }))
  const older = Object.freeze(row('authored'))
  assert.deepEqual(registryRows([created], []), [created])
  const projected = registryRows(Object.freeze([created]), Object.freeze([older, seed]))
  assert.deepEqual(projected, [created, seed])
  assert.equal(projected[0], created, 'graph acknowledgement retains immediate metadata')
})

test('equal filenames remain separate IDs and granted rows retain read-only metadata', () => {
  const owned = row('owned', { own: true })
  const shared = row('shared', { own: false, tenantId: 'foreign' })
  assert.deepEqual(registryRows([owned], [owned, shared]), [owned, shared])
  assert.equal(registryRows([], [shared])[0].own, false)
  assert.deepEqual(registryRows([], []), [])
})

test('rendered projections and body-name uniqueness use the same ID union', () => {
  for (const path of ['src/controller/useRelations.tsx', 'src/api/commands.ts']) {
    const source = stripComments(read(join(ROOT, path)))
    assert.match(source, /import \{ registryRows \} from/, path)
    assert.match(source, /(?:allArtifacts|cachedArtifactRows)[^\n]*registryRows\(/, path)
  }
  const routes = stripComments(read(join(ROOT, 'server/conversationContext.ts')))
  assert.match(stripComments(read(join(ROOT, 'server/conversationExecution.ts'))), /conversationContext\(session\.id, tenantId, actorUserId\)/)
  assert.match(routes, /artifacts: store\.listArtifacts\(tenantId\)\s*\.filter\(\(artifact\) => artifact\.own === true\)\s*\.map\(/)
  assert.doesNotMatch(routes, /\.\.\.graphNow\.extraArtifacts/)
})
