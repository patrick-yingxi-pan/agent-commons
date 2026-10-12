import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MAX_AUTHORED_CELL_CHARS, MAX_AUTHORED_STRUCTURE_CHARS } from '../../contract/artifactAuthoring.ts'
import { MAX_AUTHORED_SHEET_COLUMNS, MAX_AUTHORED_SHEET_ROWS, MAX_AUTHORED_WORKBOOK_CELLS } from '../../contract/workbook.ts'
import { MAX_SHEET_PASTE_BYTES, pasteSheetCells, reconcileSheetPasteFeedback, type SheetPasteFeedback, type SpreadsheetBody } from './sheetPaste.ts'

function sheet(columns = ['A', 'B'], rows = [['keep-a', 'keep-b'], ['stay-a', 'stay-b']], note = 'sheet note'): SpreadsheetBody {
  return { type: 'sheet', columns, rows, note }
}

function ready(result: ReturnType<typeof pasteSheetCells>) {
  assert.equal(result.kind, 'ready')
  if (result.kind !== 'ready') throw new Error('Expected a ready paste result')
  return result
}

function refused(result: ReturnType<typeof pasteSheetCells>, text: RegExp) {
  assert.equal(result.kind, 'error')
  if (result.kind !== 'error') throw new Error('Expected paste refusal')
  assert.match(result.message, text)
  assert.match(result.message, /Nothing was pasted\./)
}

test('paste feedback retires after an observed edit and cannot resurrect when equal text returns', () => {
  const before = sheet()
  const after = ready(pasteSheetCells(before, 'sheet-1', 0, 0, 'new\tvalues')).body
  let state: SheetPasteFeedback | null = { before, after: JSON.stringify(after), message: 'Pasted', error: false }
  assert.equal(reconcileSheetPasteFeedback(state, structuredClone(after)), state)
  state = reconcileSheetPasteFeedback(state, before)
  assert.equal(state, null)
  assert.equal(reconcileSheetPasteFeedback(state, after), null)
})

test('plain single-line text keeps native textarea paste behavior', () => {
  assert.deepEqual(pasteSheetCells(sheet(), 'sheet-1', 0, 0, 'literal formula =SUM(A1:A2)'), { kind: 'native' })
  assert.deepEqual(pasteSheetCells(sheet(), 'missing', -1, -1, 'plain text'), { kind: 'native' })
})

test('quoted TSV pastes literal multiline and trailing-empty cells at an offset and preserves workbook identity', () => {
  const body: SpreadsheetBody = {
    type: 'workbook',
    sheets: [
      { id: 'sales_q1', name: 'Sales Q1', columns: ['Name', 'Note'], rows: [['Ada', 'old'], ['Grace', 'stay']], note: 'keep first note' },
      { id: 'archive', name: 'Archive', columns: ['Year'], rows: [['2025']], note: 'keep other tab' },
    ],
  }
  const before = structuredClone(body)
  const source = '"tab\tvalue"\t=SUM(A1:A2)\t\r\n"line 1\nline 2"\t\tend\n'

  const result = ready(pasteSheetCells(body, 'sales_q1', 1, 1, source))

  assert.deepEqual([result.rows, result.columns], [2, 3])
  assert.deepEqual(result.body, {
    type: 'workbook',
    sheets: [
      {
        id: 'sales_q1', name: 'Sales Q1',
        columns: ['Name', 'Note', 'Column 3', 'Column 4'],
        rows: [
          ['Ada', 'old', '', ''],
          ['Grace', 'tab\tvalue', '=SUM(A1:A2)', ''],
          ['', 'line 1\nline 2', '', 'end'],
        ],
        note: 'keep first note',
      },
      { id: 'archive', name: 'Archive', columns: ['Year'], rows: [['2025']], note: 'keep other tab' },
    ],
  })
  assert.deepEqual(body, before, 'paste returns a detached body and does not mutate input')
})

test('sheet paste preserves current grid data, labels and note while growing only the needed range', () => {
  const body = sheet(['Person', 'Status'], [['Ada', 'open'], ['Grace', 'closed']], 'private note')
  const before = structuredClone(body)
  const result = ready(pasteSheetCells(body, 'sheet-1', 1, 1, 'new\t\tvalue\nsecond\t\tlast'))

  assert.deepEqual(result.body, {
    type: 'sheet',
    columns: ['Person', 'Status', 'Column 3', 'Column 4'],
    rows: [['Ada', 'open', '', ''], ['Grace', 'new', '', 'value'], ['', 'second', '', 'last']],
    note: 'private note',
  })
  assert.deepEqual(body, before)
})

