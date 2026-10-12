import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ARTIFACT_HISTORY_COMPARE_PAGE_SIZE,
  compareArtifactHistoryBodies,
} from './artifactHistoryCompare.ts'
import type { ArtifactHistoryBody } from '../../contract/artifactHistory.ts'

const values = (body: ArtifactHistoryBody) => compareArtifactHistoryBodies(body, body)

test('documents compare title, every block kind, literal fields, array positions, and shapes', () => {
  const before: ArtifactHistoryBody = {
    type: 'doc', title: 'Report', blocks: [
      { h: 'Heading' }, { p: 'same\ntext' }, { ul: ['first', ''] }, { code: ['x=1'] },
      { email: { to: 'a@example.test', subject: 'Hello' } },
    ],
  }
  const after: ArtifactHistoryBody = {
    type: 'doc', title: 'Report  ', blocks: [
      { p: 'Heading' }, { p: 'same\ntext ' }, { ul: ['first', 'second', 'third'] }, { code: ['x=2', ''] },
      { email: { to: 'b@example.test', subject: 'Hello' } },
    ],
  }
  const changes = compareArtifactHistoryBodies(before, after)
  assert.deepEqual(changes.map(({ label, before, after }) => [label, before, after]), [
    ['Document · Title', 'Report', 'Report  '],
    ['Block 1 · Type', 'Heading', 'Paragraph'],
    ['Block 1 · Heading', 'Heading', undefined],
    ['Block 1 · Paragraph', undefined, 'Heading'],
    ['Block 2 · Paragraph', 'same\ntext', 'same\ntext '],
    ['Block 3 · Bullet item count', '2', '3'],
    ['Block 3 · Bullet item 2', '', 'second'],
    ['Block 3 · Bullet item 3', undefined, 'third'],
    ['Block 4 · Code line count', '1', '2'],
    ['Block 4 · Code line 1', 'x=1', 'x=2'],
    ['Block 4 · Code line 2', undefined, ''],
    ['Block 5 · Email · To', 'a@example.test', 'b@example.test'],
  ])
  assert.equal(new Set(changes.map((change) => change.key)).size, changes.length)
})

test('legacy sheet comparison preserves literal cells and distinguishes missing notes from empty notes', () => {
  const before: ArtifactHistoryBody = {
    type: 'sheet', columns: ['Name', 'Formula'], rows: [['Alice', '=SUM(A1:A2)'], ['']],
  }
  const after: ArtifactHistoryBody = {
    type: 'sheet', columns: ['Name ', 'Formula'], rows: [['Alice', '=SUM(A1:A2) '], ['', 'new']], note: '',
  }
  const changes = compareArtifactHistoryBodies(before, after)
  assert.deepEqual(changes.map(({ label, before, after }) => [label, before, after]), [
    ['Sheet · Header A', 'Name', 'Name '],
    ['Sheet · Cell B1', '=SUM(A1:A2)', '=SUM(A1:A2) '],
    ['Sheet · Row 2 · Cell count', '1', '2'],
    ['Sheet · Cell B2', undefined, 'new'],
    ['Sheet · Note', undefined, ''],
  ])
})

test('sheet history distinguishes a formula tag from an identical literal source string', () => {
  const before: ArtifactHistoryBody = { type: 'sheet', columns: ['Value'], rows: [['=1+1']] }
  const after: ArtifactHistoryBody = { type: 'sheet', columns: ['Value'], rows: [[{ formula: '=1+1' }]] }
  assert.deepEqual(compareArtifactHistoryBodies(before, after).map(({ label, before, after }) => [label, before, after]), [
    ['Sheet · Cell A1 · Kind', 'Literal', 'Formula'],
  ])

  const changed: ArtifactHistoryBody = { type: 'sheet', columns: ['Value'], rows: [[{ formula: '=2+2' }]] }
  assert.deepEqual(compareArtifactHistoryBodies(after, changed).map(({ label, before, after }) => [label, before, after]), [
    ['Sheet · Cell A1', '=1+1', '=2+2'],
  ])
})

