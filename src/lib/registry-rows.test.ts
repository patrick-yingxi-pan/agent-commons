import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import type { Project } from '../../contract/index.ts'
import { ROOT, read, stripComments } from '../../tests/helpers/source.ts'
import { registryRows } from './registryRows.ts'

const project = (id: string, own = true): Project => ({
  id, name: 'Same name', description: '', instructions: '', updatedAt: 1,
  contexts: [], sessionIds: [], scheduled: [], own,
})

test('Project acknowledgements and registry refresh form one stable identity union', () => {
  const acknowledged = Object.freeze(project('created'))
  const seed = Object.freeze(project('seed'))
  const shared = Object.freeze(project('shared', false))
  const stale = Object.freeze({ ...acknowledged, description: 'older' })
  assert.deepEqual(registryRows([acknowledged], []), [acknowledged])
  const rows = registryRows(Object.freeze([acknowledged]), Object.freeze([stale, seed, shared]))
  assert.deepEqual(rows, [acknowledged, seed, shared])
  assert.equal(rows[0], acknowledged, 'retain immediate graph metadata')
  assert.equal(rows[2].own, false, 'merging does not invent ownership')
  assert.equal(new Set(rows.map(row => row.name)).size, 1, 'same-name IDs stay independent')
})

test('Project page/rail model and semantic tools consume the canonical registry without a second concatenation', () => {
  const relations = stripComments(read(join(ROOT, 'src/controller/useRelations.tsx')))
  assert.match(relations, /withDescriptions\(registryRows\(graph\.extraProjects, projects\)\)/)
  const routes = stripComments(read(join(ROOT, 'server/routes/index.ts')))
  assert.match(routes, /projects: store\.listProjects\(tenantId\)\.map\(/)
  assert.doesNotMatch(routes, /\.\.\.graphNow\.extraProjects/)
  const catalog = routes.slice(routes.indexOf('projects: store.listProjects'), routes.indexOf('artifacts: store.listArtifacts'))
  assert.match(catalog, /own: p\.own/)
  assert.match(catalog, /shared: p\.shared/)
})