test('range paste always imports literal strings and discloses formula cells it replaces', () => {
  const body: SpreadsheetBody = {
    type: 'sheet', columns: ['Value', 'Calculation'],
    rows: [['old', { formula: '=1+1' }], ['keep', { formula: '=SUM(A1:A1)' }]],
  }
  const result = ready(pasteSheetCells(body, 'sheet-1', 0, 0, '=literal\t=3+4\nnext\t=SUM(A1:A1)'))
  assert.equal(result.replacedFormulas, 2)
  assert.deepEqual(result.body, {
    type: 'sheet', columns: ['Value', 'Calculation'],
    rows: [['=literal', '=3+4'], ['next', '=SUM(A1:A1)']],
  })
})

test('malformed quoted values and ragged TSV refuse the whole paste', () => {
  for (const source of ['a\tb\nshort', '"unterminated\tvalue', 'before"quote\tvalue', '"closed"tail\tvalue']) {
    refused(pasteSheetCells(sheet(), 'sheet-1', 0, 0, source), /rectangular table.*valid quoted values/i)
  }
})

test('destination IDs and coordinates must resolve to existing cells', () => {
  const body = sheet()
  for (const [id, row, column] of [
    ['missing', 0, 0], ['sheet-1', -1, 0], ['sheet-1', 0, -1], ['sheet-1', 0.5, 0],
    ['sheet-1', 2, 0], ['sheet-1', 0, 2],
  ] as const) {
    refused(pasteSheetCells(body, id, row, column, 'x\ty'), /existing destination cell/i)
  }
  const workbook: SpreadsheetBody = { type: 'workbook', sheets: [
    { id: 'real_tab', name: 'Real tab', columns: ['A'], rows: [['x']] },
  ] }
  refused(pasteSheetCells(workbook, 'sheet-1', 0, 0, 'x\ty'), /existing destination cell/i)
})

test('row and column boundaries accept exact dimensions and refuse growth beyond them', () => {
  const rowLimitBody = sheet(['A'], [['old']])
  const exactRows = Array.from({ length: MAX_AUTHORED_SHEET_ROWS }, (_, index) => `row-${index}`).join('\n')
  assert.equal(ready(pasteSheetCells(rowLimitBody, 'sheet-1', 0, 0, exactRows)).body.type, 'sheet')
  const overRows = `${exactRows}\nextra`
  refused(pasteSheetCells(rowLimitBody, 'sheet-1', 0, 0, overRows), /fit within 200 rows and 32 columns/i)

  const columnLimitBody = sheet(['A'], [['old']])
  const exactColumns = Array.from({ length: MAX_AUTHORED_SHEET_COLUMNS }, (_, index) => `c${index}`).join('\t')
  assert.equal(ready(pasteSheetCells(columnLimitBody, 'sheet-1', 0, 0, exactColumns)).body.type, 'sheet')
  const overColumns = `${exactColumns}\textra`
  refused(pasteSheetCells(columnLimitBody, 'sheet-1', 0, 0, overColumns), /fit within 200 rows and 32 columns/i)
})

