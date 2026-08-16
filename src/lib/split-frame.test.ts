/** Locking tests: the split frame's pure tree math (src/lib/splitFrame.ts, spec
 *  ADAPT-16) — the general tiling model for the right panel area. Dependency-free
 *  math, node-tested like railSplit. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  RATIO_MIN,
  RATIO_MAX,
  RATIO_DEFAULT,
  pane,
  panes,
  nodeAt,
  splitPane,
  closePane,
  replacePane,
  setRatio,
  prunePanes,
  findPane,
  sameContent,
  type PaneContent,
  type SplitNode,
} from './splitFrame.ts'

const ws: PaneContent = { kind: 'workspace', id: 'ws-demo' }
const repo: PaneContent = { kind: 'repo', id: 'repo-demo' }
const conn: PaneContent = { kind: 'connector', id: 'conn-gh' }
const photo: PaneContent = { kind: 'photo', id: 'p1' }

test('splitPane: a pane becomes a split keeping its content first; the new sibling takes the given content', () => {
  const root = splitPane(pane(ws), '', 'row', photo)
  assert.equal(root.kind, 'split')
  if (root.kind !== 'split') return
  assert.equal(root.dir, 'row')
  assert.equal(root.ratio, RATIO_DEFAULT)
  assert.deepEqual(root.a, pane(ws))
  assert.deepEqual(root.b, pane(photo))
})

test('splitPane on a nested path splits only that pane; splitting a split node is refused', () => {
  const root = splitPane(splitPane(pane(ws), '', 'row', repo), 'b', 'col', conn)
  assert.deepEqual(
    panes(root).map((p) => p.path),
    ['a', 'ba', 'bb'],
    'the b pane split in place; a stayed put',
  )
  assert.equal(nodeAt(root, 'b')?.kind, 'split')
  assert.equal((nodeAt(root, 'b') as Extract<SplitNode, { kind: 'split' }>).dir, 'col')
  assert.equal(splitPane(root, 'b', 'row', photo), root, 'splitting a split node is a no-op')
  assert.equal(splitPane(root, 'zz', 'row', photo), root, 'an invalid path is a no-op, not a crash')
})

test('closePane: the sibling takes the whole slot; closing the last pane dissolves the frame (null)', () => {
  const root = splitPane(splitPane(pane(ws), '', 'row', repo), 'b', 'col', conn)
  const closed = closePane(root, 'ba') // repo goes; conn takes b's slot
  assert.deepEqual(
    panes(closed as SplitNode).map((p) => p.content),
    [ws, conn],
  )
  assert.equal(closePane(pane(ws), ''), null, 'the last pane dissolves the frame')
  assert.equal(closePane(root, 'zz'), root, 'an invalid path is a no-op')
})

test('replacePane retargets a pane in place', () => {
  const root = splitPane(pane(ws), '', 'row', photo)
  const filled = replacePane(root, 'b', repo)
  assert.deepEqual(panes(filled).map((p) => p.content), [ws, repo])
  assert.equal(replacePane(root, '', conn), root, 'replacing a split node is a no-op')
})

test('setRatio clamps against the constant bounds — no sliver panes', () => {
  const root = splitPane(pane(ws), '', 'row', repo)
  assert.equal((setRatio(root, '', 0.02) as Extract<SplitNode, { kind: 'split' }>).ratio, RATIO_MIN)
  assert.equal((setRatio(root, '', 0.98) as Extract<SplitNode, { kind: 'split' }>).ratio, RATIO_MAX)
  assert.equal((setRatio(root, '', 0.3) as Extract<SplitNode, { kind: 'split' }>).ratio, 0.3)
})

test('prunePanes drops vanished content and collapses its splits; all-gone → null', () => {
  const root = splitPane(splitPane(pane(ws), '', 'row', repo), 'b', 'col', photo)
  const pruned = prunePanes(root, (c) => c.kind !== 'repo')
  assert.deepEqual(
    panes(pruned).map((p) => p.content),
    [ws, photo],
    'the repo pane collapsed away; the kept kinds survived',
  )
  assert.equal(prunePanes(pane(repo), () => false), null, 'nothing keepable → the frame dissolves')
  assert.equal(prunePanes(root, () => true), root, 'nothing to prune returns the SAME tree (no re-render churn)')
})

test('findPane locates visible content; duplicates are allowed and the first wins', () => {
  const root = splitPane(splitPane(pane(ws), '', 'row', ws), 'a', 'col', repo)
  assert.equal(findPane(root, ws), 'aa', 'the leftmost duplicate wins')
  assert.equal(findPane(root, conn), undefined)
  assert.equal(findPane(null, ws), undefined)
})

test('edits are immutable: the input tree is never mutated, untouched branches keep identity', () => {
  const root = splitPane(splitPane(pane(ws), '', 'row', repo), 'a', 'col', conn)
  const before = JSON.stringify(root)
  const edited = setRatio(root, 'a', 0.4)
  assert.equal(JSON.stringify(root), before, 'the input is untouched')
  assert.notEqual(edited, root)
  if (root.kind === 'split' && edited.kind === 'split') {
    assert.equal(edited.b, root.b, 'the untouched branch keeps identity (memo-friendly)')
  }
})

test('the tree round-trips JSON (the per-session persistence format)', () => {
  const root = splitPane(splitPane(pane(ws), '', 'row', repo), 'b', 'col', conn)
  const revived = JSON.parse(JSON.stringify(root)) as SplitNode
  assert.deepEqual(panes(revived), panes(root))
  assert.ok(sameContent(panes(revived)[0]!.content, ws))
})
