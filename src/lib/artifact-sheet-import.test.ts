import test from 'node:test'
import assert from 'node:assert/strict'
import type { WorkbookSnapshot } from '../../contract/workbookImport.ts'
import { mapArtifactSheetImport, reviewArtifactSheetImport, isArtifactSheetFileName } from './artifactSheetImport.ts'
import { MAX_AUTHORED_CELL_CHARS } from '../../contract/artifactAuthoring.ts'

function file(name: string, text: string) {
  return { name, kind: 'file' as const, text }
}

function workbookFile(workbook: WorkbookSnapshot, overrides: Record<string, unknown> = {}) {
  return {
    name: 'budget.xlsx',
    kind: 'file' as const,
    documentImport: { format: 'xlsx', status: 'ready' },
    workbook,
    ...overrides,
  }
}

function sourceWorkbook(worksheets: WorkbookSnapshot['worksheets'], options: Partial<WorkbookSnapshot> = {}): WorkbookSnapshot {
  return {
    totalSheets: options.totalSheets ?? worksheets.length,
    hiddenSheets: options.hiddenSheets ?? 0,
    unsupportedSheets: options.unsupportedSheets ?? 0,
    worksheets,
  }
}

test('recognizes CSV, TSV and XLSX names case-insensitively', () => {
  assert.equal(isArtifactSheetFileName('metrics.CSV'), true)
  assert.equal(isArtifactSheetFileName('metrics.tsv'), true)
  assert.equal(isArtifactSheetFileName('metrics.csv.bak'), false)
  assert.equal(isArtifactSheetFileName('metrics.xlsx'), true)
})

test('XLSX review requires one file, ready workbook outcome, validated workbook and no text mixing', () => {
  const workbook = sourceWorkbook([{ sourceSheet: 1, name: 'Summary', cells: [{ row: 1, column: 1, value: 'Revenue' }] }])
  const reviewed = reviewArtifactSheetImport([workbookFile(workbook)])
  assert.equal(reviewed.status, 'ready')
  if (reviewed.status === 'ready') {
    assert.equal('workbook' in reviewed, true)
    assert.equal(reviewed.name, 'budget.xlsx')
    assert.deepEqual(reviewed.workbook, workbook)
    workbook.worksheets[0]!.cells[0]!.value = 'mutated after review'
    assert.equal(reviewed.workbook.worksheets[0]!.cells[0]!.value, 'Revenue', 'review owns a detached workbook snapshot')
  }

  assert.equal(reviewArtifactSheetImport([]).status, 'cancelled')
  assert.equal(reviewArtifactSheetImport([workbookFile(workbook), workbookFile(workbook)]).status, 'error')
  assert.equal(reviewArtifactSheetImport([workbookFile(workbook, { kind: 'photo' })]).status, 'error')
  assert.equal(reviewArtifactSheetImport([workbookFile(workbook, { name: 'budget.csv' })]).status, 'error')
  assert.equal(reviewArtifactSheetImport([workbookFile(workbook, { text: '' })]).status, 'error', 'even empty text cannot mix with a workbook payload')
  assert.equal(reviewArtifactSheetImport([workbookFile(workbook, { workbook: undefined })]).status, 'error')
  assert.equal(reviewArtifactSheetImport([workbookFile(workbook, { documentImport: { format: 'pptx', status: 'ready' } })]).status, 'error')
  const failed = reviewArtifactSheetImport([workbookFile(workbook, { documentImport: { format: 'xlsx', status: 'file-too-large' }, workbook: undefined })])
  assert.equal(failed.status, 'error')
  if (failed.status === 'error') assert.match(failed.message, /up to 8 MB/)
  assert.equal(reviewArtifactSheetImport([workbookFile(workbook, { workbook: { ...workbook, extra: true } as any })]).status, 'error')
  assert.equal(reviewArtifactSheetImport([file('budget.csv', 'A,B\n1,2')]).status, 'ready', 'delimited acceptance remains unchanged')
})