test('cell and aggregate authored-character limits accept exact boundaries and refuse overflow', () => {
  const exactCell = 'x'.repeat(MAX_AUTHORED_CELL_CHARS)
  assert.equal(ready(pasteSheetCells(sheet(['A'], [['']]), 'sheet-1', 0, 0, `${exactCell}\t`)).body.type, 'sheet')
  refused(pasteSheetCells(sheet(['A'], [['']]), 'sheet-1', 0, 0, `${exactCell}x\t`), /2,000 characters/i)

  const aggregateBody = sheet(['A'], [
    ...Array.from({ length: 9 }, () => ['x'.repeat(2_000)]),
    [''],
  ], '')
  const exactAggregate = 'y'.repeat(MAX_AUTHORED_STRUCTURE_CHARS - 9 * MAX_AUTHORED_CELL_CHARS - 1)
  assert.equal(exactAggregate.length, 1_999)
  assert.equal(ready(pasteSheetCells(aggregateBody, 'sheet-1', 9, 0, `${exactAggregate}\n`)).body.type, 'sheet')
  refused(pasteSheetCells(aggregateBody, 'sheet-1', 9, 0, `${exactAggregate}y\n`), /20,000-character limits/i)

  const exactCellBudgetBody: SpreadsheetBody = { type: 'workbook', sheets: [
    { id: 'left', name: 'Left', columns: Array.from({ length: 32 }, (_, index) => `L${index + 1}`),
      rows: Array.from({ length: 100 }, () => Array(32).fill('')) },
    { id: 'right', name: 'Right', columns: Array.from({ length: 32 }, (_, index) => `R${index + 1}`),
      rows: Array.from({ length: 100 }, () => Array(32).fill('')) },
  ] }
  assert.equal(ready(pasteSheetCells(exactCellBudgetBody, 'left', 0, 0, 'x\n')).body.type, 'workbook')

  const cellBudgetBody: SpreadsheetBody = { type: 'workbook', sheets: [
    { id: 'target', name: 'Target', columns: Array.from({ length: 31 }, (_, index) => `C${index + 1}`),
      rows: Array.from({ length: 200 }, () => Array(31).fill('')) },
    { id: 'other', name: 'Other', columns: ['A'], rows: [['']] },
  ] }
  const overCells = pasteSheetCells(cellBudgetBody, 'target', 199, 30, 'x\ty')
  refused(overCells, new RegExp(`${MAX_AUTHORED_WORKBOOK_CELLS.toLocaleString()}-cell`))
})

test('source UTF-8 size is bounded before parsing, with exact byte limit reaching structural validation', () => {
  const overLimit = 'x'.repeat(MAX_SHEET_PASTE_BYTES + 1) + '\t'
  refused(pasteSheetCells(sheet(['A'], [['']]), 'sheet-1', 0, 0, overLimit), /up to 256 KiB/i)

  const exactLimit = '\t'.repeat(MAX_SHEET_PASTE_BYTES)
  assert.equal(exactLimit.length, MAX_SHEET_PASTE_BYTES)
  refused(pasteSheetCells(sheet(['A'], [['']]), 'sheet-1', 0, 0, exactLimit), /fit within 200 rows and 32 columns/i)

  const unicodeOverLimit = `${'界'.repeat(Math.floor(MAX_SHEET_PASTE_BYTES / 3) + 1)}\t`
  assert.ok(new TextEncoder().encode(unicodeOverLimit).byteLength > MAX_SHEET_PASTE_BYTES)
  refused(pasteSheetCells(sheet(['A'], [['']]), 'sheet-1', 0, 0, unicodeOverLimit), /up to 256 KiB/i)
})

test('range expansion counts only actual replaced formula cells, never absent destinations', () => {
  assert.equal(ready(pasteSheetCells(sheet(['A'], [['before']]), 'sheet-1', 0, 0, 'a\tb\nc\td')).replacedFormulas, 0)
  assert.equal(ready(pasteSheetCells({ type: 'sheet', columns: ['A'], rows: [[{ formula: '=1' }]] }, 'sheet-1', 0, 0, 'a\tb\nc\td')).replacedFormulas, 1)
})

test('whole-workbook validation includes untouched tabs and never partially applies a rejected range', () => {
  const body: SpreadsheetBody = { type: 'workbook', sheets: [
    { id: 'target', name: 'Target', columns: ['A'], rows: [['before']] },
    { id: 'full', name: 'Full', columns: ['B'], rows: [
      ...Array.from({ length: 9 }, () => ['x'.repeat(2_000)]), ['x'.repeat(1_990)],
    ] },
  ] }
  const before = structuredClone(body)
  ready(pasteSheetCells(body, 'target', 0, 0, '12345678\n'))
  refused(pasteSheetCells(body, 'target', 0, 0, '123456789\n'), /20,000-character/)
  assert.deepEqual(body, before)
  const invalidName = structuredClone(body)
  invalidName.sheets[1]!.name = 'Target'
  refused(pasteSheetCells(invalidName, 'target', 0, 0, 'x\n'), /worksheet names/)
})
