import assert from 'node:assert/strict'
import test from 'node:test'
import { createDraftHistory, MAX_DRAFT_HISTORY_BYTES, MAX_DRAFT_HISTORY_STATES } from './draftHistory.ts'

const document = (title: string, text: string) => ({
  id: 'artifact-document-7',
  format: 'document' as const,
  blocks: [{ id: 'block-opening', type: 'paragraph', text }],
  metadata: { title, nested: { labels: ['one', 'two'] } },
})

test('undo and redo preserve exact nested authored values and stable IDs', () => {
  const history = createDraftHistory<ReturnType<typeof document>>()
  const before = document('Draft', 'Opening text')
  const after = document('Revised', 'Opening text\nSecond paragraph')

  history.record(before, after)

  assert.deepEqual(history.undo(after), before)
  assert.deepEqual(history.redo(before), after)
})

test('equal-content records preserve redo and reordered object keys are equal', () => {
  const history = createDraftHistory<{ value: number; nested: { left: string; right: string } }>()
  const before = { value: 1, nested: { left: 'L', right: 'R' } }
  const after = { value: 2, nested: { left: 'L', right: 'R' } }
  history.record(before, after)
  assert.deepEqual(history.undo(after), before)

  history.record({ nested: { right: 'R', left: 'L' }, value: 1 }, { value: 1, nested: { left: 'L', right: 'R' } })

  assert.equal(history.canUndo(), false)
  assert.equal(history.canRedo(), true)
  assert.deepEqual(history.redo(before), after)
})

test('consecutive records with the same symbol coalesce, and boundaries split groups', () => {
  const history = createDraftHistory<number>()
  const typing = Symbol('typing')
  const formatting = Symbol('formatting')
  history.record(0, 1, typing)
  history.record(1, 2, typing)
  history.record(2, 3, formatting)

  assert.equal(history.undo(3), 2)
  assert.equal(history.undo(2), 0)
  assert.equal(history.canUndo(), false)
  assert.equal(history.redo(0), 2)
  assert.equal(history.redo(2), 3)

  history.record(3, 4, typing)
  history.closeGroup()
  history.record(4, 5, typing)
  assert.equal(history.undo(5), 4)
  assert.equal(history.undo(4), 3)
})

test('a new actual edit branches and clears redo', () => {
  const history = createDraftHistory<string>()
  history.record('a', 'b')
  assert.equal(history.undo('b'), 'a')
  history.record('a', 'c')

  assert.equal(history.canRedo(), false)
  assert.equal(history.redo('a'), undefined)
  assert.equal(history.undo('c'), 'a')
})

test('JSON snapshots preserve negative zero rather than collapsing it to zero', () => {
  const history = createDraftHistory<number>()
  history.record(-0, 1)

  assert.deepEqual(history.undo(1), -0)
})

test('snapshots and returned values are detached from caller mutation', () => {
  const history = createDraftHistory<ReturnType<typeof document>>()
  const before = document('Draft', 'Original')
  const after = document('Draft', 'Changed')
  history.record(before, after)
  before.metadata.nested.labels[0] = 'mutated input'
  after.blocks[0].text = 'mutated input'

  const restored = history.undo(document('Draft', 'Changed'))!
  assert.equal(restored.blocks[0].text, 'Original')
  assert.deepEqual(restored.metadata.nested.labels, ['one', 'two'])
  restored.metadata.nested.labels[0] = 'mutated output'
  const replayed = history.redo(document('Draft', 'Original'))!
  assert.equal(replayed.blocks[0].text, 'Changed')
  assert.deepEqual(replayed.metadata.nested.labels, ['one', 'two'])
})

test('history retains at most the exported state limit', () => {
  const history = createDraftHistory<number>()
  for (let value = 0; value < MAX_DRAFT_HISTORY_STATES + 10; value += 1) {
    history.record(value, value + 1)
  }

  let current = MAX_DRAFT_HISTORY_STATES + 10
  let undos = 0
  while (history.canUndo()) {
    current = history.undo(current)!
    undos += 1
  }
  assert.equal(undos, MAX_DRAFT_HISTORY_STATES)
  assert.equal(current, 10)
})

test('serialized UTF-8 history stays within the exported byte limit', () => {
  const history = createDraftHistory<{ value: number; text: string }>()
  const text = 'x'.repeat(700_000)
  for (let value = 0; value < 4; value += 1) {
    history.record({ value, text }, { value: value + 1, text })
  }

  let current = { value: 4, text }
  const undone: number[] = []
  while (history.canUndo()) {
    current = history.undo(current)!
    undone.push(current.value)
  }
  assert.deepEqual(undone, [3, 2])
  assert.equal(MAX_DRAFT_HISTORY_BYTES, 2 * 1024 * 1024)
})

test('an individually oversized required prior state clears incompatible history', () => {
  const history = createDraftHistory<{ text: string }>()
  history.record({ text: 'a' }, { text: 'b' })
  const oversized = { text: 'x'.repeat(MAX_DRAFT_HISTORY_BYTES) }
  history.record(oversized, { text: 'small after oversized transition' })

  assert.equal(history.canUndo(), false)
  assert.equal(history.canRedo(), false)
})

test('undo can restore a small prior value without retaining an oversized redo value', () => {
  const history = createDraftHistory<{ text: string }>()
  const before = { text: 'small' }
  const oversized = { text: 'x'.repeat(MAX_DRAFT_HISTORY_BYTES) }
  history.record(before, oversized)

  assert.deepEqual(history.undo(oversized), before)
  assert.equal(history.canRedo(), false)
})

test('undo drops existing redo states when current cannot be retained', () => {
  const history = createDraftHistory<{ text: string }>()
  const first = { text: 'first' }
  const second = { text: 'second' }
  const third = { text: 'third' }
  history.record(first, second)
  history.record(second, third)
  assert.deepEqual(history.undo(third), second)
  assert.equal(history.canRedo(), true)

  assert.deepEqual(history.undo({ text: 'x'.repeat(MAX_DRAFT_HISTORY_BYTES) }), first)
  assert.equal(history.canRedo(), false)
})

test('redo drops existing undo states when current cannot be retained', () => {
  const history = createDraftHistory<{ text: string }>()
  const first = { text: 'first' }
  const second = { text: 'second' }
  const third = { text: 'third' }
  history.record(first, second)
  history.record(second, third)
  assert.deepEqual(history.undo(third), second)
  assert.equal(history.canUndo(), true)
  assert.equal(history.canRedo(), true)

  assert.deepEqual(history.redo({ text: 'x'.repeat(MAX_DRAFT_HISTORY_BYTES) }), third)
  assert.equal(history.canUndo(), false)
})

test('clear removes both directions and grouping state', () => {
  const history = createDraftHistory<number>()
  const group = Symbol('group')
  history.record(1, 2, group)
  history.clear()
  history.record(2, 3, group)
  history.record(3, 4, group)

  assert.equal(history.undo(4), 2)
  assert.equal(history.canUndo(), false)
})