test('XLSX mapping selects one visible worksheet and preserves sparse literal cached values', () => {
  const workbook = sourceWorkbook([
    { sourceSheet: 1, name: 'Instructions', cells: [{ row: 1, column: 1, value: 'Do not import me' }] },
    { sourceSheet: 3, name: 'Revenue', cells: [
      { row: 3, column: 4, value: 'Metric' },
      { row: 3, column: 5, value: 'Secondary' },
      { row: 3, column: 6, value: 'Cached formula' },
      { row: 4, column: 4, value: 'Revenue' },
      { row: 4, column: 6, value: '=SUM(A1:A2)', formula: 'cached' },
    ] },
  ], { totalSheets: 4, hiddenSheets: 1, unsupportedSheets: 1 })
  const candidate = reviewArtifactSheetImport([workbookFile(workbook)])
  assert.equal(candidate.status, 'ready')
  if (candidate.status !== 'ready') return

  const selected = mapArtifactSheetImport(candidate, true, 3)
  assert.equal(selected.status, 'ready')
  if (selected.status === 'ready') {
    assert.deepEqual(selected.body, {
      type: 'sheet',
      columns: ['Metric', 'Secondary', 'Cached formula'],
      rows: [['Revenue', '', '=SUM(A1:A2)']],
    })
    assert.deepEqual(selected.worksheet, { sourceSheet: 3, name: 'Revenue' })
    assert.match(selected.disclosure, /D3:F4.*cropped/i)
    assert.match(selected.disclosure, /1 hidden sheet.*1 unsupported/i)
    assert.match(selected.disclosure, /cached.*may be out of date/i)
    assert.match(selected.disclosure, /not calculated|not evaluated/i)
    assert.match(selected.disclosure, /dates.*raw values/i)
    assert.match(selected.disclosure, /formatting.*merged/i)
  }

  const defaulted = mapArtifactSheetImport(candidate, false)
  assert.equal(defaulted.status, 'ready')
  if (defaulted.status === 'ready') {
    assert.deepEqual(defaulted.worksheet, { sourceSheet: 1, name: 'Instructions' })
    assert.deepEqual(defaulted.body.rows, [['Do not import me']])
  }
  assert.equal(mapArtifactSheetImport(candidate, true, 2).status, 'error', 'hidden and unsupported sheets are not selectable')
})

test('all-visible XLSX mapping imports every visible worksheet atomically in source order', () => {
  const candidate = reviewArtifactSheetImport([workbookFile(sourceWorkbook([
    { sourceSheet: 1, name: 'FY 2025', cells: [{ row: 1, column: 1, value: 'Metric' }, { row: 2, column: 1, value: 'Revenue' }] },
    { sourceSheet: 3, name: 'Exact Name', cells: [{ row: 1, column: 1, value: 'Metric' }, { row: 2, column: 1, value: 'Costs' }] },
  ], { totalSheets: 3, hiddenSheets: 1 }))])
  assert.equal(candidate.status, 'ready')
  if (candidate.status !== 'ready') return
  const mapped = mapArtifactSheetImport(candidate, true, undefined, true)
  assert.equal(mapped.status, 'ready')
  if (mapped.status !== 'ready') return
  assert.deepEqual(mapped.body, {
    type: 'workbook',
    sheets: [
      { id: 'source-sheet-1', name: 'FY 2025', columns: ['Metric'], rows: [['Revenue']] },
      { id: 'source-sheet-3', name: 'Exact Name', columns: ['Metric'], rows: [['Costs']] },
    ],
  }, 'all tabs retain their exact valid names and source-based identities')
  assert.match(mapped.disclosure, /all 2 visible worksheets in source order/i)
  assert.match(mapped.disclosure, /first row as column names/i)
})

