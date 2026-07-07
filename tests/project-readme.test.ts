/** D26 — the project README (docs/agent-commons.md; the GitHub-parity ledger row 5):
 *  a shared Project's PUBLIC "about", the complement of `instructions` (private
 *  owner context). The invariants under test: the reducer sets / caps / clears it;
 *  the op rides the same tenancy wall as every graph edit (a foreign tenant's
 *  set-project-readme is refused); and the projection serves the README to every
 *  viewer of a SHARED project while STILL stripping instructions — one row public,
 *  the other private, by design. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyGraphOp, emptyGraph } from '../contract/graph.ts'
import { store } from '../server/store.ts'
import { call } from './helpers/http.ts'

const A = 'tenant-rdme-A'
const B = 'tenant-rdme-B'
let n = 0

test('the reducer sets, caps, and clears the README (shared code — both appliers agree)', () => {
  let g = emptyGraph()
  g = applyGraphOp(g, { kind: 'set-project-readme', projectId: 'p1', projectName: 'P', readme: 'hello world' })
  assert.equal(g.projectReadmes.p1, 'hello world')
  g = applyGraphOp(g, { kind: 'set-project-readme', projectId: 'p1', projectName: 'P', readme: 'x'.repeat(20_000) })
  assert.equal(g.projectReadmes.p1.length, 10_000, 'capped in the SHARED reducer')
  g = applyGraphOp(g, { kind: 'set-project-readme', projectId: 'p1', projectName: 'P', readme: '' })
  assert.equal(g.projectReadmes.p1, '', 'empty clears')
})

test('the README is public on a shared project; instructions stay private; the op stays owner-only', async () => {
  const projectId = `p-rdme-${(n += 1)}`
  store.applyRelationOp({ kind: 'create-project', projectId, projectName: `Readme ${n}`, projectDescription: '' }, A)
  store.applyRelationOp({ kind: 'share-project', projectId, projectName: `Readme ${n}`, shared: true }, A)
  store.applyRelationOp({ kind: 'set-project-readme', projectId, projectName: `Readme ${n}`, readme: 'What this is, and how to contribute.' }, A)
  store.applyRelationOp({ kind: 'set-project-instructions', projectId, projectName: `Readme ${n}`, instructions: 'private owner context' }, A)

  // The visitor's projection: README present, instructions absent.
  const visitor = (await call('GET', '/relations', undefined, { 'x-tenant-id': B })).json
  assert.equal(visitor.projectReadmes[projectId], 'What this is, and how to contribute.', 'the README is the public about')
  assert.equal(visitor.projectInstructions[projectId], undefined, 'instructions never cross (unchanged)')

  // A foreign tenant cannot SET it — the same destination-project wall as every op.
  const forged = await call(
    'POST', '/relations/ops',
    { op: { kind: 'set-project-readme', projectId, projectName: `Readme ${n}`, readme: 'defaced' } },
    { 'x-tenant-id': B },
  )
  assert.equal(forged.status, 404, 'existence-hiding refusal, like every foreign graph write')
  const after = (await call('GET', '/relations', undefined, { 'x-tenant-id': A })).json
  assert.equal(after.projectReadmes[projectId], 'What this is, and how to contribute.', 'unchanged')

  // A malformed readme (the one op field the SHARED reducer calls a method on)
  // answers 400, not a 500 from a TypeError inside the reducer (review finding).
  const malformed = await call(
    'POST', '/relations/ops',
    { op: { kind: 'set-project-readme', projectId, projectName: `Readme ${n}`, readme: 123 } },
    { 'x-tenant-id': A },
  )
  assert.equal(malformed.status, 400)

  // Un-share ⇒ the visitor loses the row (the projection re-checks at read time).
  store.applyRelationOp({ kind: 'share-project', projectId, projectName: `Readme ${n}`, shared: false }, A)
  const dark = (await call('GET', '/relations', undefined, { 'x-tenant-id': B })).json
  assert.equal(dark.projectReadmes[projectId], undefined, 'a private project’s README is the owner’s alone')
})
