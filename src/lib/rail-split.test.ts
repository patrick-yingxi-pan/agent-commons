/** The rail reuses the universal split tree, restricted to vertical rooted
 * projections of one canonical tree. These pure tests lock the restriction
 * and close rule. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nodeAt, panes } from './splitFrame.ts'
import { closeRailView, initialRailSplit, splitRailView } from './railSplit.ts'

test('a rail begins as one complete-forest root', () => {
  const tree = initialRailSplit()
  assert.deepEqual(panes(tree), [{ path: '', content: { kind: 'rail-view', id: 'rail-root' } }])
})

test('splitting a focused rail view is vertical and roots the new view at the selected entry', () => {
  const root = {
    key: 'section/projects/item/p-insights',
    label: 'Insights dashboard',
    ancestors: ['section/projects'],
  }
  const tree = splitRailView(initialRailSplit(), '', root, 'second')
  assert.equal(tree.kind, 'split')
  if (tree.kind !== 'split') return
  assert.equal(tree.dir, 'col')
  assert.deepEqual((nodeAt(tree, 'a') as { content: unknown }).content, { kind: 'rail-view', id: 'rail-root' })
  assert.deepEqual((nodeAt(tree, 'b') as { content: unknown }).content, {
    kind: 'rail-view',
    id: 'second',
    root,
  })
})

test('nested rail views stay vertical and closing one promotes its sibling', () => {
  const first = splitRailView(initialRailSplit(), '', {
    key: 'section/artifacts',
    label: 'Artifacts',
    ancestors: [],
  }, 'second')
  const nested = splitRailView(first, 'b', {
    key: 'section/contexts',
    label: 'Contexts',
    ancestors: [],
  }, 'third')
  assert.equal(nodeAt(nested, 'b')?.kind, 'split')
  assert.equal(nodeAt(nested, 'b')?.kind === 'split' ? nodeAt(nested, 'b')?.dir : null, 'col')
  const closed = closeRailView(nested, 'ba')
  assert.deepEqual(panes(closed).map((item) => item.content.id), ['rail-root', 'third'])
})

test('the last rail view cannot close', () => {
  const tree = initialRailSplit()
  assert.equal(closeRailView(tree, ''), tree)
})