test('all-visible XLSX mapping rejects any invalid tab or aggregate overflow without a partial workbook', () => {
  const empty = reviewArtifactSheetImport([workbookFile(sourceWorkbook([
    { sourceSheet: 1, name: 'Populated', cells: [{ row: 1, column: 1, value: 'Value' }, { row: 2, column: 1, value: 'x' }] },
    { sourceSheet: 2, name: 'Empty', cells: [] },
  ]))])
  assert.equal(empty.status, 'ready')
  if (empty.status === 'ready') {
    const mapped = mapArtifactSheetImport(empty, true, undefined, true)
    assert.equal(mapped.status, 'error', 'an empty visible worksheet cannot be silently dropped')
    if (mapped.status === 'error') assert.match(mapped.message, /Empty.*No cells were imported/)
  }

  const missingCache = reviewArtifactSheetImport([workbookFile(sourceWorkbook([
    { sourceSheet: 1, name: 'First', cells: [{ row: 1, column: 1, value: 'Value' }, { row: 2, column: 1, value: 'ok' }] },
    { sourceSheet: 2, name: 'Second', cells: [{ row: 1, column: 1, value: 'Value' }, { row: 2, column: 1, value: '', formula: 'missing' }] },
  ]))])
  assert.equal(missingCache.status, 'ready')
  if (missingCache.status === 'ready') {
    const mapped = mapArtifactSheetImport(missingCache, true, undefined, true)
    assert.equal(mapped.status, 'error', 'one uncached formula rejects all tabs')
    if (mapped.status === 'error') assert.match(mapped.message, /Second.*no saved cached value.*No cells were imported/i)
  }

  const oversized = reviewArtifactSheetImport([workbookFile(sourceWorkbook([
    { sourceSheet: 1, name: 'First', cells: [{ row: 1, column: 1, value: 'Value' }, { row: 2, column: 1, value: 'ok' }] },
    { sourceSheet: 2, name: 'Too wide', cells: [{ row: 1, column: 1, value: 'A' }, { row: 1, column: 34, value: 'AH' }] },
  ]))])
  assert.equal(oversized.status, 'ready')
  if (oversized.status === 'ready') assert.equal(mapArtifactSheetImport(oversized, false, undefined, true).status, 'error', 'one oversize tab rejects all tabs')

  const aggregate = reviewArtifactSheetImport([workbookFile(sourceWorkbook(Array.from({ length: 10 }, (_, index) => ({
    sourceSheet: index + 1,
    name: `Tab ${index + 1}`,
    cells: [{ row: 1, column: 1, value: 'h'.repeat(240) }, { row: 2, column: 1, value: 'x'.repeat(1_900) }],
  }))))])
  assert.equal(aggregate.status, 'ready')
  if (aggregate.status === 'ready') assert.equal(mapArtifactSheetImport(aggregate, true, undefined, true).status, 'error', 'whole-workbook text limit is enforced atomically')
})

