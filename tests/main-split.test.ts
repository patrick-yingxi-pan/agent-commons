/** Locking tests: the MAIN workspace split's vocabulary + tree rules
 *  (universal split Phase 2, docs/design/universal-split-workspace.md §2.1) —
 *  the generic split math instantiated with the main-pane content, and the
 *  primary-pane invariant the close rule keeps. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findPane, panes, prunePanes, splitPane, pane, type PaneContent } from '../src/lib/splitFrame.ts'
import {
  PRIMARY,
  closeMainPane,
  closePrimaryPane,
  contextPaneContent,
  contextPaneId,
  findFocusDrivenContext,
  mainPaneKeep,
  newMainPicker,
  paneContentAlive,
  retargetDraftPanes,
  setFocusDrivenContextTree,
  unpinnedContent,
  withoutFocusDrivenContext,
  type MainPaneContent,
  type MainSplitNode,
} from '../src/lib/mainSplit.ts'
import type { Live } from '../src/data/liveSession.ts'

const projects: MainPaneContent = { kind: 'msection', id: 'projects' }
const artifacts: MainPaneContent = { kind: 'msection', id: 'artifacts' }

/** A minimal live for the aliveness/prune checks — only the arrays the predicate
 *  reads. */
const liveWith = (o: Partial<Live>): Live =>
  ({ workspaces: [], repos: [], connectors: [], attachments: [], ...o }) as Live

test('the generic tree instantiates with the main vocabulary (Phase 2 of the one split model)', () => {
  const tree = splitPane(splitPane(pane(PRIMARY), '', 'row', projects), 'b', 'col', artifacts)
  assert.deepEqual(
    panes(tree).map((p) => p.content.kind),
    ['primary', 'msection', 'msection'],
  )
})

test('mpicker panes survive pruning (the generic picker rule covers both vocabularies)', () => {
  const tree = splitPane(splitPane(pane(PRIMARY), '', 'row', newMainPicker()), 'a', 'col', projects)
  const pruned = prunePanes(tree, (c) => c.kind !== 'msection')
  assert.deepEqual(
    panes(pruned).map((p) => p.content.kind),
    ['primary', 'mpicker'],
    'the section pane pruned away; primary and the picker stayed',
  )
})

test('closeMainPane keeps the primary invariant: down to one pane the tree dissolves', () => {
  const tree = splitPane(pane(PRIMARY), '', 'row', projects) as MainSplitNode
  assert.equal(closeMainPane(tree, 'b'), null, 'closing the last sibling dissolves the frame')
  const three = splitPane(splitPane(pane(PRIMARY), '', 'row', projects), 'b', 'col', artifacts)
  const two = closeMainPane(three, 'bb')
  assert.ok(two && two.kind === 'split', 'two panes remain a tree')
  assert.deepEqual(panes(two).map((p) => p.content.kind), ['primary', 'msection'])
})

test('an msection pane carries its facet (`sub`) through the JSON round-trip — the rail-routes-a-facet case', () => {
  const faceted: MainPaneContent = { kind: 'msection', id: 'projects', sub: 'mine' }
  const tree = splitPane(pane(PRIMARY), '', 'row', faceted)
  const revived = JSON.parse(JSON.stringify(tree)) as MainSplitNode
  const leaf = panes(revived).find((p) => p.content.kind === 'msection')
  assert.equal(leaf && leaf.content.kind === 'msection' ? leaf.content.sub : undefined, 'mine')
})

test('closeMainPane guards the primary: a tree that lost its primary dissolves rather than strand panes', () => {
  const tree = splitPane(pane(PRIMARY), '', 'row', projects) as MainSplitNode
  // Closing the PRIMARY through the plain rule (the UI routes it through
  // closePrimaryPane instead) leaves a primary-less tree — which dissolves to
  // the plain surface, never a trap.
  assert.equal(closeMainPane(tree, 'a'), null)
})

// ── Homogeneous close: the primary's TILE closes; its ROLE relocates ─────────

