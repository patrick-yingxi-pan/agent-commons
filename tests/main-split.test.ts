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
  mainPaneKeep,
  newMainPicker,
  paneContentAlive,
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