test('XLSX sparse source rectangles are bounded before allocation and still obey sheet authoring limits', () => {
  const candidate = reviewArtifactSheetImport([workbookFile(sourceWorkbook([{
    sourceSheet: 1,
    name: 'Sparse',
    cells: [
      { row: 1, column: 1, value: 'Header' },
      { row: 203, column: 1, value: 'Far away' },
    ],
  }]))])
  assert.equal(candidate.status, 'ready')
  if (candidate.status === 'ready') {
    const tooTall = mapArtifactSheetImport(candidate, true)
    assert.equal(tooTall.status, 'error')
    if (tooTall.status === 'error') assert.match(tooTall.message, /rectangle|201 source rows|No cells were imported/i)
  }

  const tooWide = reviewArtifactSheetImport([workbookFile(sourceWorkbook([{
    sourceSheet: 1, name: 'Wide', cells: [
      { row: 1, column: 1, value: 'A' },
      { row: 1, column: 34, value: 'AH' },
    ],
  }]))])
  assert.equal(tooWide.status, 'ready')
  if (tooWide.status === 'ready') assert.equal(mapArtifactSheetImport(tooWide, false).status, 'error')

  const emptyGapRows = Array.from({ length: 201 }, (_, index) => ({ row: index + 1, column: 1, value: index === 0 ? 'Header' : `row ${index}` }))
  const exactSourceRect = reviewArtifactSheetImport([workbookFile(sourceWorkbook([{ sourceSheet: 1, name: 'Boundary', cells: emptyGapRows }]))])
  assert.equal(exactSourceRect.status, 'ready')
  if (exactSourceRect.status === 'ready') assert.equal(mapArtifactSheetImport(exactSourceRect, true).status, 'ready', '201 source rows allow one header plus 200 data rows')

  const oversizedCell = reviewArtifactSheetImport([workbookFile(sourceWorkbook([{ sourceSheet: 1, name: 'Long', cells: [{ row: 1, column: 1, value: 'x'.repeat(MAX_AUTHORED_CELL_CHARS + 1) }] }]))])
  assert.equal(oversizedCell.status, 'ready')
  if (oversizedCell.status === 'ready') {
    const result = mapArtifactSheetImport(oversizedCell, false)
    assert.equal(result.status, 'error')
    if (result.status === 'error') assert.match(result.message, /cell.*2,000|2,000.*character/i)
  }

  const blankHeader = reviewArtifactSheetImport([workbookFile(sourceWorkbook([{ sourceSheet: 1, name: 'Blank header', cells: [
    { row: 1, column: 1, value: 'Name' }, { row: 1, column: 2, value: '' },
    { row: 2, column: 1, value: 'Ada' }, { row: 2, column: 2, value: 'value' },
  ] }]))])
  assert.equal(blankHeader.status, 'ready')
  if (blankHeader.status === 'ready') {
    const result = mapArtifactSheetImport(blankHeader, true)
    assert.equal(result.status, 'error')
    if (result.status === 'error') assert.match(result.message, /Uncheck “First row contains column names”/)
  }
})

test('XLSX missing cached formulas fail only for the selected worksheet; empty sheets and forged candidates fail closed', () => {
  const candidate = reviewArtifactSheetImport([workbookFile(sourceWorkbook([
    { sourceSheet: 1, name: 'Complete', cells: [{ row: 1, column: 1, value: 'Safe value' }] },
    { sourceSheet: 2, name: 'Needs Recalc', cells: [
      { row: 1, column: 1, value: 'Visible value' },
      { row: 50, column: 50, value: '', formula: 'missing' },
    ] },
  ]))])
  assert.equal(candidate.status, 'ready')
  if (candidate.status !== 'ready') return
  const safe = mapArtifactSheetImport(candidate, false, 1)
  assert.equal(safe.status, 'ready', 'unselected formula metadata does not contaminate the chosen sheet')
  const refused = mapArtifactSheetImport(candidate, false, 2)
  assert.equal(refused.status, 'error')
  if (refused.status === 'error') {
    assert.match(refused.message, /recalculate.*save.*Excel/i)
    assert.match(refused.message, /No cells were imported/i)
  }

  const empty = reviewArtifactSheetImport([workbookFile(sourceWorkbook([{ sourceSheet: 1, name: 'Blank', cells: [] }]))])
  assert.equal(empty.status, 'ready')
  if (empty.status === 'ready') {
    const result = mapArtifactSheetImport(empty, false)
    assert.equal(result.status, 'error')
    if (result.status === 'error') assert.match(result.message, /No nonempty cells/i)
  }

  const forged = { ...candidate, workbook: { ...candidate.workbook, worksheets: [{ sourceSheet: 1, name: 'Forged', cells: [{ row: 2, column: 1, value: 'x' }, { row: 1, column: 1, value: 'y' }] }] } }
  assert.equal(mapArtifactSheetImport(forged as any, false).status, 'error', 'mapping revalidates the detached review snapshot')
})