test('closePrimaryPane, two panes: the survivor promotes and the frame dissolves', () => {
  const tree = splitPane(pane(PRIMARY), '', 'row', projects) as MainSplitNode
  const res = closePrimaryPane(tree, 'a')
  assert.ok(res)
  assert.equal(res!.tree, null, 'one pane left → the frame dissolves to the plain surface')
  assert.deepEqual(res!.promoted, projects, 'the survivor’s content is handed up for the controller to navigate onto')
})

test('closePrimaryPane, nested sibling subtree: the first inheriting pane promotes and is re-stamped primary', () => {
  // split(primary@a, split(projects@ba, artifacts@bb)) — close the primary tile.
  const tree = splitPane(splitPane(pane(PRIMARY), '', 'row', projects), 'b', 'col', artifacts)
  const res = closePrimaryPane(tree, 'a')
  assert.ok(res && res.tree, 'two panes remain a tree')
  assert.deepEqual(res!.promoted, projects, 'the subtree’s first pane is the successor')
  assert.deepEqual(
    panes(res!.tree).map((p) => p.content.kind),
    ['primary', 'msection'],
    'exactly one primary again — the invariant holds through the relocation',
  )
})

test('closePrimaryPane refuses a non-primary path (those close through closeMainPane)', () => {
  const tree = splitPane(pane(PRIMARY), '', 'row', projects) as MainSplitNode
  assert.equal(closePrimaryPane(tree, 'b'), null)
  assert.equal(closePrimaryPane(tree, 'zz'), null)
})

test('retargetDraftPanes follows the materialized draft by CONTENT match — duplicates too; no-op returns the same tree', () => {
  const draftPane: MainPaneContent = { kind: 'msession', id: 'draft' }
  // [primary | [draft | draft]] — a duplicated draft pane must follow too.
  const tree = splitPane(splitPane(pane(PRIMARY), '', 'row', draftPane), 'b', 'col', draftPane)
  const next = retargetDraftPanes(tree, 'draft', 'sess-9')!
  assert.deepEqual(
    panes(next).map((p) => (p.content.kind === 'msession' ? p.content.id : p.content.kind)),
    ['primary', 'sess-9', 'sess-9'],
    'every draft conversation pane retargeted to the real id',
  )
  // Nothing showing the draft → the SAME reference back (no needless commit/persist).
  assert.equal(retargetDraftPanes(next, 'draft', 'sess-9'), next)
  assert.equal(retargetDraftPanes(null, 'draft', 'sess-9'), null)
})

// ── Context panels as FULL panes (universal split Phase 4) ───────────────────

const repoPanel: PaneContent = { kind: 'repo', id: 'repo-demo' }
const wsPanel: PaneContent = { kind: 'workspace', id: 'ws-demo' }

test('a context-panel pane tiles in the SAME tree as conversations and sections', () => {
  const tree = splitPane(pane(PRIMARY), '', 'row', contextPaneContent('auth-refactor', repoPanel))
  assert.deepEqual(
    panes(tree).map((p) => p.content.kind),
    ['primary', 'context-panel'],
    'one generic tree hosts every view kind — no separate right frame',
  )
})

test('context-pane identity dedups on (session, panel): a chip re-click focuses, never duplicates', () => {
  const a = contextPaneContent('auth-refactor', repoPanel)
  const b = contextPaneContent('auth-refactor', repoPanel)
  assert.equal(a.id, b.id, 'same session + same panel → same id')
  // findPane matches on (kind, id), so an existing pane is found and re-focused.
  const tree = splitPane(pane(PRIMARY), '', 'row', a)
  assert.equal(findPane(tree, b), 'b', 'the second click finds the first pane')
  // A different session or a different panel is a distinct pane.
  assert.notEqual(a.id, contextPaneContent('dashboard-perf', repoPanel).id)
  assert.notEqual(a.id, contextPaneContent('auth-refactor', wsPanel).id)
})