test('workbook tabs follow exact IDs through rename and reorder, comparing every grid field', () => {
  const before: ArtifactHistoryBody = {
    type: 'workbook', sheets: [
      { id: 'tab.one', name: 'Budget', columns: ['Item'], rows: [['rent']] },
      { id: 'tab_two', name: 'Notes', columns: ['Text'], rows: [['old']] },
    ],
  }
  const after: ArtifactHistoryBody = {
    type: 'workbook', sheets: [
      { id: 'tab_two', name: 'Notes', columns: ['Text'], rows: [['new']] },
      { id: 'tab.one', name: 'Plan', columns: ['Item', 'Cost'], rows: [['rent', '100']] },
    ],
  }
  const changes = compareArtifactHistoryBodies(before, after)
  assert.deepEqual(changes.map(({ label, before, after }) => [label, before, after]), [
    ['Sheet “Budget” · Position', '1', '2'],
    ['Sheet “Plan” · Name', 'Budget', 'Plan'],
    ['Sheet “Plan” · Header count', '1', '2'],
    ['Sheet “Plan” · Header B', undefined, 'Cost'],
    ['Sheet “Plan” · Row 1 · Cell count', '1', '2'],
    ['Sheet “Plan” · Cell B1', undefined, '100'],
    ['Sheet “Notes” · Position', '2', '1'],
    ['Sheet “Notes” · Cell A1', 'old', 'new'],
  ])
  assert.equal(new Set(changes.map((change) => change.key)).size, changes.length)
})

test('workbook tab addition and removal expose the tab and all its stored fields', () => {
  const before: ArtifactHistoryBody = { type: 'workbook', sheets: [{ id: 'same', name: 'Old', columns: ['A'], rows: [['x']] }] }
  const after: ArtifactHistoryBody = { type: 'workbook', sheets: [{ id: 'new', name: 'New', columns: ['B'], rows: [['y']] }] }
  const changes = compareArtifactHistoryBodies(before, after)
  assert.deepEqual(changes.map(({ label, before, after }) => [label, before, after]), [
    ['Sheet “Old” · Tab', 'present', undefined],
    ['Sheet “Old” · Position', '1', undefined],
    ['Sheet “Old” · Name', 'Old', undefined],
    ['Sheet “Old” · Header count', '1', '0'],
    ['Sheet “Old” · Header A', 'A', undefined],
    ['Sheet “Old” · Row count', '1', '0'],
    ['Sheet “Old” · Row 1 · Cell count', '1', '0'],
    ['Sheet “Old” · Cell A1', 'x', undefined],
    ['Sheet “New” · Tab', undefined, 'present'],
    ['Sheet “New” · Position', undefined, '1'],
    ['Sheet “New” · Name', undefined, 'New'],
    ['Sheet “New” · Header count', '0', '1'],
    ['Sheet “New” · Header A', undefined, 'B'],
    ['Sheet “New” · Row count', '0', '1'],
    ['Sheet “New” · Row 1 · Cell count', '0', '1'],
    ['Sheet “New” · Cell A1', undefined, 'y'],
  ])
})

test('slides compare position, title, bullet count, and literal bullet text', () => {
  const before: ArtifactHistoryBody = { type: 'slides', slides: [{ title: 'Intro', bullets: ['one', 'two'] }, { title: 'End', bullets: [] }] }
  const after: ArtifactHistoryBody = { type: 'slides', slides: [{ title: 'Intro ', bullets: ['one'] }] }
  assert.deepEqual(compareArtifactHistoryBodies(before, after).map(({ label, before, after }) => [label, before, after]), [
    ['Slides · Slide count', '2', '1'],
    ['Slide 1 · Title', 'Intro', 'Intro '],
    ['Slide 1 · Bullet count', '2', '1'],
    ['Slide 1 · Bullet 2', 'two', undefined],
    ['Slide 2 · Title', 'End', undefined],
  ])
})

