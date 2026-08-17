/** The rail reuses the universal split tree, restricted to vertical rooted
 * projections of one canonical tree. These pure tests lock the restriction
 * and close rule. */
import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { nodeAt, panes } from './splitFrame.ts'
import {
  canCloseRailView,
  closeRailView,
  getRailSplitPref,
  initialRailSplit,
  setRailSplitScope,
  splitRailView,
} from './railSplit.ts'

let storage: Map<string, string>
beforeEach(() => {
  storage = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
  }
  setRailSplitScope('rail-split-test')
})

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

test('nested rail views stay vertical and closing a rooted view promotes its sibling', () => {
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

test('the complete forest cannot close even when it has rooted siblings', () => {
  const tree = splitRailView(initialRailSplit(), '', {
    key: 'section/sessions',
    label: 'Sessions',
    ancestors: [],
  }, 'sessions')
  assert.equal(canCloseRailView(tree, 'a'), false, 'the recovery anchor never offers Close pane')
  assert.equal(closeRailView(tree, 'a'), tree, 'the model refuses deletion even if a stale caller invokes it')
  assert.equal(canCloseRailView(tree, 'b'), true, 'a rooted secondary view remains closable')
  assert.deepEqual(closeRailView(tree, 'b'), initialRailSplit(), 'closing the rooted view preserves the forest')
})

test('a legacy persisted tree without the complete forest repairs itself durably', () => {
  const orphan = {
    kind: 'pane',
    content: {
      kind: 'rail-view',
      id: 'sessions-only',
      root: { key: 'section/sessions', label: 'Sessions', ancestors: [] },
    },
  }
  storage.set('claude-ui.railsplit.v1.rail-split-test', JSON.stringify(orphan))

  const repaired = getRailSplitPref()
  assert.deepEqual(
    panes(repaired).map(({ content }) => ({ id: content.id, root: content.root?.key })),
    [
      { id: 'rail-root', root: undefined },
      { id: 'sessions-only', root: 'section/sessions' },
    ],
    'restore prepends the missing recovery anchor without discarding the surviving rooted view',
  )
  assert.deepEqual(JSON.parse(storage.get('claude-ui.railsplit.v1.rail-split-test')!), repaired)
})
