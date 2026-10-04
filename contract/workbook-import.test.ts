import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_XLSX_CELLS,
  MAX_XLSX_SHEETS,
  MAX_XLSX_TEXT_BYTES,
} from './xlsxImport.mjs'
import { parseWorkbookImportResult, parseWorkbookSnapshot } from './workbookImport.ts'

const valid = {
  totalSheets: 4,
  hiddenSheets: 1,
  unsupportedSheets: 1,
  worksheets: [
    {
      sourceSheet: 1,
      name: 'Overview',
      cells: [
        { row: 1, column: 1, value: 'Title' },
        { row: 1, column: 2, value: '42', formula: 'cached' as const },
        { row: 3, column: 1, value: '', formula: 'missing' as const },
      ],
    },
    { sourceSheet: 4, name: 'Details', cells: [] },
  ],
}

const copy = <T>(value: T): T => structuredClone(value)
const oneSheet = (cells: unknown[] = [], overrides: Record<string, unknown> = {}) => {
  const { worksheets, ...fields } = overrides
  return {
    totalSheets: 1,
    hiddenSheets: 0,
    unsupportedSheets: 0,
    worksheets: worksheets ?? [{ sourceSheet: 1, name: 'Sheet1', cells }],
    ...fields,
  }
}

test('workbook snapshots copy ordered visible sheet names, cell values and formula state', () => {
  const input = copy(valid)
  const parsed = parseWorkbookSnapshot(input)
  assert.deepEqual(parsed, valid)
  assert.notEqual(parsed!.worksheets, input.worksheets)
  assert.notEqual(parsed!.worksheets[0]!.cells, input.worksheets[0]!.cells)
  assert.notEqual(parsed!.worksheets[0]!.cells[0], input.worksheets[0]!.cells[0])
  input.worksheets[0]!.name = 'Changed'
  input.worksheets[0]!.cells[0]!.value = 'Changed'
  assert.equal(parsed!.worksheets[0]!.name, 'Overview')
  assert.equal(parsed!.worksheets[0]!.cells[0]!.value, 'Title')
  assert.deepEqual(parseWorkbookSnapshot({ totalSheets: 1, hiddenSheets: 0, unsupportedSheets: 0, worksheets: [{ sourceSheet: 1, name: 'Empty', cells: [] }] })?.worksheets[0]?.cells, [])
})

test('closed records reject unknown, exotic and inherited fields at every level', () => {
  const unknownTop = { ...valid, path: '/private/book.xlsx' }
  const unknownSheet = copy(valid)
  ;(unknownSheet.worksheets[0] as any).state = 'hidden'
  const unknownCell = copy(valid)
  ;(unknownCell.worksheets[0]!.cells[0] as any).style = 'red'
  const inherited = Object.assign(Object.create({ path: '/private/book.xlsx' }), valid)
  const inheritedSheet = copy(valid)
  inheritedSheet.worksheets[0] = Object.assign(Object.create({ leaked: true }), inheritedSheet.worksheets[0]!)
  const symbolKey = copy(valid) as any
  symbolKey[Symbol('extra')] = true
  const undefinedFormula = oneSheet([{ row: 1, column: 1, value: '', formula: undefined }])

  for (const malformed of [null, [], new Date(), unknownTop, unknownSheet, unknownCell, inherited, inheritedSheet, symbolKey, undefinedFormula]) {
    assert.equal(parseWorkbookSnapshot(malformed), undefined)
  }
})

test('worksheet names and source indices are valid, unique, complete and ordered', () => {
  const bad = [
    { ...valid, worksheets: [...valid.worksheets].reverse() },
    { ...valid, worksheets: [{ ...valid.worksheets[0]!, sourceSheet: 4 }, valid.worksheets[1]] },
    { ...valid, worksheets: [valid.worksheets[0], { ...valid.worksheets[1]!, sourceSheet: 1 }] },
    { ...valid, worksheets: [valid.worksheets[0], { ...valid.worksheets[1]!, name: 'overview' }] },
    { ...oneSheet(), totalSheets: 2 },
    oneSheet([], { worksheets: [{ sourceSheet: 0, name: 'Sheet1', cells: [] }] }),
  ]
  for (const value of bad) assert.equal(parseWorkbookSnapshot(value), undefined)

  for (const name of ['', '   ', 'x'.repeat(32), 'bad/name', 'bad:name', 'bad?name', 'bad*name', 'bad[name', "'quoted", "quoted'"]) {
    assert.equal(parseWorkbookSnapshot({ ...oneSheet(), worksheets: [{ sourceSheet: 1, name, cells: [] }] }), undefined, `rejects worksheet name ${JSON.stringify(name)}`)
  }
  assert.ok(parseWorkbookSnapshot({ ...oneSheet(), worksheets: [{ sourceSheet: 1, name: 'valid name', cells: [] }] }))
})

