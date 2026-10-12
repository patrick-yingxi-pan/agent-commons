import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { SheetCell, SheetGrid } from './content.ts'
import { parseAuthoredSheet, parseAuthoredWorkbook, spreadsheetSheets } from './workbook.ts'
import { cloneSheetCell, sheetCellAddress, sheetCellSource, sheetColumnLabel } from './sheetCell.ts'
import { calculateSheet, removeSheetColumn, removeSheetRow } from './workbookCalculation.ts'

const formula = (source: string): SheetCell => ({ formula: source })
const grid = (rows: SheetCell[][]): SheetGrid => ({ columns: rows[0].map((_, i) => `Column ${i}`), rows })
const texts = (body: SheetGrid) => calculateSheet(body).map((row) => row.map((cell) => cell.text))
const one = (source: string) => calculateSheet(grid([[formula(source)]]))[0][0]

test('formula cells are explicit, closed, detached and share existing source budgets', () => {
  const raw = { type: 'sheet', ...grid([['=1+2', formula('=1+2'), formula('')]]) }
  const parsed = parseAuthoredSheet(raw)!
  assert.deepEqual(parsed, raw)
  assert.notEqual(parsed.rows[0][1], raw.rows[0][1])
  assert.deepEqual(texts(parsed), [['=1+2', '3', '#FORMULA!']])
  assert.equal(sheetCellSource(parsed.rows[0][1]), '=1+2')
  assert.notEqual(cloneSheetCell(raw.rows[0][1]), raw.rows[0][1])
  const projected = spreadsheetSheets(parsed)
  assert.notEqual(projected[0].rows[0][1], parsed.rows[0][1])
  for (const cell of [null, 4, {}, { formula: 1 }, { formula: '1', value: 1 }, { formula: '1', [Symbol('extra')]: 1 },
    Object.create({ formula: '1' }), { formula: '1'.repeat(2001) }, Object.defineProperty({}, 'formula', { get() { throw new Error('must not invoke') } })]) {
    assert.equal(parseAuthoredSheet({ type: 'sheet', columns: ['A'], rows: [[cell]] }), undefined)
  }
  assert.ok(parseAuthoredSheet({ type: 'sheet', ...grid([[formula('x'.repeat(2000))]]) }))
  assert.equal(parseAuthoredWorkbook({ type: 'workbook', sheets: [
    { id: 's', name: 'Sheet', ...grid([Array.from({ length: 11 }, () => formula('x'.repeat(2000)))]) },
  ] }), undefined)
  assert.equal(sheetColumnLabel(0), 'A')
  assert.equal(sheetColumnLabel(25), 'Z')
  assert.equal(sheetColumnLabel(26), 'AA')
  assert.equal(sheetCellAddress(199, 31), 'AF200')
})

test('arithmetic, unary signs, precedence, finite literals and deterministic display', () => {
  for (const [source, text] of [
    ['=1+2*3', '7'], [' (1 + 2) * -3 ', '-9'], ['=10-3-2', '5'], ['=8/2/2', '2'],
    ['=--2 + +.5', '2.5'], ['=1e2 + 2.5E-1', '100.25'], ['=-0', '0'], ['=0.1+0.2', '0.3'],
    ['=SUM()', '0'], ['=sum(1, 2*3, SUM(4, -2))', '9'],
  ]) assert.equal(one(source).text, text, source)
  const decimal = one('=1/3')
  assert.deepEqual(decimal, { kind: 'number', value: 1 / 3, text: '0.333333333333333' })
})

test('references name data coordinates, never headings; ranges and dependencies share numeric rules', () => {
  const body = grid([
    [' 2 ', '3e1', formula('=a1+B1')],
    ['', '-.5', formula('=SUM(A1:B2, C1/2)')],
    ['text', '=2+3', formula('=SUM(B2:A1)')],
  ])
  const before = structuredClone(body)
  assert.deepEqual(texts(body), [[' 2 ', '3e1', '32'], ['', '-.5', '47.5'], ['text', '=2+3', '31.5']])
  assert.deepEqual(body, before)
  for (const text of ['text', '=2+3', '1,000', '0x10', 'Infinity', '1x']) {
    assert.equal(texts(grid([[text, formula('=A1')]]))[0][1], '#VALUE!', text)
  }
  assert.equal(texts(grid([['+2.5', formula('=A1')]]))[0][1], '2.5')
})

