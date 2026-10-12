import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { WorkbookSheet } from './content.ts'
import { parseAuthoredWorkbook } from './workbook.ts'
import {
  calculateWorkbook,
  removeWorkbookColumn,
  removeWorkbookRow,
  removeWorkbookSheet,
  renameWorkbookSheet,
} from './workbookCalculation.ts'

const formula = (source: string) => ({ formula: source })
const texts = (sheets: readonly WorkbookSheet[]) => calculateWorkbook(sheets).map(sheet => ({
  id: sheet.id,
  rows: sheet.rows.map(row => row.map(cell => cell.text)),
}))

function workbook(): WorkbookSheet[] {
  return [
    {
      id: 'overview', name: 'Overview', columns: ['Local', 'Other', 'Local total', 'Bare ref', 'Quoted ref', 'Range', 'Apostrophe', 'Unsupported', 'Qualified range', 'Mixed range'],
      rows: [
        ['100', '3', formula('=A1+B1'), formula('=Detail!A1'), formula("='Detail tab'!A1+B1"), formula("=SUM('dEtAiL tAb'!A1:B2)"), formula("='Bob''s Data'!A1"), formula('=UNKNOWN(Detail!A1)'), formula('=SUM(Detail!A1:Detail!B2)'), formula("=SUM(Detail!A1:'Detail tab'!B2)")],
        ['', '', '', formula('=detail!A2'), formula('=B1+1'), '', '', '', '', ''],
      ],
    },
    {
      id: 'detail', name: 'Detail', columns: ['Base', 'Tax', 'Total'],
      rows: [['6', '2', formula('=A1+B1')], ['11', '3', formula('=A2+B2')]],
    },
    {
      id: 'detail-tab', name: 'Detail tab', columns: ['Base', 'Tax'],
      rows: [['6', '2'], ['11', '3']],
    },
    { id: 'quoted', name: "Bob's Data", columns: ['Value'], rows: [['9']] },
  ]
}

const sheet = (sheets: readonly WorkbookSheet[], id: string) => sheets.find(item => item.id === id)!

test('workbook formulas resolve same-tab and qualified references by stable target name', () => {
  const source = workbook()
  const before = structuredClone(source)
  const calculated = texts(source)
  assert.deepEqual(calculated.find(item => item.id === 'overview')!.rows, [
    ['100', '3', '103', '6', '9', '22', '9', '#UNSUPPORTED!', '22', '#UNSUPPORTED!'],
    ['', '', '', '11', '4', '', '', '', '', ''],
  ])
  assert.deepEqual(calculated.find(item => item.id === 'detail')!.rows, [['6', '2', '8'], ['11', '3', '14']],
    'unqualified A1 references are relative to the formula’s own worksheet')
  assert.deepEqual(source, before, 'calculation is a detached projection')
})

test('missing, ambiguous, and external worksheet references fail closed', () => {
  const sheets: WorkbookSheet[] = [
    { id: 'main', name: 'Main', columns: ['Missing', 'Ambiguous', 'External'], rows: [[
      formula('=Absent!A1'), formula('=Detail!A1'), formula('=[Budget.xlsx]Detail!A1'),
    ]] },
    { id: 'detail-upper', name: 'Detail', columns: ['Value'], rows: [['1']] },
    { id: 'detail-lower', name: 'detail', columns: ['Value'], rows: [['2']] },
  ]
  assert.deepEqual(texts(sheets)[0]!.rows, [['#REF!', '#REF!', '#UNSUPPORTED!']])
})

test('cycles and dependency limits span worksheet boundaries', () => {
  const cycle: WorkbookSheet[] = [
    { id: 'a', name: 'A', columns: ['Value'], rows: [[formula('=B!A1')]] },
    { id: 'b', name: 'B', columns: ['Value'], rows: [[formula('=A!A1')]] },
  ]
  assert.deepEqual(texts(cycle).map(item => item.rows[0]![0]), ['#CYCLE!', '#CYCLE!'])

  const chain: WorkbookSheet[] = Array.from({ length: 66 }, (_, index) => ({
    id: `tab-${index}`, name: `Tab ${index}`, columns: ['Value'],
    rows: [[index === 65 ? '1' : formula(`='Tab ${index + 1}'!A1+1`)]],
  }))
  const result = texts(chain)
  assert.equal(result[0]!.rows[0]![0], '#LIMIT!', 'a cross-sheet dependency path cannot exceed 64 formulas')
  assert.equal(result[1]!.rows[0]![0], '65', '64 formulas in a cross-sheet chain remain within the dependency bound')
  assert.equal(result[2]!.rows[0]![0], '64', 'a shallower root still calculates after a deep-root limit')
  assert.equal(result[64]!.rows[0]![0], '2')
})

