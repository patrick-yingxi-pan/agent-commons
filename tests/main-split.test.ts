/** Locking tests: the MAIN workspace split's vocabulary + tree rules
 *  (universal split Phase 2, docs/design/universal-split-workspace.md §2.1) —
 *  the generic split math instantiated with the main-pane content, and the
 *  primary-pane invariant the close rule keeps. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { panes, prunePanes, splitPane, pane } from '../src/lib/splitFrame.ts'
import { PRIMARY, closeMainPane, newMainPicker, type MainPaneContent, type MainSplitNode } from '../src/lib/mainSplit.ts'

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

test('closeMainPane guards the primary: a tree that lost its primary dissolves rather than strand panes', () => {
  const tree = splitPane(pane(PRIMARY), '', 'row', projects) as MainSplitNode
  // Closing the PRIMARY itself (the UI refuses; the rule still holds) leaves a
  // primary-less tree — which dissolves to the plain surface, never a trap.
  assert.equal(closeMainPane(tree, 'a'), null)
})
