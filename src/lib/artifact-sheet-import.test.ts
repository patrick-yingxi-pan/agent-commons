import test from 'node:test'
import assert from 'node:assert/strict'
import { mapArtifactSheetImport, reviewArtifactSheetImport, isArtifactSheetFileName } from './artifactSheetImport.ts'

function file(name: string, text: string) {
  return { name, kind: 'file' as const, text }
}

test('recognizes only CSV and TSV names case-insensitively', () => {
  assert.equal(isArtifactSheetFileName('metrics.CSV'), true)
  assert.equal(isArtifactSheetFileName('metrics.tsv'), true)
  assert.equal(isArtifactSheetFileName('metrics.csv.bak'), false)
  assert.equal(isArtifactSheetFileName('metrics.xlsx'), false)
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
