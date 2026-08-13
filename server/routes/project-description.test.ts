/** D26 — the project description (docs/agent-commons.md; the GitHub-parity ledger row 5):
 *  a shared Project's PUBLIC "about", the complement of `instructions` (private
 *  owner context). The invariants under test: the reducer sets / caps / clears it;
 *  the op rides the same tenancy wall as every graph edit (a foreign tenant's
 *  set-project-description is refused); and the projection serves the description to every
 *  viewer of a SHARED project while STILL stripping instructions — one row public,
 *  the other private, by design. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyGraphOp, emptyGraph } from '../../contract/graph.ts'
import { store } from '../store/index.ts'
import { call } from '../testkit/http.ts'

const A = 'tenant-rdme-A'
const B = 'tenant-rdme-B'
let n = 0

test('the reducer sets, caps, and clears the description (shared code — both appliers agree)', () => {
  let g = emptyGraph()
  g = applyGraphOp(g, { kind: 'set-project-description', projectId: 'p1', projectName: 'P', description: 'hello world' })
  assert.equal(g.projectDescriptions.p1, 'hello world')
  g = applyGraphOp(g, { kind: 'set-project-description', projectId: 'p1', projectName: 'P', description: 'x'.repeat(20_000) })
  assert.equal(g.projectDescriptions.p1.length, 10_000, 'capped in the SHARED reducer')
  g = applyGraphOp(g, { kind: 'set-project-description', projectId: 'p1', projectName: 'P', description: '' })
  assert.equal(g.projectDescriptions.p1, '', 'empty clears')
})

test('the description is public on a shared project; instructions stay private; the op stays owner-only', async () => {
  const projectId = `p-rdme-${(n += 1)}`
  store.applyRelationOp({ kind: 'create-project', projectId, projectName: `Description ${n}`, projectDescription: '' }, A)
  store.applyRelationOp({ kind: 'share-project', projectId, projectName: `Description ${n}`, shared: true }, A)
  store.applyRelationOp({ kind: 'set-project-description', projectId, projectName: `Description ${n}`, description: 'What this is, and how to contribute.' }, A)
  store.applyRelationOp({ kind: 'set-project-instructions', projectId, projectName: `Description ${n}`, instructions: 'private owner context' }, A)

  // The visitor's projection: description present, instructions absent.
  const visitor = (await call('GET', '/relations', undefined, { 'x-tenant-id': B })).json
  assert.equal(visitor.projectDescriptions[projectId], 'What this is, and how to contribute.', 'the description is the public about')
  assert.equal(visitor.projectInstructions[projectId], undefined, 'instructions never cross (unchanged)')

  // A foreign tenant cannot SET it — the same destination-project wall as every op.
  const forged = await call(
    'POST', '/relations/ops',
    { op: { kind: 'set-project-description', projectId, projectName: `Description ${n}`, description: 'defaced' } },
    { 'x-tenant-id': B },
  )
  assert.equal(forged.status, 404, 'existence-hiding refusal, like every foreign graph write')
  const after = (await call('GET', '/relations', undefined, { 'x-tenant-id': A })).json
  assert.equal(after.projectDescriptions[projectId], 'What this is, and how to contribute.', 'unchanged')

  // A malformed description (the one op field the SHARED reducer calls a method on)
  // answers 400, not a 500 from a TypeError inside the reducer (review finding).
  const malformed = await call(
    'POST', '/relations/ops',
    { op: { kind: 'set-project-description', projectId, projectName: `Description ${n}`, description: 123 } },
    { 'x-tenant-id': A },
  )
  assert.equal(malformed.status, 400)

  // Un-share ⇒ the visitor loses the row (the projection re-checks at read time).
  store.applyRelationOp({ kind: 'share-project', projectId, projectName: `Description ${n}`, shared: false }, A)
  const dark = (await call('GET', '/relations', undefined, { 'x-tenant-id': B })).json
  assert.equal(dark.projectDescriptions[projectId], undefined, 'a private project’s description is the owner’s alone')
})