test('cell coordinates are Excel-bounded, strictly ordered and unique', () => {
  const malformed = [
    [{ row: 1, column: 1, value: 'a' }, { row: 1, column: 1, value: 'duplicate' }],
    [{ row: 1, column: 2, value: 'a' }, { row: 1, column: 1, value: 'out of order' }],
    [{ row: 2, column: 1, value: 'a' }, { row: 1, column: 1, value: 'out of order' }],
    [{ row: 0, column: 1, value: 'row too small' }],
    [{ row: 1_048_577, column: 1, value: 'row too large' }],
    [{ row: 1.5, column: 1, value: 'fractional row' }],
    [{ row: 1, column: 0, value: 'column too small' }],
    [{ row: 1, column: 16_385, value: 'column too large' }],
    [{ row: 1, column: 1.5, value: 'fractional column' }],
  ]
  for (const cells of malformed) assert.equal(parseWorkbookSnapshot(oneSheet(cells)), undefined)
  assert.ok(parseWorkbookSnapshot(oneSheet([
    { row: 1, column: 1, value: '' },
    { row: 1_048_576, column: 16_384, value: 'last cell' },
  ])))
})

test('sheet, cell, and UTF-8 aggregate limits fail closed at their boundaries', () => {
  assert.ok(parseWorkbookSnapshot({
    totalSheets: MAX_XLSX_SHEETS,
    hiddenSheets: 0,
    unsupportedSheets: 0,
    worksheets: Array.from({ length: MAX_XLSX_SHEETS }, (_, index) => ({ sourceSheet: index + 1, name: `S${index + 1}`, cells: [] })),
  }))
  assert.equal(parseWorkbookSnapshot({ totalSheets: MAX_XLSX_SHEETS + 1, hiddenSheets: 0, unsupportedSheets: 0, worksheets: [] }), undefined)
  assert.equal(parseWorkbookSnapshot({ ...oneSheet(), totalSheets: 1.5 }), undefined)
  assert.equal(parseWorkbookSnapshot({ ...oneSheet(), hiddenSheets: -1 }), undefined)
  assert.equal(parseWorkbookSnapshot({ ...oneSheet(), unsupportedSheets: Number.MAX_SAFE_INTEGER }), undefined)
  assert.equal(parseWorkbookSnapshot({ ...oneSheet(), hiddenSheets: 1, unsupportedSheets: 1 }), undefined)
  assert.equal(parseWorkbookSnapshot(oneSheet(Array.from({ length: MAX_XLSX_CELLS + 1 }, (_, index) => ({ row: index + 1, column: 1, value: '' })))), undefined)
  assert.ok(parseWorkbookSnapshot(oneSheet([{ row: 1, column: 1, value: 'x'.repeat(MAX_XLSX_TEXT_BYTES - 'Sheet1'.length) }])))
  assert.equal(parseWorkbookSnapshot(oneSheet([{ row: 1, column: 1, value: 'é'.repeat(MAX_XLSX_TEXT_BYTES / 2) }])), undefined,
    'UTF-8 byte count includes multi-byte cell text and worksheet names')
  assert.equal(parseWorkbookSnapshot(oneSheet([{ row: 1, column: 1, value: '\ud800' }])), undefined, 'lone surrogates are lossy under UTF-8 encoding')
})

test('formula state is explicit and missing cached results require an empty value', () => {
  assert.ok(parseWorkbookSnapshot(oneSheet([
    { row: 1, column: 1, value: 'cached value', formula: 'cached' },
    { row: 1, column: 2, value: '', formula: 'missing' },
    { row: 1, column: 3, value: 'literal' },
  ])))
  for (const cell of [
    { row: 1, column: 1, value: 'formula result', formula: 'evaluated' },
    { row: 1, column: 1, value: 'no cached value', formula: 'missing' },
  ]) assert.equal(parseWorkbookSnapshot(oneSheet([cell])), undefined)
})

test('a leading Unicode BOM is literal cell text, not a byte-stream signature', () => {
  for (const value of ['\ufeff', '\ufeffleading marker', 'valid 😀 pair']) {
    const result = parseWorkbookSnapshot(oneSheet([{ row: 1, column: 1, value }]))
    assert.equal(result?.worksheets[0]?.cells[0]?.value, value)
  }
})

test('import result requires a visible worksheet when ready and refuses all partial or extra data', () => {
  const result = parseWorkbookImportResult({ documentImport: { format: 'xlsx', status: 'ready' }, workbook: valid })
  assert.deepEqual(result, { documentImport: { format: 'xlsx', status: 'ready' }, workbook: valid })
  const allUnviewable = { totalSheets: 1, hiddenSheets: 1, unsupportedSheets: 0, worksheets: [] }
  assert.deepEqual(parseWorkbookImportResult({ documentImport: { format: 'xlsx', status: 'ready' }, workbook: allUnviewable }), {
    documentImport: { format: 'xlsx', status: 'invalid' },
  })
  for (const partial of [
    { documentImport: { format: 'xlsx', status: 'ready' } },
    { documentImport: { format: 'xlsx', status: 'ready' }, workbook: { ...valid, leaked: true } },
    { documentImport: { format: 'xlsx', status: 'text-limit' }, workbook: valid },
    { documentImport: { format: 'xlsx', status: 'no-text' }, workbook: undefined },
    { documentImport: { format: 'xlsx', status: 'no-text' }, text: 'partial text' },
    { documentImport: { format: 'xlsx', status: 'ready' }, workbook: valid, text: 'second source' },
    Object.assign(Object.create({ extra: true }), { documentImport: { format: 'xlsx', status: 'no-text' } }),
  ]) {
    assert.deepEqual(parseWorkbookImportResult(partial), { documentImport: { format: 'xlsx', status: 'invalid' } })
  }
  assert.deepEqual(parseWorkbookImportResult({ documentImport: { format: 'xlsx', status: 'no-text' } }), {
    documentImport: { format: 'xlsx', status: 'no-text' },
  })
})