test('parses quoted delimiters, doubled quotes, embedded newlines, BOM, and literal values without loss', () => {
  const source = '\uFEFFName,Note,Formula\r\nAda,"line 1\r\nline 2, with ""quotes""","=SUM(A1:A2)"\nGrace,,  spaced  \r'
  const reviewed = reviewArtifactSheetImport([file('people.csv', source)])
  assert.deepEqual(reviewed, {
    status: 'ready', name: 'people.xlsx', delimiter: ',',
    records: [['Name', 'Note', 'Formula'], ['Ada', 'line 1\r\nline 2, with "quotes"', '=SUM(A1:A2)'], ['Grace', '', '  spaced  ']],
  })
})

test('supports TSV and all record separators while ignoring only the terminal separator', () => {
  const reviewed = reviewArtifactSheetImport([file('rows.TSV', 'a\tb\rb\tc\nc\td')])
  assert.deepEqual(reviewed.status, 'ready')
  if (reviewed.status === 'ready') assert.deepEqual(reviewed.records, [['a', 'b'], ['b', 'c'], ['c', 'd']])
  const emptyCell = reviewArtifactSheetImport([file('empty.csv', '""\n')])
  assert.deepEqual(emptyCell.status, 'ready')
  if (emptyCell.status === 'ready') assert.deepEqual(emptyCell.records, [['']])
})

test('rejects wrong selection, malformed quoting, ragged rows, and bounded cells as a whole', () => {
  assert.equal(reviewArtifactSheetImport([]).status, 'cancelled')
  assert.equal(reviewArtifactSheetImport([file('a.csv', 'x'), file('b.csv', 'y')]).status, 'error')
  assert.equal(reviewArtifactSheetImport([{ ...file('a.csv', 'x'), kind: 'photo' }]).status, 'error')
  assert.equal(reviewArtifactSheetImport([file('a.csv', 'a,"unterminated')]).status, 'error')
  assert.equal(reviewArtifactSheetImport([file('a.csv', 'a,b\n1,2,3')]).status, 'error')
  assert.equal(reviewArtifactSheetImport([file('a.csv', 'a,b\n"x"tail,y')]).status, 'error')
  assert.equal(reviewArtifactSheetImport([file('a.csv', `${'a'.repeat(2001)},b`)]).status, 'error')
  assert.equal(reviewArtifactSheetImport([file('a.csv', 'a,b\n1,2\n3,4\n')]).status, 'ready')
})

test('maps exact headers or generated columns and preserves rows as literal strings', () => {
  const candidate = reviewArtifactSheetImport([file('budget.csv', 'Metric,Value\nRevenue,=SUM(A1:A2)')])
  assert.equal(candidate.status, 'ready')
  if (candidate.status !== 'ready') return
  const headed = mapArtifactSheetImport(candidate, true)
  assert.equal(headed.status, 'ready')
  if (headed.status === 'ready') assert.deepEqual(headed.body, { type: 'sheet', columns: ['Metric', 'Value'], rows: [['Revenue', '=SUM(A1:A2)']] })
  const generated = mapArtifactSheetImport(candidate, false)
  assert.equal(generated.status, 'ready')
  if (generated.status === 'ready') assert.deepEqual(generated.body, { type: 'sheet', columns: ['Column A', 'Column B'], rows: [['Metric', 'Value'], ['Revenue', '=SUM(A1:A2)']] })
})

test('header mode requires usable headers and a data row; no-header mode keeps the first row', () => {
  const blank = reviewArtifactSheetImport([file('blank.csv', ',Value\n,1')])
  assert.equal(blank.status, 'ready')
  if (blank.status === 'ready') assert.equal(mapArtifactSheetImport(blank, true).status, 'error')
  const onlyHeader = reviewArtifactSheetImport([file('only.csv', 'A,B')])
  assert.equal(onlyHeader.status, 'ready')
  if (onlyHeader.status === 'ready') {
    assert.equal(mapArtifactSheetImport(onlyHeader, true).status, 'error')
    assert.equal(mapArtifactSheetImport(onlyHeader, false).status, 'ready')
  }
})

