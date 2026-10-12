import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseAuthoredSheet, parseAuthoredWorkbook } from './workbook.ts'

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
