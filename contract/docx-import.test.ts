import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isDocxFileName, isDocxImportOutcome, docxImportFailure, docxImportCopy } from './docxImport.mjs'
import { isDocumentImportOutcome, documentImportCopy } from './documentImport.mjs'

test('Word intake recognizes exactly the modern document extension', () => {
  for (const name of ['notes.docx', 'NOTES.DOCX', 'résumé.final.docx']) assert.equal(isDocxFileName(name), true)
  for (const name of ['notes.doc', 'notes.docm', 'notes.docx.zip', 'notes.pdf', null, undefined, 42]) assert.equal(isDocxFileName(name), false)
})

test('Word outcomes have exactly one strict, path-free format and status shape', () => {
  for (const status of ['ready', 'no-text', 'file-too-large', 'selection-limit', 'text-limit', 'structure-limit', 'unsupported', 'timeout', 'invalid', 'unavailable']) {
    const outcome = { format: 'docx', status }
    assert.equal(isDocxImportOutcome(outcome), true)
    assert.equal(isDocumentImportOutcome(outcome), true)
    assert.ok(documentImportCopy(outcome).length > 20)
    assert.equal(documentImportCopy(outcome), docxImportCopy(outcome))
    if (status !== 'ready' && status !== 'no-text') assert.deepEqual(docxImportFailure(status), { documentImport: outcome })
    for (const extra of [{ pages: 1 }, { textPages: 1 }, { text: 'hidden' }, { path: '/private/document.docx' }, { bytes: [1, 2] }]) {
      assert.equal(isDocxImportOutcome({ ...outcome, ...extra }), false)
    }
  }
  for (const outcome of [null, [], {}, { format: 'docx' }, { format: 'docx', status: 'complete' }, { format: 'doc', status: 'ready' }]) {
    assert.equal(isDocxImportOutcome(outcome), false)
    assert.equal(isDocumentImportOutcome(outcome), false)
  }
  assert.equal(isDocumentImportOutcome({ format: 'pdf', status: 'ready', pages: 2, textPages: 1 }), true)
  assert.equal(isDocxImportOutcome(Object.assign(Object.create({ format: 'docx', status: 'ready' }), { path: 'hidden', bytes: [] })), false)
  assert.match(documentImportCopy({ format: 'pdf', status: 'ready', pages: 2, textPages: 1 }), /1 of 2 pages/)
})

test('Word disclosure distinguishes saved body text from unavailable document features', () => {
  assert.match(docxImportCopy({ format: 'docx', status: 'ready' }), /body text.*table cells/)
  assert.match(docxImportCopy({ format: 'docx', status: 'ready' }), /headers, footers, notes, comments/)
  assert.match(docxImportCopy({ format: 'docx', status: 'text-limit' }), /No partial text was saved/)
  assert.match(docxImportCopy({ format: 'docx', status: 'unsupported' }), /unlocked.*older Word.*macro-enabled/)
})