test('format transitions are explicit and keep legacy sheets separate from workbook tab identity', () => {
  const before: ArtifactHistoryBody = { type: 'sheet', columns: ['A'], rows: [['x']] }
  const after: ArtifactHistoryBody = { type: 'workbook', sheets: [{ id: 'sheet-1', name: 'Sheet', columns: ['A'], rows: [['x']] }] }
  const changes = compareArtifactHistoryBodies(before, after)
  assert.equal(changes[0]?.label, 'Format')
  assert.deepEqual([changes[0]?.before, changes[0]?.after], ['sheet', 'workbook'])
  assert.equal(changes.some((change) => change.label === 'Sheet · Cell A1' && change.before === 'x' && change.after === undefined), true)
  assert.equal(changes.some((change) => change.label === 'Sheet “Sheet” · Cell A1' && change.before === undefined && change.after === 'x'), true)
  assert.equal(new Set(changes.map((change) => change.key)).size, changes.length)
})

test('equal copied bodies produce no changes and comparison never mutates either body', () => {
  const before: ArtifactHistoryBody = { type: 'doc', title: 'x', blocks: [{ ul: ['one'] }, { email: { to: '', subject: '' } }] }
  const copy: ArtifactHistoryBody = structuredClone(before)
  assert.deepEqual(compareArtifactHistoryBodies(before, copy), [])
  assert.deepEqual(before, copy)
  assert.equal(ARTIFACT_HISTORY_COMPARE_PAGE_SIZE, 20)
})

test('capacity-bound sheet differences are complete beyond the UI page size', () => {
  const columns = Array.from({ length: 32 }, (_, index) => `H${index}`)
  const before: ArtifactHistoryBody = { type: 'sheet', columns, rows: Array.from({ length: 200 }, () => Array(32).fill('before')) }
  const after: ArtifactHistoryBody = { type: 'sheet', columns, rows: Array.from({ length: 200 }, () => Array(32).fill('after')) }
  const changes = compareArtifactHistoryBodies(before, after)
  assert.equal(changes.length, 6_400)
  assert.equal(changes[0]?.label, 'Sheet · Cell A1')
  assert.equal(changes.at(-1)?.label, 'Sheet · Cell AF200')
  assert.equal(changes.at(-1)?.before, 'before')
  assert.equal(changes.at(-1)?.after, 'after')
  assert.ok(changes.length > ARTIFACT_HISTORY_COMPARE_PAGE_SIZE)
})

test('literal content that resembles markup, code, or instructions remains inert unchanged data', () => {
  const literal = '<script>throw new Error("literal text")</script> =HYPERLINK("https://example.test")'
  const before: ArtifactHistoryBody = { type: 'doc', title: 'Literal', blocks: [{ p: literal }] }
  const after: ArtifactHistoryBody = { type: 'doc', title: 'Literal', blocks: [{ p: `${literal} ` }] }
  const change = compareArtifactHistoryBodies(before, after)[0]
  assert.equal(change?.before, literal)
  assert.equal(change?.after, `${literal} `)
})

test('arbitrary tab IDs and names cannot collide in change keys', () => {
  const before: ArtifactHistoryBody = {
    type: 'workbook', sheets: [
      { id: 'x","workbook-sheet","y', name: 'A · Cell B1', columns: ['A'], rows: [['one']] },
      { id: 'x', name: 'Other', columns: ['A'], rows: [['two']] },
    ],
  }
  const after: ArtifactHistoryBody = structuredClone(before)
  if (after.type !== 'workbook') throw new Error('Expected workbook fixture')
  after.sheets[0]!.rows[0]![0] = 'changed one'
  after.sheets[1]!.rows[0]![0] = 'changed two'
  const changes = compareArtifactHistoryBodies(before, after)
  assert.equal(changes.length, 2)
  assert.notEqual(changes[0]?.key, changes[1]?.key)
})
