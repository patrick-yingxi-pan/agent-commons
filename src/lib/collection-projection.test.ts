import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  capCollectionProjection,
  collectionProjectionItems,
  defineCollectionProjection,
} from './collectionProjection.ts'

const rows = (prefix: string, count: number) =>
  collectionProjectionItems(
    Array.from({ length: count }, (_, index) => ({ id: `${prefix}-${index}`, name: `${prefix} ${index}` })),
    (row) => row.id,
    (row) => row.name,
  )

test('a global collection cap crosses group boundaries and retains the addressed item', () => {
  const projection = defineCollectionProjection({
    section: 'projects',
    fallbackLabel: 'Projects',
    empty: 'No projects.',
    railCap: 'global',
    groups: [
      { key: 'mine', label: 'Yours', role: 'partition', presentation: 'foldable', summary: '5 projects', items: rows('mine', 5) },
      { key: 'shared', label: 'Shared', role: 'partition', presentation: 'foldable', summary: '5 projects', items: rows('shared', 5) },
    ],
  })
  const capped = capCollectionProjection(
    projection,
    6,
    false,
    (item) => item.key === 'shared-4',
  )
  assert.deepEqual(capped.groups.map((group) => group.items.map((item) => item.key)), [
    ['mine-0', 'mine-1', 'mine-2', 'mine-3', 'mine-4'],
    ['shared-0', 'shared-4'],
  ])
  assert.equal(capped.hidden, 3)
  assert.deepEqual(
    projection.groups.map((group) => group.items.length),
    [5, 5],
    'the main projection is never reduced in place',
  )
})

test('named groups survive a global rail cap so the main and rail classifications stay symmetric', () => {
  const projection = defineCollectionProjection({
    section: 'projects',
    fallbackLabel: 'Projects',
    empty: 'No projects.',
    railCap: 'global',
    groups: [
      { key: 'first', label: 'First', role: 'partition', presentation: 'static', items: rows('first', 3) },
      { key: 'second', label: 'Second', role: 'partition', presentation: 'static', items: rows('second', 3) },
    ],
  })
  const capped = capCollectionProjection(projection, 3, false, () => false)
  assert.deepEqual(capped.groups.map((group) => [group.key, group.items.length]), [
    ['first', 2],
    ['second', 1],
  ])
  assert.equal(capped.hidden, 3)
})

test('structural collection sections cap independently and preserve selected empty groups', () => {
  const projection = defineCollectionProjection({
    section: 'artifacts',
    fallbackLabel: 'Artifacts',
    empty: 'No artifacts.',
    railCap: 'per-group',
    groups: [
      { key: 'one', label: 'One', role: 'section', presentation: 'foldable', summary: '3 artifacts', items: rows('one', 3) },
      { key: 'two', label: 'Two', role: 'section', presentation: 'foldable', summary: '3 artifacts', items: rows('two', 3) },
      { key: 'selected-empty', label: 'Selected', role: 'section', presentation: 'foldable', summary: '0 artifacts', keepEmpty: true, items: [] },
    ],
  })
  const capped = capCollectionProjection(projection, 2, false, () => false)
  assert.deepEqual(capped.groups.map((group) => [group.key, group.items.length]), [
    ['one', 2],
    ['two', 2],
    ['selected-empty', 0],
  ])
  assert.equal(capped.hidden, 2)
})

test('show all returns every runtime group and row', () => {
  const projection = defineCollectionProjection({
    section: 'sessions',
    fallbackLabel: 'Sessions',
    empty: 'No sessions.',
    railCap: 'global',
    groups: [
      { key: 'all', label: '', role: 'partition', presentation: 'flat', items: rows('session', 9) },
    ],
  })
  const expanded = capCollectionProjection(projection, 3, true, () => false)
  assert.equal(expanded.groups[0]?.items.length, 9)
  assert.equal(expanded.hidden, 0)
})
