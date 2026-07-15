/** Locking tests: the MAIN workspace split's vocabulary + tree rules
 *  (universal split Phase 2, docs/design/universal-split-workspace.md §2.1) —
 *  the generic split math instantiated with the main-pane content, and the
 *  primary-pane invariant the close rule keeps. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { panes, prunePanes, splitPane, pane } from '../src/lib/splitFrame.ts'
import { PRIMARY, closeMainPane, closePrimaryPane, newMainPicker, type MainPaneContent, type MainSplitNode } from '../src/lib/mainSplit.ts'

const projects: MainPaneContent = { kind: 'msection', id: 'projects' }
const artifacts: MainPaneContent = { kind: 'msection', id: 'artifacts' }

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