test('accepts a 240-character header, rejects 241, and keeps a headless single row as data', () => {
  const atLimit = reviewArtifactSheetImport([file('labels.csv', `${'h'.repeat(240)}\nvalue`)])
  assert.equal(atLimit.status, 'ready')
  if (atLimit.status === 'ready') assert.equal(mapArtifactSheetImport(atLimit, true).status, 'ready')
  const over = reviewArtifactSheetImport([file('labels.csv', `${'h'.repeat(241)}\nvalue`)])
  assert.equal(over.status, 'ready')
  if (over.status === 'ready') {
    const mapped = mapArtifactSheetImport(over, true)
    assert.equal(mapped.status, 'error')
    if (mapped.status === 'error') assert.match(mapped.message, /Uncheck “First row contains column names”.*data/)
  }
  const headless = reviewArtifactSheetImport([file('single.csv', 'only value')])
  assert.equal(headless.status, 'ready')
  if (headless.status === 'ready') {
    const mapped = mapArtifactSheetImport(headless, false)
    assert.equal(mapped.status, 'ready')
    if (mapped.status === 'ready') assert.deepEqual(mapped.body.rows, [['only value']])
  }
})

test('final record is preserved exactly when the source ends with a separator', () => {
  const reviewed = reviewArtifactSheetImport([file('whole.csv', 'A,B\nleft,right\n')])
  assert.equal(reviewed.status, 'ready')
  if (reviewed.status === 'ready') assert.deepEqual(reviewed.records, [['A', 'B'], ['left', 'right']])
})

test('enforces record, column, and aggregate authoring bounds without clipping', () => {
  const tooManyColumns = reviewArtifactSheetImport([file('wide.csv', Array.from({ length: 33 }, (_, i) => `c${i}`).join(','))])
  assert.equal(tooManyColumns.status, 'error')
  const tooManyRecords = reviewArtifactSheetImport([file('long.csv', ['a', ...Array.from({ length: 201 }, (_, i) => String(i))].join('\n'))])
  assert.equal(tooManyRecords.status, 'error')
  const rows = Array.from({ length: 10 }, (_, i) => [`${i}`.repeat(2_000)]).join('\n')
  const aggregate = reviewArtifactSheetImport([file('aggregate.csv', `A\n${rows}`)])
  assert.equal(aggregate.status, 'ready')
  if (aggregate.status === 'ready') assert.equal(mapArtifactSheetImport(aggregate, false).status, 'error')
})

test('bounds UTF-8 bytes before parsing and rejects unquoted stray quotes', () => {
  for (const source of ['x'.repeat(256 * 1024 + 1), '界'.repeat(90_000)]) {
    const result = reviewArtifactSheetImport([file('large.csv', source)])
    assert.equal(result.status, 'error')
    assert.match(result.message, /limit|256 KiB/)
  }
  assert.equal(reviewArtifactSheetImport([file('stray.csv', 'A,B\nstray"quote,value')]).status, 'error')
})

test('all 32 generated column names and the 200-row boundary retain complete data', () => {
  const source = Array.from({ length: 200 }, () => Array.from({ length: 32 }, () => '0').join(',')).join('\n')
  const reviewed = reviewArtifactSheetImport([file('wide.csv', source)])
  assert.equal(reviewed.status, 'ready')
  const mapping = mapArtifactSheetImport(reviewed, false)
  assert.equal(mapping.status, 'ready')
  assert.equal(mapping.body.columns.length, 32)
  assert.equal(mapping.body.columns[25], 'Column Z')
  assert.equal(mapping.body.columns[26], 'Column AA')
  assert.equal(mapping.body.columns[31], 'Column AF')
  assert.equal(mapping.body.rows.length, 200)
  assert.deepEqual(mapping.body.rows.at(-1), Array.from({ length: 32 }, () => '0'))
  const extra = reviewArtifactSheetImport([file('extra.csv', `${source}\n${Array.from({ length: 32 }, () => '0').join(',')}`)])
  assert.equal(extra.status, 'ready')
  assert.equal(mapArtifactSheetImport(extra, false).status, 'error')
  assert.equal(mapArtifactSheetImport(extra, true).status, 'ready')
})
