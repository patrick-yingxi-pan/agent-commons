import assert from 'node:assert/strict'
import { test } from 'node:test'
import { authoredArtifact, parseStructuredArtifactBody } from './artifactAuthoring.ts'
import { artifactBodyExcerpt } from './artifactExcerpt.ts'
import { relationContentPreview } from './relations.ts'
import { isSpreadsheetContent, parseAuthoredWorkbook, spreadsheetSheets } from './workbook.ts'

const workbook = () => ({
  type: 'workbook' as const,
  sheets: [
    { id: 'overview', name: 'Overview', columns: ['Metric', 'Value'], rows: [['Users', '42']], note: 'Literal values.' },
    { id: 'regional-2', name: 'Regional 2', columns: ['Region'], rows: [['North']] },
  ],
})

test('authored workbook parser preserves ordered literal tabs as detached values', () => {
  const raw = workbook()
  const parsed = parseAuthoredWorkbook(raw)
  assert.deepEqual(parsed, raw)
  assert.notEqual(parsed, raw)
  assert.notEqual(parsed?.sheets, raw.sheets)
  assert.notEqual(parsed?.sheets[0]?.rows, raw.sheets[0]?.rows)
  raw.sheets[0]!.rows[0]![0] = 'mutated'
  assert.equal(parsed?.sheets[0]?.rows[0]?.[0], 'Users')
  assert.equal(parseStructuredArtifactBody(workbook())?.type, 'workbook')
  const authored = authoredArtifact('report.xlsx', 'sheet', workbook())
  assert.equal(authored?.body.type, 'workbook')
  assert.deepEqual(authored?.draftBody, workbook())
  assert.equal(authored?.excerpt, '2 sheets · Overview')
  assert.equal(artifactBodyExcerpt(authored!.body), authored?.excerpt)
  const preview = relationContentPreview({
    kind: 'save-artifact', artifact: { name: 'Report', kind: 'sheet', meta: 'Workbook', body: workbook() },
  }, () => undefined, () => undefined)
  assert.equal(preview?.label, 'Sheet content')
  assert.deepEqual(preview?.structured, workbook())
})

test('spreadsheet projection leaves legacy sheets intact and gives them one stable compatibility tab', () => {
  const legacy = { type: 'sheet' as const, columns: ['A'], rows: [['=literal']], note: 'Note', revision: 3 }
  assert.equal(isSpreadsheetContent(legacy), true)
  const projected = spreadsheetSheets(legacy)
  assert.deepEqual(projected, [{ id: 'sheet-1', name: 'Sheet', columns: ['A'], rows: [['=literal']], note: 'Note' }])
  projected[0]!.rows[0]![0] = 'changed'
  assert.equal(legacy.rows[0]![0], '=literal')
  const saved = { ...workbook(), revision: 4 }
  assert.equal(isSpreadsheetContent(saved), true)
  assert.deepEqual(spreadsheetSheets(saved).map(({ id, name }) => ({ id, name })), [
    { id: 'overview', name: 'Overview' }, { id: 'regional-2', name: 'Regional 2' },
  ])
  assert.equal(isSpreadsheetContent({ type: 'slides', slides: [] }), false)
})

test('workbook parser rejects authority fields, malformed grids, and invalid tab identity or names', () => {
  const base = workbook()
  const invalid = [
    null,
    { ...base, revision: 0 },
    { ...base, extra: true },
    { ...base, sheets: [] },
    { ...base, sheets: Array.from({ length: 21 }, (_, i) => ({ ...base.sheets[0], id: `s${i}`, name: `S${i}` })) },
    { ...base, sheets: [base.sheets[0], { ...base.sheets[1], id: base.sheets[0].id }] },
    { ...base, sheets: [base.sheets[0], { ...base.sheets[1], id: 'bad.id' }] },
    { ...base, sheets: [base.sheets[0], { ...base.sheets[1], name: 'overview' }] },
    ...['', ' Leading', 'Trailing ', "'quoted", "quoted'", 'bad/name', 'bad\\name', 'bad?name', 'bad*name', 'bad:name', 'bad[name', 'x'.repeat(32), 'bad\u0001name', 'bad\u007fname', 'bad\ufffename', '\ud800', '\udc00'].map((name) => ({ ...base, sheets: [{ ...base.sheets[0], name }] })),
    { ...base, sheets: [{ ...base.sheets[0], columns: [] }] },
    { ...base, sheets: [{ ...base.sheets[0], rows: [] }] },
    { ...base, sheets: [{ ...base.sheets[0], rows: [['short']] }] },
    { ...base, sheets: [{ ...base.sheets[0], note: null }] },
    { ...base, sheets: [{ ...base.sheets[0], revision: 2 }] },
    { ...base, sheets: [{ ...base.sheets[0], permission: 'owner' }] },
    { ...base, sheets: [{ ...base.sheets[0], columns: Array(33).fill('C'), rows: [Array(33).fill('')] }] },
    { ...base, sheets: [{ ...base.sheets[0], rows: Array.from({ length: 201 }, () => ['a', 'b']) }] },
    { ...base, sheets: [{ ...base.sheets[0], rows: [['x'.repeat(2001), 'b']] }] },
  ]
  for (const candidate of invalid) assert.equal(parseAuthoredWorkbook(candidate), undefined, JSON.stringify(candidate))
  assert.equal(authoredArtifact('mismatch.xlsx', 'slide', workbook()), undefined)
})

test('workbook aggregate bounds cap literal cells and structure text across tabs', () => {
  const tooManyCells = {
    type: 'workbook',
    sheets: Array.from({ length: 20 }, (_, i) => ({
      id: `s${i}`, name: `Sheet ${i}`, columns: Array(32).fill('C'), rows: Array.from({ length: 11 }, () => Array(32).fill('')),
    })),
  }
  assert.equal(parseAuthoredWorkbook(tooManyCells), undefined, '20 * 11 * 32 exceeds 6400 data cells')
  assert.ok(parseAuthoredWorkbook({ ...tooManyCells, sheets: tooManyCells.sheets.slice(0, 18) }), 'the same well-formed grids are valid below the aggregate cell limit')
  const tooMuchText = {
    type: 'workbook',
    sheets: Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, name: `Sheet ${i}`, columns: ['Value'], rows: [['x'.repeat(2_000)]], note: 'n'.repeat(2_000) })),
  }
  assert.equal(parseAuthoredWorkbook(tooMuchText), undefined, 'grid labels, cell values and notes share the 20k ceiling')
  const atCellLimit = {
    type: 'workbook',
    sheets: Array.from({ length: 20 }, (_, i) => ({
      id: `s${i}`, name: `Sheet ${i}`, columns: Array(32).fill('C'), rows: Array.from({ length: 10 }, () => Array(32).fill('')),
    })),
  }
  assert.equal(parseAuthoredWorkbook(atCellLimit)?.sheets.length, 20)
})