test('work exhaustion is shared across workbook sheets and never leaves partial successes', () => {
  const sheets: WorkbookSheet[] = [
    { id: 'data', name: 'Data', columns: Array.from({ length: 30 }, (_, column) => `C${column}`),
      rows: Array.from({ length: 200 }, () => Array.from({ length: 30 }, () => '')) },
    ...Array.from({ length: 18 }, (_, index) => ({
      id: `load-${index}`, name: `Load ${index}`, columns: ['Total'], rows: [[formula('=SUM(Data!A1:AD200)')]],
    })),
  ]
  assert.ok(parseAuthoredWorkbook({ type: 'workbook', sheets }), 'the exhaustion fixture fits all real authoring limits')
  const result = calculateWorkbook(sheets)
  assert.ok(result.slice(1).every(item => item.rows[0]![0]!.text === '#LIMIT!'),
    'more than 100,000 range reads across the workbook invalidate every formula result')
  assert.equal(result[0]!.rows[199]![29]!.text, '', 'literal cells remain unchanged after work exhaustion')
})

test('rename validates names, rewrites supported references and preserves escaped apostrophes', () => {
  const source = workbook()
  const before = structuredClone(source)
  for (const name of [' ', 'bad/name', 'Overview', 'dEtAiL']) {
    const refused = renameWorkbookSheet(source, 'detail-tab', name)
    assert.deepEqual(refused, source, `${JSON.stringify(name)} is invalid or case-insensitively duplicated`)
    assert.notEqual(refused, source, 'refusal still returns a detached workbook value')
    assert.notEqual(refused[0]!.rows, source[0]!.rows)
  }

  const renamed = renameWorkbookSheet(source, 'quoted', "Owner's Data")
  assert.equal(sheet(renamed, 'quoted').name, "Owner's Data")
  assert.equal(sheet(renamed, 'overview').rows[0]![6]!.formula, "='Owner''s Data'!A1")
  const rangeRenamed = renameWorkbookSheet(source, 'detail', 'Lots of Data')
  assert.equal(sheet(rangeRenamed, 'overview').rows[0]![8]!.formula, "=SUM('Lots of Data'!A1:'Lots of Data'!B2)", 'both endpoints of a same-tab qualified range follow the renamed stable target')
  assert.equal(sheet(renamed, 'overview').rows[0]![5]!.formula, "=SUM('dEtAiL tAb'!A1:B2)", 'unrelated qualified sources stay byte-for-byte unchanged')
  assert.equal(sheet(renamed, 'overview').rows[0]![7]!.formula, '=UNKNOWN(Detail!A1)', 'unsupported formula text is not partly rewritten')

  const longSource: WorkbookSheet[] = [
    { id: 'summary', name: 'Summary', columns: ['Formula'], rows: [[formula(`=${' '.repeat(1_980)}Detail!A1`)]] },
    { id: 'detail', name: 'Detail', columns: ['Value'], rows: [['1']] },
  ]
  const overflow = renameWorkbookSheet(longSource, 'detail', 'x'.repeat(31))
  assert.deepEqual(overflow, longSource, 'formula rewrite over the source cap is refused atomically')
  assert.notEqual(overflow, longSource)

  const nearWorkbookBudget: WorkbookSheet[] = Array.from({ length: 10 }, (_, index) => ({
    id: `filler-${index}`, name: `Filler ${index}`, columns: ['x'], rows: [['f'.repeat(1_997)]],
  }))
  nearWorkbookBudget.push(
    { id: 'summary', name: 'Summary', columns: ['x'], rows: [[formula('=Detail!A1')]] },
    { id: 'detail', name: 'Detail', columns: ['x'], rows: [['1']] },
  )
  const aggregateOverflow = renameWorkbookSheet(nearWorkbookBudget, 'detail', 'x'.repeat(31))
  assert.deepEqual(aggregateOverflow, nearWorkbookBudget, 'a rewrite that crosses the shared 20,000-character workbook budget is refused')
  assert.notEqual(aggregateOverflow, nearWorkbookBudget)
  assert.deepEqual(source, before, 'renaming does not mutate the input')
})

