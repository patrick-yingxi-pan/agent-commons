/** The shared-module boundary: contract/graph.ts (the relationship-graph reducer)
 *  and contract/ids.ts (id-derivation) are imported VERBATIM by both ends — the
 *  client applies an op optimistically, the server applies the same op canonically.
 *  Type-identity guarantees they call the same function; these lock its BEHAVIOR, so
 *  an optimistic client patch can never diverge from the server's authoritative one,
 *  and so the ids each side derives for the other stay byte-identical. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyGraphOp,
  emptyGraph,
  opKey,
  repoIdForLabel,
  slug,
  runSessionId,
  isRunSessionId,
} from '../contract/index.ts'

const mintIds = () => {
  let n = 0
  return () => `art-test-${(n += 1)}`
}

test('applyGraphOp returns a NEW graph and never mutates the input (immutability the optimistic path relies on)', () => {
  const g0 = emptyGraph()
  const g1 = applyGraphOp(g0, { kind: 'file-session', sessionId: 's1', sessionTitle: 'S', projectId: 'p1', projectName: 'P' }, mintIds())
  assert.notEqual(g1, g0, 'a new graph object is returned')
  assert.deepEqual(g0.sessionProject, {}, 'the input graph is untouched')
  assert.equal(g1.sessionProject.s1, 'p1')
})

test('create-project is idempotent: a replayed op re-files the session, never duplicates the project', () => {
  const op = {
    kind: 'create-project',
    projectId: 'p-new',
    projectName: 'New',
    projectDescription: 'd',
    sessionId: 's1',
    sessionTitle: 'S',
  }
  let g = applyGraphOp(emptyGraph(), op, mintIds())
  assert.equal(g.extraProjects.length, 1)
  assert.equal(g.sessionProject.s1, 'p-new')
  // Replay (e.g. the server re-applies what the client already optimistically did).
  g = applyGraphOp(g, op, mintIds())
  assert.equal(g.extraProjects.length, 1, 'the project is not duplicated on replay')
})

test('save-artifact mints a fresh id, prepends the artifact, and files it under the project', () => {
  const mint = mintIds()
  const g = applyGraphOp(
    emptyGraph(),
    { kind: 'save-artifact', artifact: { name: 'Brief', kind: 'doc', meta: 'm' }, sessionId: 's1', sessionTitle: 'S', projectId: 'p1' },
    mint,
  )
  assert.equal(g.extraArtifacts.length, 1)
  const art = g.extraArtifacts[0]
  assert.equal(art.name, 'Brief')
  assert.equal(art.id, 'art-test-1', 'the injected minter assigns the id (server uses a stable one, client a temp)')
  assert.equal(g.artifactProject[art.id], 'p1', 'filed under the project when one is given')
})

test("attach-context is a no-op on the graph (it's a live-session effect, applied by the caller)", () => {
  const g0 = emptyGraph()
  const g1 = applyGraphOp(
    g0,
    { kind: 'attach-context', sessionTitle: 'S', connectorId: 'gh', connectorLabel: 'GitHub' },
    mintIds(),
  )
  assert.deepEqual(g1, g0, 'the relationship graph is unchanged by an attach')
})

test("standing schedule ops record a standing approval keyed by opKey (the daemon's later authority)", () => {
  const op = { kind: 'set-schedule-artifact', scheduleId: 's-1', scheduleName: 'Digest', cadence: 'Daily', artifactName: 'Digest' }
  const g = applyGraphOp(emptyGraph(), op, mintIds())
  assert.equal(g.scheduleArtifact['s-1'], 'Digest')
  assert.equal(g.standingApprovals[opKey(op)], true, 'the op is marked as a standing approval')
})

test('id-derivation invariants are stable and agree across calls (both backends derive the same ids)', () => {
  assert.equal(slug('Insights Dashboard!'), 'insights-dashboard')
  assert.equal(slug('Insights Dashboard!'), slug('insights dashboard'), 'slug is case/punctuation-insensitive + deterministic')
  assert.equal(repoIdForLabel('acme/web-app'), `repo-${slug('acme/web-app')}`)
  assert.equal(repoIdForLabel('acme/web-app'), 'repo-acme-web-app')
  const id = runSessionId('task-1', 'run-9')
  assert.equal(id, 'srun-task-1-run-9')
  assert.ok(isRunSessionId(id))
  assert.ok(!isRunSessionId('sess-3'))
})