test('paneContentAlive: a detached repo dies; files survive on the KIND; runs need a run session', () => {
  const withRepo = paneContentAlive(liveWith({ repos: [{ id: 'repo-demo' } as Live['repos'][number]] }), false)
  assert.equal(withRepo(repoPanel), true)
  assert.equal(withRepo({ kind: 'repo', id: 'gone' }), false, 'a detached repo collapses its pane')

  const withFile = paneContentAlive(
    liveWith({ attachments: [{ kind: 'file', id: 'f2' } as Live['attachments'][number]] }),
    false,
  )
  // The pane's id was the initially-clicked file; it survives on ANY file remaining.
  assert.equal(withFile({ kind: 'file', id: 'f1-clicked' }), true)
  assert.equal(withFile({ kind: 'photo', id: 'p1' }), false)

  assert.equal(paneContentAlive(liveWith({}), true)({ kind: 'runs', id: 't1' }), true)
  assert.equal(paneContentAlive(liveWith({}), false)({ kind: 'runs', id: 't1' }), false)
})

test('mainPaneKeep + prunePanes: a context pane collapses when its panel or session vanishes; siblings stay', () => {
  // primary | context(auth-refactor,repo) | context(dead-session,ws) | projects
  const tree = splitPane(
    splitPane(
      splitPane(pane(PRIMARY), '', 'row', contextPaneContent('auth-refactor', repoPanel)),
      'b',
      'row',
      contextPaneContent('dead-session', wsPanel),
    ),
    'bb',
    'row',
    projects,
  )
  const liveFor = (id: string): Live | undefined =>
    id === 'auth-refactor' ? liveWith({ repos: [{ id: 'repo-demo' } as Live['repos'][number]] }) : undefined
  const pruned = prunePanes(tree, mainPaneKeep(liveFor, () => false))
  assert.deepEqual(
    panes(pruned).map((p) => p.content.kind),
    ['primary', 'context-panel', 'msection'],
    'the live repo pane + primary + section stayed; the gone-session context pane pruned away',
  )
  // The surviving context pane is the auth-refactor one (its repo is live).
  const cp = panes(pruned).find((p) => p.content.kind === 'context-panel')
  assert.equal(cp?.content.kind === 'context-panel' ? cp.content.sessionId : '', 'auth-refactor')
})

test('a context-panel pane round-trips JSON (sessionId + panel survive persistence)', () => {
  const tree = splitPane(pane(PRIMARY), '', 'row', contextPaneContent('auth-refactor', repoPanel))
  const revived = JSON.parse(JSON.stringify(tree)) as MainSplitNode
  const leaf = panes(revived).find((p) => p.content.kind === 'context-panel')
  assert.ok(leaf && leaf.content.kind === 'context-panel')
  assert.equal(leaf!.content.kind === 'context-panel' && leaf!.content.sessionId, 'auth-refactor')
  assert.deepEqual(leaf!.content.kind === 'context-panel' ? leaf!.content.panel : null, repoPanel)
  assert.equal(leaf!.content.id, contextPaneId('auth-refactor', repoPanel))
})

// ── The active session's context panel folds into the tree (Phase 4, step 2) ──

const panelOf = (c: MainPaneContent) => (c.kind === 'context-panel' ? c : null)

test('setFocusDrivenContextTree opens the panel from a lone primary: [primary | context], marked focusDriven', () => {
  const tree = setFocusDrivenContextTree(null, 'auth-refactor', repoPanel)
  assert.deepEqual(
    panes(tree).map((p) => p.content.kind),
    ['primary', 'context-panel'],
  )
  const ctx = panes(tree).find((p) => p.content.kind === 'context-panel')!
  assert.equal(panelOf(ctx.content)?.focusDriven, true, 'the focus-driven pane is marked focusDriven')
  assert.deepEqual(findFocusDrivenContext(tree)?.content.panel, repoPanel)
})

test('setFocusDrivenContextTree is a no-op when the panel is already open to the same (session, panel)', () => {
  const tree = setFocusDrivenContextTree(null, 'auth-refactor', repoPanel)
  assert.equal(setFocusDrivenContextTree(tree, 'auth-refactor', repoPanel), tree, 'same state → same reference (no churn/persist)')
})

test('setFocusDrivenContextTree swaps the panel in place on a session/panel change', () => {
  const tree = setFocusDrivenContextTree(null, 'auth-refactor', repoPanel)
  const swapped = setFocusDrivenContextTree(tree, 'dashboard-perf', wsPanel)!
  assert.equal(panes(swapped).length, 2, 'still two panes — replaced, not added')
  const ctx = findFocusDrivenContext(swapped)!
  assert.equal(ctx.content.sessionId, 'dashboard-perf')
  assert.deepEqual(ctx.content.panel, wsPanel)
})

