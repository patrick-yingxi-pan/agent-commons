import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isPptxFileName, isPptxImportOutcome, pptxImportCopy,
  MAX_PPTX_FILE_BYTES, MAX_PPTX_SELECTION_BYTES,
} from './pptxImport.mjs'

test('PPTX filename and outcome guards are exact and format-specific', () => {
  assert.equal(isPptxFileName('deck.pptx'), true)
  assert.equal(isPptxFileName('DECK.PPTX'), true)
  for (const value of ['', 'deck.ppt', 'deck.pptx.bak', null, 42, { name: 'deck.pptx' }]) {
    assert.equal(isPptxFileName(value), false, String(value))
  }
  for (const status of ['ready', 'no-text', 'file-too-large', 'selection-limit', 'text-limit', 'structure-limit', 'unsupported', 'timeout', 'invalid', 'unavailable']) {
    assert.equal(isPptxImportOutcome({ format: 'pptx', status }), true, status)
  }
  for (const value of [
    undefined, null, [], { format: 'docx', status: 'ready' },
    { format: 'pptx', status: 'ready', text: 'leak' },
    { format: 'pptx', status: 'unknown' },
    Object.assign(Object.create({ status: 'ready' }), { format: 'pptx' }),
  ]) {
    assert.equal(isPptxImportOutcome(value), false)
  }
})

test('PPTX copy names bounded visible-slide projection and never reflects untrusted text', () => {
  assert.match(pptxImportCopy({ format: 'pptx', status: 'ready' }), /visible slides|speaker notes|comments/i)
  assert.match(pptxImportCopy({ format: 'pptx', status: 'no-text' }), /visible slide/i)
  assert.match(pptxImportCopy({ format: 'pptx', status: 'file-too-large' }), new RegExp(`${MAX_PPTX_FILE_BYTES / 1024 / 1024} MB`))
  assert.match(pptxImportCopy({ format: 'pptx', status: 'selection-limit' }), new RegExp(`${MAX_PPTX_SELECTION_BYTES / 1024 / 1024} MB`))
  assert.equal(pptxImportCopy({ format: 'docx', status: 'ready' }), '')
  assert.equal(pptxImportCopy(undefined), '')
})
