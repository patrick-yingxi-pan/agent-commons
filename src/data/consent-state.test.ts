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
 *   - C28 — a persisted escalation proposal (message.escalation) had no
 *     remount-proof pending state: any load path dropped the consent card, so a
 *     relay-turn "create a project" could never be approved. `unresolvedEscalation`
 *     (src/data/liveSession.ts) re-derives it from the record at both reconciles.
 *   - N3 — a saved artifact stamps its producing session's ID (the stable join),
 *     so renaming the conversation no longer breaks "From ‹conversation›". */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, read, stripComments } from '../../tests/helpers/source.ts'
import { emptyGraph, applyGraphOp, opAppliedInGraph } from '../../contract/graph.ts'
import type { RelationOp } from '../../contract/relations.ts'
import type { EscalationProposal } from '../../contract/entities.ts'
import { EMPTY_LIVE, unresolvedEscalation, type Live } from './liveSession.ts'

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
    { kind: 'set-project-description', projectId: 'p1', projectName: 'P', description: 'about' },
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
  // `merged()` since 2026-08-13 — the same list, named instead of re-spread. The
  // description merge gave that list a second job (it applies the description
  // overlay), and a spread here would have been a second, differently-resolved
  // answer to "what are the projects". The CLAIM is unchanged: the fallback is
  // the project record, the read every other consumer uses.
  assert.match(
    block,
    /merged\(\)\.find\(\(p\) => p\.id === pid\)\?\.instructions/,
    'falls back to the project record, through the one merged list',
  )
})

test('an approved escalation on a real session persists BOTH facets, like a manual attach (C27)', () => {
  // Every conversation approves through the ONE session-parametric funnel
  // (useSessionEscalation — extracted from the pane so the consent rules
  // live with the controllers).
  const funnel = stripComments(read(join(ROOT, 'src', 'controller', 'useSessionEscalation.ts')))
  assert.match(funnel, /esc\.kind === 'project'/, 'project escalations take the relation-op path instead')
  assert.match(funnel, /void attachContext\(sessionId, binding\)/, 'the binding-of-record is written')
  assert.match(funnel, /workspaceWrite = persistWorkspace\(sessionId, workspaceOf\(next\)\)/, 'the panels write through')
  assert.match(
    funnel,
    /rememberPanelPreference\(sessionId, grown, workspaceWrite\)/,
    'the durable focus waits for the workspace that makes it valid',
  )
  const pane = stripComments(read(join(ROOT, 'src', 'components', 'ConversationPane.tsx')))
  assert.match(pane, /useSessionEscalation\(sessionId, nav\.sessionLabel\)/, 'the pane approves through the funnel')
})

// ── C28 — a persisted escalation proposal must survive a reload ──────────────
// The proposal is persisted on its assistant message, but the pending consent
// card lived only in controller state set by the live stream event: any load
// path (reopen, reload, reattach-after-finish — the relay transport's long
// turns made this the common case) showed the reply text and silently dropped
// the card, so the proposal could never be approved. `unresolvedEscalation`
// derives the still-pending proposal from the RECORD, mirroring C25.

test('unresolvedEscalation: a persisted project proposal resurfaces until its create-project op is in the graph (C28)', () => {
  const session = { id: 's-relay', title: 'Vibe Coding Guide chat' }
  const esc: EscalationProposal = {
    kind: 'project',
    project: { id: 'p-vibe', name: 'Vibe Coding Guide', description: 'd' },
    fileSession: true,
  }
  const live: Live = {
    ...EMPTY_LIVE,
    messages: [
      { id: 'm-u', role: 'user', content: 'create a project' },
      { id: 'm-a', role: 'assistant', content: 'Proposed.', escalation: esc },
    ],
  }
  const pending = unresolvedEscalation(session, live, emptyGraph())
  assert.deepEqual(pending, { messageId: 'm-a', escalation: esc }, 'pending on a fresh graph')
  // Applied = the project EXISTS — deliberately not the filing: once created,
  // a later unfile/refile is the user moving on, and re-offering the create
  // card would un-happen that decision (observed live: unfiling a session
  // resurfaced the already-approved create prompt).
  const created = apply([{ kind: 'create-project', projectId: 'p-vibe', projectName: 'Vibe Coding Guide', projectDescription: 'd' }])
  assert.equal(unresolvedEscalation(session, live, created), null, 'created ⇒ resolved, filed or not')
  assert.equal(unresolvedEscalation(session, live, undefined), null, 'no graph loaded ⇒ never re-offer blind')
})

test('unresolvedEscalation: workspace/repo proposals read applied-ness off the session panels (C28)', () => {
  const session = { id: 's1', title: 'S' }
  const ws: EscalationProposal = { kind: 'workspace', rootChoices: ['~/x'], artifacts: [] }
  const wsLive: Live = { ...EMPTY_LIVE, messages: [{ id: 'm1', role: 'assistant', content: 'x', escalation: ws }] }
  assert.equal(unresolvedEscalation(session, wsLive, emptyGraph())?.escalation.kind, 'workspace', 'no workspace attached ⇒ pending')
  assert.equal(
    unresolvedEscalation(session, { ...wsLive, workspaces: [{ id: 'w', label: 'w/', artifacts: [] }] }, emptyGraph()),
    null,
    'workspace attached ⇒ applied',
  )
  const repo: EscalationProposal = {
    kind: 'repo',
    connectorLabel: 'GitHub',
    remote: 'o/r',
    branch: 'main',
    files: [],
    diff: [],
    terminal: [],
    connectors: [],
  }
  const repoLive: Live = { ...EMPTY_LIVE, messages: [{ id: 'm1', role: 'assistant', content: 'x', escalation: repo }] }
  assert.equal(unresolvedEscalation(session, repoLive, emptyGraph())?.escalation.kind, 'repo', 'no repo attached ⇒ pending')
  assert.equal(
    unresolvedEscalation(
      session,
      { ...repoLive, repos: [{ id: 'r', label: 'o/r', origin: 'github', remote: 'o/r', branch: 'main', files: [], diff: [], terminal: [] }] },
      emptyGraph(),
    ),
    null,
    'repo attached ⇒ applied',
  )
  // Only the NEWEST proposal is considered — a resolved older one can't shadow it.
  assert.equal(unresolvedEscalation(session, { ...EMPTY_LIVE, messages: [] }, emptyGraph()), null, 'no proposal ⇒ nothing pending')
})