test('setFocusDrivenContextTree(null panel) closes the panel; a lone primary dissolves the tree', () => {
  const tree = setFocusDrivenContextTree(null, 'auth-refactor', repoPanel)
  assert.equal(setFocusDrivenContextTree(tree, 'auth-refactor', null), null, 'closing the only extra pane → plain surface')
})

test('splitting the primary never ORPHANS its context pane (found by flag, not position)', () => {
  // Open the panel, then the user duplicates the primary (a section pane joins).
  const opened = setFocusDrivenContextTree(null, 'auth-refactor', repoPanel)!
  const primaryPath = panes(opened).find((p) => p.content.kind === 'primary')!.path
  const withDup = splitPane(opened, primaryPath, 'row', projects)
  // The context pane is no longer the primary's positional neighbor…
  const found = findFocusDrivenContext(withDup)
  assert.ok(found, 'still found by its primary flag')
  assert.deepEqual(found!.content.panel, repoPanel)
  // …and reconciling the SAME focus adds no duplicate.
  const again = setFocusDrivenContextTree(withDup, 'auth-refactor', repoPanel)
  assert.equal(again, withDup, 'no duplicate context pane minted after the primary split')
  assert.equal(
    panes(withDup).filter((p) => p.content.kind === 'context-panel').length,
    1,
  )
})

test('closePrimaryPane skips context panes (they cannot become the primary surface)', () => {
  // [primary | context] — closing the primary has nothing promotable → refused.
  const onlyCtx = setFocusDrivenContextTree(null, 'auth-refactor', repoPanel)!
  const pPath = panes(onlyCtx).find((p) => p.content.kind === 'primary')!.path
  assert.equal(closePrimaryPane(onlyCtx, pPath), null, 'a context pane is not a navigable surface')

  // Add a section beside the primary; now the primary close promotes the SECTION,
  // skipping the context pane.
  const withSection = splitPane(onlyCtx, pPath, 'row', projects)
  const p2 = panes(withSection).find((p) => p.content.kind === 'primary')!.path
  const res = closePrimaryPane(withSection, p2)
  assert.ok(res, 'promotable to the non-context pane')
  assert.equal(res!.promoted.kind, 'msection')
})

test('withoutFocusDrivenContext strips the TRANSIENT focus pane from storage but keeps PINNED context panes', () => {
  // [primary | context(primary)] then a pinned context pane beside the primary.
  const t1 = setFocusDrivenContextTree(null, 'S1', repoPanel)!
  const primaryPath = panes(t1).find((p) => p.content.kind === 'primary')!.path
  const pinned = unpinnedContent(contextPaneContent('S1', wsPanel, { focusDriven: true }))
  const t2 = splitPane(t1, primaryPath, 'row', pinned)
  const persisted = withoutFocusDrivenContext(t2)
  const kinds = panes(persisted).map((p) => p.content.kind)
  assert.ok(kinds.includes('primary') && kinds.includes('context-panel'), 'the pinned pane persists beside the primary')
  assert.equal(findFocusDrivenContext(persisted), null, 'the transient focus-driven pane is gone from storage')
  // A lone [primary | primary-context] persists as null (nothing user-created).
  assert.equal(withoutFocusDrivenContext(t1), null)
})

test('unpinnedContent strips the focusDriven flag (a duplicated context pane becomes an independent pinned pane)', () => {
  const pinned = unpinnedContent(contextPaneContent('auth-refactor', repoPanel, { focusDriven: true }))
  assert.equal(panelOf(pinned)?.focusDriven, undefined)
  // findFocusDrivenContext then ignores it — a pinned pane is not the focus-driven one.
  const tree = splitPane(pane(PRIMARY), '', 'row', pinned)
  assert.equal(findFocusDrivenContext(tree), null)
  // Non-context content is returned unchanged.
  assert.deepEqual(unpinnedContent(projects), projects)
})
