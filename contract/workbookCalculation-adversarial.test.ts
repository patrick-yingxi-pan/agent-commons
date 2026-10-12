import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseAuthoredSheet, parseAuthoredWorkbook } from './workbook.ts'
import { calculateWorkbook, removeWorkbookRow, renameWorkbookSheet } from './workbookCalculation.ts'
import type { WorkbookSheet } from './content.ts'

test('authored sheet admission refuses an accessor-backed discriminator without executing it', () => {
  const calls: string[] = []
  const sheet = { columns: ['A'], rows: [['safe']] }
  Object.defineProperty(sheet, 'type', {
    enumerable: true,
    get() { calls.push('sheet.type'); return 'sheet' },
  })
  const admitted = parseAuthoredSheet(sheet)
  assert.deepEqual(calls, [], 'admission must inspect descriptors without invoking user code')
  assert.equal(admitted, undefined, 'accessor-backed authoring input is not canonical JSON data')
})

test('authored workbook admission refuses an accessor-backed discriminator without executing it', () => {
  const calls: string[] = []
  const workbook = { sheets: [{ id: 's', name: 'Sheet', columns: ['A'], rows: [['safe']] }] }
  Object.defineProperty(workbook, 'type', {
    enumerable: true,
    get() { calls.push('workbook.type'); return 'workbook' },
  })
  const admitted = parseAuthoredWorkbook(workbook)
  assert.deepEqual(calls, [], 'workbook admission must also remain inert')
  assert.equal(admitted, undefined, 'accessor-backed workbook input is refused')
})

test('authored sheet admission does not execute accessors in fields or row arrays', () => {
  const calls: string[] = []
  const field = { type: 'sheet', columns: ['A'], rows: [['safe']] }
  Object.defineProperty(field, 'columns', {
    enumerable: true,
    get() { calls.push('sheet.columns'); return ['A'] },
  })
  parseAuthoredSheet(field)

  const row = ['safe']
  Object.defineProperty(row, '0', {
    enumerable: true,
    get() { calls.push('row[0]'); return 'safe' },
  })
  parseAuthoredSheet({ type: 'sheet', columns: ['A'], rows: [row] })
  assert.deepEqual(calls, [], 'nested accessors are not canonical JSON data and must not execute')
})

test('qualified names remain inert across punctuation, Unicode, function-like names and tab order', () => {
  for (const name of ['SUM', 'A1', '2026', '计划 📊', 'a!b', "Owner's notes", 'constructor', '__proto__']) {
    const source = `='${name.replaceAll("'", "''")}'!A1 + 1`
    const sheets: WorkbookSheet[] = [
      { id: 'summary', name: 'Summary', columns: ['Total'], rows: [[{ formula: source }]] },
      { id: 'detail', name, columns: ['Value'], rows: [['41']] },
    ]
    assert.ok(parseAuthoredWorkbook({ type: 'workbook', sheets }))
    assert.equal(calculateWorkbook(sheets)[0].rows[0][0].text, '42', name)
    assert.equal(calculateWorkbook([...sheets].reverse())[1].rows[0][0].text, '42', name)
    const renamed = renameWorkbookSheet(sheets, 'detail', 'New name')
    assert.equal(calculateWorkbook(renamed)[0].rows[0][0].text, '42', name)
    assert.equal(renamed[0].rows[0][0].formula, "='New name'!A1 + 1")
  }
})

test('structural reference expansion refuses atomically when a deleted cell would exceed source limits', () => {
  const source = '=A1' + ' '.repeat(1997)
  const sheets: WorkbookSheet[] = [{ id: 's', name: 'S', columns: ['Value'], rows: [['1'], [{ formula: source }]] }]
  assert.ok(parseAuthoredWorkbook({ type: 'workbook', sheets }))
  assert.deepEqual(removeWorkbookRow(sheets, 's', 0), sheets)
  assert.equal(calculateWorkbook(sheets)[0].rows[1][0].text, '1')
})

test('structural edits preserve formulas with ranges outside SUM', () => {
  const sources = ['=A2:A3+1', '=SUM(A1:A2)+A3:A4']
  const sheets: WorkbookSheet[] = [{
    id: 's', name: 'S', columns: ['First', 'Second'], rows: [
      ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4'], sources.map((formula) => ({ formula })),
    ],
  }]

  const before = calculateWorkbook(sheets)[0].rows[4].map((cell) => cell.text)
  assert.deepEqual(before, ['#FORMULA!', '#FORMULA!'])
  const after = removeWorkbookRow(sheets, 's', 0)
  assert.deepEqual(after[0].rows[3], sources.map((formula) => ({ formula })),
    'unsupported range syntax remains byte-for-byte unchanged during address rewrites')
})