test('removing a worksheet marks its references permanently before same-name reuse', () => {
  const source = workbook()
  const removed = removeWorkbookSheet(source, 'detail-tab')
  assert.equal(removed.some(item => item.id === 'detail-tab'), false)
  assert.equal(sheet(removed, 'overview').rows[0]![5]!.formula, '=SUM(#REF!)')
  assert.equal(texts(removed)[0]!.rows[0]![5], '#REF!')
  const replacement: WorkbookSheet = { id: 'replacement', name: 'Detail tab', columns: ['Base', 'Tax'], rows: [['999', '0']] }
  const reused = [...removed, replacement]
  assert.equal(texts(reused)[0]!.rows[0]![5], '#REF!', 'removed sheet identity is not rebound by reusing its name')
  assert.deepEqual(source, workbook(), 'removal is immutable so draft undo can restore the exact prior workbook')
})

test('row and column deletion update references to the target tab across all worksheets only', () => {
  const source: WorkbookSheet[] = [
    { id: 'summary', name: 'Summary', columns: ['Shifted row', 'Deleted row', 'Range', 'Shifted B', 'Shifted C'], rows: [[
      formula('=Detail!A2'), formula('=Detail!A1'), formula('=SUM(Detail!A1:A2)'), formula('=Detail!B2'), formula('=Detail!C2'),
    ]] },
    { id: 'detail', name: 'Detail', columns: ['A', 'B', 'C', 'D'], rows: [
      ['1', '2', '3', '4'], ['4', '5', formula('=SUM(A1:B2)'), formula('=SUM(B1:C2)')],
    ] },
    { id: 'untouched', name: 'Untouched', columns: ['A', 'B'], rows: [[formula('=Detail!A2'), formula('=Detail!B2')]] },
  ]
  const rowsRemoved = removeWorkbookRow(source, 'detail', 0)
  assert.equal(sheet(rowsRemoved, 'summary').rows[0]![0]!.formula, '=Detail!A1')
  assert.equal(sheet(rowsRemoved, 'summary').rows[0]![1]!.formula, '=#REF!')
  assert.equal(sheet(rowsRemoved, 'summary').rows[0]![2]!.formula, '=SUM(Detail!A1:A1)')
  assert.equal(sheet(rowsRemoved, 'detail').rows[0]![2]!.formula, '=SUM(A1:B1)')
  assert.equal(sheet(rowsRemoved, 'untouched').rows[0]![0]!.formula, '=Detail!A1')

  const columnsRemoved = removeWorkbookColumn(source, 'detail', 0)
  assert.equal(sheet(columnsRemoved, 'summary').rows[0]![0]!.formula, '=#REF!')
  assert.equal(sheet(columnsRemoved, 'summary').rows[0]![1]!.formula, '=#REF!')
  assert.equal(sheet(columnsRemoved, 'summary').rows[0]![2]!.formula, '=SUM(#REF!)')
  assert.equal(sheet(columnsRemoved, 'summary').rows[0]![3]!.formula, '=Detail!A2', 'references to surviving columns shift left')
  assert.equal(sheet(columnsRemoved, 'summary').rows[0]![4]!.formula, '=Detail!B2')
  assert.equal(sheet(columnsRemoved, 'detail').rows[1]![1]!.formula, '=SUM(A1:A2)')
  assert.equal(sheet(columnsRemoved, 'detail').rows[1]![2]!.formula, '=SUM(A1:B2)')
  assert.equal(sheet(columnsRemoved, 'untouched').rows[0]![0]!.formula, '=#REF!')
  assert.equal(sheet(columnsRemoved, 'untouched').rows[0]![1]!.formula, '=Detail!A2')
  assert.deepEqual(source[1]!.rows[0], ['1', '2', '3', '4'], 'structural edits leave their source workbook untouched')
})