test('all failures are explicit inert errors with useful messages', () => {
  const cases = {
    '#FORMULA!': ['', '=', '=1+', '=SUM(1,)', '=()', '=A1:A2', '=1 2'],
    '#UNSUPPORTED!': ['=NOW()', '=Sheet2!A1', '=A$1', '=2^2', '=1%', '="x"', '=globalThis.alert(1)', '=https://example.com'],
    '#REF!': ['=B1', '=A0', '=A99999999999999999999', '=SUM(A1:A2)', '=#REF!+1'],
    '#DIV/0!': ['=1/0', '=1/-0'],
    '#NUM!': ['=1e309', '=1e308*10'],
    '#CYCLE!': ['=A1', '=SUM(A1:A1)'],
    '#LIMIT!': ['=SUM(A1:A1000000)', `=${'('.repeat(34)}1${')'.repeat(34)}`, `=${Array(140).fill('1').join('+')}`, '1'.repeat(2001)],
  }
  for (const [code, sources] of Object.entries(cases)) {
    for (const source of sources) {
      const result = one(source)
      assert.equal(result.kind, 'error', source)
      assert.equal(result.text, code, source)
      if (result.kind === 'error') assert.ok(result.message.length > 10)
    }
  }
  assert.deepEqual(texts(grid([[formula('=B1'), formula('=A1'), formula('=A1+2'), 'safe']])), [['#CYCLE!', '#CYCLE!', '#CYCLE!', 'safe']])
})

test('dependency depth is bounded even when a preceding root populated the memo', () => {
  const descending = grid(Array.from({ length: 66 }, (_, row) => [row === 0 ? '1' : formula(`=A${row}+1`)]))
  const result = texts(descending)
  assert.equal(result[64][0], '65')
  assert.equal(result[65][0], '#LIMIT!')
  const ascending = grid(Array.from({ length: 66 }, (_, row) => [row === 65 ? '1' : formula(`=A${row + 2}+1`)]))
  const forward = texts(ascending)
  assert.equal(forward[0][0], '#LIMIT!')
  assert.equal(forward[1][0], '65', 'an earlier depth failure cannot poison a shallower root')
  assert.equal(forward[64][0], '2')
})

test('whole-sheet work exhaustion never publishes partial formula success', () => {
  const body = grid(Array.from({ length: 200 }, (_, row) => Array.from({ length: 32 }, (_, col) =>
    col === 31 ? formula('=SUM(A1:AE200)') : row === 199 && col === 30 ? 'bad' : '')))
  const result = calculateSheet(body)
  assert.ok(result.every((row) => row[31].text === '#LIMIT!'))
  assert.equal(result[199][30].text, 'bad')
  assert.deepEqual(calculateSheet(body), result)
})

test('row deletion preserves logical reference identity and shrinks ranges', () => {
  const body = { id: 's', name: 'Example', ...grid([
    ['1', formula('= A3 + A2'), '=A3'],
    ['2', 'removed', ''],
    ['3', formula('=SUM(A1:A3)'), formula('=SUM(A3:A1)')],
    ['4', formula('=SUM(A2:A2)'), formula('=SUM(A2:A3, A1)')],
  ]) }
  const original = structuredClone(body)
  const changed = removeSheetRow(body, 1)
  assert.equal(changed.id, 's')
  assert.deepEqual(changed.rows, [
    ['1', formula('= A2 + #REF!'), '=A3'],
    ['3', formula('=SUM(A1:A2)'), formula('=SUM(A2:A1)')],
    ['4', formula('=SUM(#REF!)'), formula('=SUM(A2:A2, A1)')],
  ])
  assert.deepEqual(texts(changed), [['1', '#REF!', '=A3'], ['3', '4', '4'], ['4', '#REF!', '4']])
  assert.deepEqual(body, original)
  assert.deepEqual(removeSheetRow(changed, 0).rows[0][1], formula('=SUM(A1:A1)'))
})

test('column deletion preserves source outside changed references, including existing REF errors', () => {
  const body = grid([['1', '2', '3', formula('= SUM( C1 : A1 ) + B1 + #REF!'), '=C1'],
    ['4', '5', '6', formula('=SUM(B2:C2)'), formula('=SUM(B2:B2)')]])
  const changed = removeSheetColumn(body, 1)
  assert.deepEqual(changed.rows[0], ['1', '3', formula('= SUM( B1 : A1 ) + #REF! + #REF!'), '=C1'])
  assert.deepEqual(changed.rows[1], ['4', '6', formula('=SUM(B2:B2)'), formula('=SUM(#REF!)')])
  assert.deepEqual(removeSheetColumn(changed, 0).rows[0][1], formula('= SUM( A1 : A1 ) + #REF! + #REF!'))
  for (const index of [-1, 5, 1.1]) assert.deepEqual(removeSheetColumn(body, index), body)
  assert.deepEqual(removeSheetRow(grid([[formula('=1')]]), 0), grid([[formula('=1')]]))
  const unsupported = grid([['1', formula('=Other!A1'), formula('=SUM(A1,')]])
  assert.equal(sheetCellSource(removeSheetColumn(unsupported, 0).rows[0][0]), '=Other!A1')
})