test('unresolvedEscalation reads the projected carrier when bounded history omits the proposal message (C28/PD36)', () => {
  const escalation: EscalationProposal = { kind: 'workspace', rootChoices: ['~/older'], artifacts: [] }
  const session = {
    id: 's-paged',
    title: 'Paged',
    messagePage: {
      olderCursor: 'opaque',
      olderTokens: 12,
      latestEscalation: { messageId: 'm-older', escalation },
    },
  }
  const tail: Live = { ...EMPTY_LIVE, messages: [{ id: 'm-new', role: 'assistant', content: 'newest reply' }] }
  assert.deepEqual(unresolvedEscalation(session, tail, emptyGraph()), {
    messageId: 'm-older',
    escalation,
  })
})

test('the controller resurfaces the held proposal at BOTH reconcile sites — the record is the authority (C28)', () => {
  // Every pane runs the open recipe through usePaneConversation now (Phase 6):
  // BOTH its reconcile sites — the mount-time read and the session-push
  // re-read — flow through the ONE shared tail (reconcileNow), which derives
  // the still-pending proposal from the record. (Two hand-copied tails once
  // let the push site silently miss the resurface — the shared tail is the
  // fix, so the lock asserts the sharing, not a copy count.)
  const controller = stripComments(read(join(ROOT, 'src', 'controller', 'usePaneConversation.ts')))
  assert.match(controller, /unresolvedEscalation\(s, landed/, 'the shared reconcile tail derives the held proposal from the merged page state')
  const calls = (controller.match(/reconcileNow\(sessionId[,)]/g) ?? []).length // calls, not the definition
  assert.equal(calls, 2, 'the mount-time read AND the session-push re-read both run the shared tail')
  // Resurfacing never stomps a live-stream pending proposal: holdEscalation is
  // the store's keep-the-first-prompt door (universal split Phase 1 moved the
  // held escalation into the per-session conversation store).
  assert.match(controller, /if \(held\) conversations\.holdEscalation\(sessionId, held\)/, 'resurfaces through the store’s non-stomping hold')
  const core = stripComments(read(join(ROOT, 'src', 'controller', 'conversationCore.ts')))
  assert.match(
    core,
    /update\(id, \(s\) => \(s\.pendingEscalation \? s : \{ \.\.\.s, pendingEscalation: held \}\)\)/,
    'holdEscalation keeps an already-held prompt (C28)',
  )
})

// ── C29 — resolutions are history: verdicts persist; approval never navigates ──
// The verdict on a consent card (confirm / "not now") is recorded on the message
// (`relationsResolved`), so a reload — or a LATER op that moves the relation on —
// can't flip a resolved card back to pending (the graph derivation reads the
// CURRENT relation; the verdict reads what the user resolved). And approving a
// project escalation STAYS in the thread: the confirmed card carries an "Open
// project" jump link instead of yanking the user to the project page.

test('the consent card reads + writes the persisted verdict (C29)', () => {
  const card = stripComments(read(join(ROOT, 'src', 'components', 'RelationActionCard.tsx')))
  assert.match(card, /resolved\?\.\[key\] === 'confirmed'/, 'the persisted confirm wins over graph state')
  assert.match(card, /resolved\?\.\[key\] === 'skipped'/, 'the persisted skip renders too')
  assert.match(card, /resolveMessageRelation\(sessionId, messageId, key, verdict\)/, 'each verdict is written to the record')
  const msg = stripComments(read(join(ROOT, 'src', 'components', 'Message.tsx')))
  assert.match(msg, /resolved=\{message\.relationsResolved\}/, 'the message passes its persisted verdicts to the card')
})

test('approving a project escalation stays in the thread; the confirmed card carries the jump link (C29)', () => {
  const funnel = stripComments(read(join(ROOT, 'src', 'controller', 'useSessionEscalation.ts')))
  assert.ok(funnel.includes("kind: 'create-project'"), 'the approve funnel is the one under test')
  assert.doesNotMatch(funnel, /onRetarget|onOpen|navigate\(|routeDoor/, 'approval never navigates away from the conversation')
  const msg = stripComments(read(join(ROOT, 'src', 'components', 'Message.tsx')))
  assert.match(msg, /function EscalationOutcome/, 'the applied face of the proposal renders on its message')
  assert.match(msg, /isCreatedProject\(escalation\.project\.id\)/, 'applied-ness derives from the record (remount-proof)')
  assert.match(msg, /navigate\('projects', escalation\.project\.id\)/, 'the jump link is there to follow at will')
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
