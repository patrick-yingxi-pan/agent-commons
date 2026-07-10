/** Consent correctness (the 2026-07 review's consent family):
 *   - C25 — a one-off consent card's "confirmed" once lived only in component
 *     state: reopening the thread re-offered an already-applied edit as pending.
 *     `opAppliedInGraph` (contract/graph.ts) derives the remount-proof state from
 *     the GRAPH — the record of what was applied — the way standing ops already
 *     read `standingApprovals`. Unit-tested here; the card's wiring is source-locked.
 *   - C2 — the card's instructions preview resolved the overlay ONLY, so an edit
 *     to a seeded project's instructions rendered as a blind create; the resolver
 *     is now overlay-or-seed (the same read the project page renders).
 *   - C27 — an approved workspace/repo escalation on a REAL session persisted
 *     nothing: a reload dropped what the user had just consented to grow. The
 *     apply now writes the same two facets as a manual attach.
 *   - N3 — a saved artifact stamps its producing session's ID (the stable join),
 *     so renaming the conversation no longer breaks "From ‹conversation›". */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, read, stripComments } from './helpers/source.ts'
import { emptyGraph, applyGraphOp, opAppliedInGraph } from '../contract/graph.ts'
import type { RelationOp } from '../contract/relations.ts'

const mint = () => 'a-minted'
const apply = (ops: RelationOp[]) => ops.reduce((g, op) => applyGraphOp(g, op, mint, 7), emptyGraph())

test('opAppliedInGraph: applying an op flips its own derivation from pending to applied', () => {
  const cases: RelationOp[] = [
    { kind: 'file-session', sessionId: 's1', sessionTitle: 'S', projectId: 'p1', projectName: 'P' },
    { kind: 'create-project', projectId: 'p-new', projectName: 'N', projectDescription: 'd', sessionId: 's2', sessionTitle: 'S2' },
    { kind: 'refile-artifact', artifactId: 'a1', artifactName: 'A', projectId: 'p1', projectName: 'P' },
    { kind: 'save-artifact', artifact: { name: 'Summary', kind: 'doc', meta: 'm' }, sessionId: 's1', sessionTitle: 'S' },
    { kind: 'scope-context', projectId: 'p1', projectName: 'P', context: { label: 'Slack', icon: 'plug' } as never },
    { kind: 'set-project-instructions', projectId: 'p1', projectName: 'P', instructions: 'be terse' },
    { kind: 'set-project-readme', projectId: 'p1', projectName: 'P', readme: 'about' },
    { kind: 'link-schedule-project', scheduleId: 'sch1', scheduleName: 'Sch', projectId: 'p1', projectName: 'P' },
    { kind: 'set-artifact-source', artifactId: 'a1', artifactName: 'A', contextLabel: 'Slack' },
  ]
  for (const op of cases) {
    assert.equal(opAppliedInGraph(emptyGraph(), op), false, `${op.kind}: pending on a fresh graph`)
    assert.equal(opAppliedInGraph(apply([op]), op), true, `${op.kind}: applied once applied`)
  }
})

test('opAppliedInGraph: unfile/unscope (the inverse ops) derive too', () => {
  const scoped = apply([
    { kind: 'scope-context', projectId: 'p1', projectName: 'P', context: { label: 'Slack', icon: 'plug' } as never },
  ])
  const unscope: RelationOp = { kind: 'unscope-context', projectId: 'p1', projectName: 'P', contextLabel: 'Slack' }
  assert.equal(opAppliedInGraph(scoped, unscope), false, 'still scoped ⇒ pending')
  assert.equal(opAppliedInGraph(applyGraphOp(scoped, unscope, mint), unscope), true, 'unscoped ⇒ applied')

  const filed = apply([{ kind: 'file-session', sessionId: 's1', sessionTitle: 'S', projectId: 'p1', projectName: 'P' }])
  const unfile: RelationOp = { kind: 'file-session', sessionId: 's1', sessionTitle: 'S', projectId: null, projectName: 'P' }
  assert.equal(opAppliedInGraph(filed, unfile), false)
  assert.equal(opAppliedInGraph(applyGraphOp(filed, unfile, mint), unfile), true)
})

test('opAppliedInGraph: a same-name save from a DIFFERENT session stays pending (no false "done")', () => {
  const saved = apply([
    { kind: 'save-artifact', artifact: { name: 'Summary', kind: 'doc', meta: 'm' }, sessionId: 's1', sessionTitle: 'Thread one' },
  ])
  const other: RelationOp = {
    kind: 'save-artifact',
    artifact: { name: 'Summary', kind: 'doc', meta: 'm' },
    sessionId: 's2',
    sessionTitle: 'Thread two',
  }
  assert.equal(opAppliedInGraph(saved, other), false, 'a distinct source is a distinct save')
})

