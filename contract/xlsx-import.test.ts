import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isXlsxFileName, isXlsxImportOutcome, xlsxImportCopy,
  MAX_XLSX_FILE_BYTES, MAX_XLSX_SELECTION_BYTES,
} from './xlsxImport.mjs'

test('XLSX filename and outcome guards are exact and format-specific', () => {
  assert.equal(isXlsxFileName('report.xlsx'), true)
  assert.equal(isXlsxFileName('REPORT.XLSX'), true)
  for (const value of ['', 'report.xls', 'report.xlsx.bak', null, 42, { name: 'report.xlsx' }]) {
    assert.equal(isXlsxFileName(value), false, String(value))
  }

  for (const status of ['ready', 'no-text', 'file-too-large', 'selection-limit', 'text-limit', 'structure-limit', 'unsupported', 'timeout', 'invalid', 'unavailable']) {
    assert.equal(isXlsxImportOutcome({ format: 'xlsx', status }), true, status)
  }
  for (const value of [
    undefined, null, [], { format: 'docx', status: 'ready' },
    { format: 'xlsx', status: 'ready', text: 'leak' },
    { format: 'xlsx', status: 'unknown' },
    Object.assign(Object.create({ status: 'ready' }), { format: 'xlsx' }),
  ]) {
    assert.equal(isXlsxImportOutcome(value), false)
  }
})

test('XLSX copy names the bounded policy and never reflects untrusted text', () => {
  assert.match(xlsxImportCopy({ format: 'xlsx', status: 'ready' }), /cached|formula/i)
  assert.match(xlsxImportCopy({ format: 'xlsx', status: 'no-text' }), /visible worksheet cells/i)
  assert.match(xlsxImportCopy({ format: 'xlsx', status: 'file-too-large' }), new RegExp(`${MAX_XLSX_FILE_BYTES / 1024 / 1024} MB`))
  assert.match(xlsxImportCopy({ format: 'xlsx', status: 'selection-limit' }), new RegExp(`${MAX_XLSX_SELECTION_BYTES / 1024 / 1024} MB`))
  assert.equal(xlsxImportCopy({ format: 'docx', status: 'ready' }), '')
  assert.equal(xlsxImportCopy(undefined), '')
})
