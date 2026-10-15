import { test } from 'node:test'
import assert from 'node:assert/strict'
import { localPreviewStructuredImport } from './localPreviewStructuredImport.ts'
import { reviewArtifactSheetImport, mapArtifactSheetImport } from './artifactSheetImport.ts'
import { reviewArtifactPresentationImport } from './artifactPresentationImport.ts'

const workbook = { totalSheets: 1, hiddenSheets: 0, unsupportedSheets: 0, worksheets: [
  { sourceSheet: 1, name: 'Values', cells: [{ row: 1, column: 1, value: 'Code' }, { row: 2, column: 1, value: '001' }] },
] }
const presentation = { totalSlides: 2, hiddenSlides: 0, slides: [
  { sourceSlide: 1, paragraphs: ['First', 'Detail'] }, { sourceSlide: 2, paragraphs: [] },
] }
const base = { version: 1 as const, path: 'nested/source.xlsx', sizeBytes: 100, snapshot: { text: 'NOT STRUCTURE' } }

test('selected workbook and presentation seeds use detached structure, never flattened preview text', () => {
  const sheet = localPreviewStructuredImport({ ...base, workbookImport: { documentImport: { format: 'xlsx', status: 'ready' }, workbook } })!
  assert.equal(sheet.kind, 'sheet')
  assert.equal(sheet.file.name, 'source.xlsx')
  assert.equal('text' in sheet.file, false)
  assert.equal('path' in sheet.file, false)
  assert.notEqual(sheet.file.workbook, workbook)
  const mapping = mapArtifactSheetImport(reviewArtifactSheetImport([sheet.file]), true)
  assert.equal(mapping.status, 'ready')
  assert.deepEqual(mapping.body, { type: 'sheet', columns: ['Code'], rows: [['001']] })
  const deck = localPreviewStructuredImport({ ...base, path: 'nested/slides.pptx', presentationImport: { documentImport: { format: 'pptx', status: 'ready' }, presentation } })!
  assert.equal(deck.kind, 'slide')
  const reviewed = reviewArtifactPresentationImport([deck.file])
  assert.equal(reviewed.status, 'ready')
  assert.deepEqual(reviewed.body, { type: 'slides', slides: [{ title: 'First', bullets: ['Detail'] }, { title: 'Slide 2', bullets: [] }] })
})

test('flattened, absent or cross-format structures cannot become an authoring seed', () => {
  assert.equal(localPreviewStructuredImport(null), null)
  assert.equal(localPreviewStructuredImport(base), null)
  assert.equal(localPreviewStructuredImport({ ...base, path: 'source.txt', workbookImport: { documentImport: { format: 'xlsx', status: 'ready' }, workbook } }), null)
  assert.equal(localPreviewStructuredImport({ ...base, presentationImport: { documentImport: { format: 'pptx', status: 'ready' }, presentation } }), null)
})

test('structured refusal remains reviewable and never borrows successful attachment text', () => {
  const seed = localPreviewStructuredImport({ ...base, workbookImport: { documentImport: { format: 'xlsx', status: 'text-limit' } } })!
  assert.equal(reviewArtifactSheetImport([seed.file]).status, 'error')
  assert.equal('text' in seed.file, false)
  const missing = structuredClone(workbook)
  missing.worksheets[0].cells[1] = { row: 2, column: 1, value: '', formula: 'missing' }
  const valid = localPreviewStructuredImport({ ...base, workbookImport: { documentImport: { format: 'xlsx', status: 'ready' }, workbook: missing } })!
  assert.match(mapArtifactSheetImport(reviewArtifactSheetImport([valid.file]), true).message, /no saved cached value/)
})