test('opAppliedInGraph: non-graph effects are undefined — the card keeps its in-memory fallback', () => {
  const g = emptyGraph()
  const nonGraph: RelationOp[] = [
    { kind: 'attach-context', sessionTitle: 'S', connectorId: 'slack', connectorLabel: 'Slack' },
    { kind: 'create-provider', label: 'P', modelFamily: 'claude' },
    { kind: 'create-prompt', label: 'L', body: 'b', targetFamily: 'claude' },
    { kind: 'create-agent', label: 'A' },
    { kind: 'commission-agent', agentId: 'a', agentLabel: 'A', projectId: 'p', projectName: 'P' },
    { kind: 'uncommission-agent', commissionId: 'c', agentLabel: 'A', projectId: 'p', projectName: 'P' },
    { kind: 'handoff-agent', sessionId: 's', sessionTitle: 'S', agentId: 'a', agentLabel: 'A' },
    { kind: 'set-commission-cap', projectId: 'p', projectName: 'P', cap: 3 },
    // Standing ops read standingApprovals (the existing mechanism), not this derivation.
    { kind: 'set-schedule-artifact', scheduleId: 'sch', scheduleName: 'S', cadence: 'daily', artifactName: 'A' },
  ]
  for (const op of nonGraph) assert.equal(opAppliedInGraph(g, op), undefined, `${op.kind} is not graph-derivable`)
  // share-project derives only for CREATED projects — a seed id stays undefined.
  const seedShare: RelationOp = { kind: 'share-project', projectId: 'p-seed', projectName: 'P', shared: true }
  assert.equal(opAppliedInGraph(g, seedShare), undefined)
  const created = apply([{ kind: 'create-project', projectId: 'p-new', projectName: 'N', projectDescription: 'd' }])
  const share: RelationOp = { kind: 'share-project', projectId: 'p-new', projectName: 'N', shared: true }
  assert.equal(opAppliedInGraph(created, share), false)
  assert.equal(opAppliedInGraph(applyGraphOp(created, share, mint), share), true)
})

test('the consent card derives one-off done-ness from the graph (remount-proof), not component state alone', () => {
  const card = stripComments(read(join(ROOT, 'src', 'components', 'RelationActionCard.tsx')))
  assert.match(card, /appliedInGraph\(op\) === true/, 'isDone consults the graph derivation')
  const rel = stripComments(read(join(ROOT, 'src', 'controller', 'useRelations.tsx')))
  assert.match(rel, /appliedInGraph: \(op\) => opAppliedInGraph\(graph, op\)/, 'the selector wraps the contract helper')
})

test('the instructions resolver is overlay-or-seed — a consent preview diffs against what the page shows (C2)', () => {
  const rel = stripComments(read(join(ROOT, 'src', 'controller', 'useRelations.tsx')))
  // lastIndexOf: the first hit is the RelationsValue TYPE line; the implementation follows.
  const block = rel.slice(rel.lastIndexOf('instructionsForProject:')).slice(0, 300)
  assert.match(block, /graph\.projectInstructions\?\.\[pid\] \?\?/, 'the overlay wins when set')
  assert.match(
    block,
    /\[\.\.\.graph\.extraProjects, \.\.\.projects\]\.find\(\(p\) => p\.id === pid\)\?\.instructions/,
    'falls back to the project seed, the read every other consumer uses',
  )
})

test('an approved escalation on a real session persists BOTH facets, like a manual attach (C27)', () => {
  const controller = stripComments(read(join(ROOT, 'src', 'controller', 'useSessionWorkspace.ts')))
  const block = controller.slice(controller.indexOf('const applyEscalation'), controller.indexOf('const playStep'))
  assert.match(block, /esc\.kind !== 'project'/, 'project escalations take the relation-op path instead')
  assert.match(block, /void attachContext\(id, binding\)/, 'the binding-of-record is written')
  assert.match(block, /void persistWorkspace\(id, workspaceOf\(next\)\)/, 'the panels write through')
  assert.match(block, /!session\.isDemo/, 'the demo tour stays client-owned')
})

test('a saved artifact stamps its producing session ID — the stable join for "From ‹conversation›" (N3)', () => {
  const g = apply([
    {
      kind: 'save-artifact',
      artifact: { name: 'Summary', kind: 'doc', meta: 'm' },
      sessionId: 's1',
      sessionTitle: 'Renamable thread',
    },
  ])
  assert.equal(g.extraArtifacts[0].sourceSessionId, 's1', 'the reducer stamps op.sessionId')
  assert.equal(g.extraArtifacts[0].source, 'Renamable thread', 'the title stays the display label')
  // A user-created artifact (no session) carries no id and the neutral source.
  const g2 = apply([{ kind: 'save-artifact', artifact: { name: 'Note', kind: 'doc', meta: 'm' } }])
  assert.equal(g2.extraArtifacts[0].sourceSessionId, undefined)
  assert.equal(g2.extraArtifacts[0].source, 'Created here')
})
