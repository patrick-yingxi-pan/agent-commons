import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  artifactSearchFields,
  artifactSearchTargetKey,
  parseArtifactSearchTarget,
  validArtifactSearchField,
} from './artifactSearch.ts'

test('Artifact search field paths are canonical, strict, and safe-integer bounded', () => {
  const valid = [
    'doc.title', 'doc.block.0.h', 'doc.block.2.p', 'doc.block.1.ul.0', 'doc.block.1.code.2',
    'doc.block.3.email.to', 'doc.block.3.email.subject', 'sheet.column.0', 'sheet.cell.1.2', 'sheet.note',
    'workbook.0.name', 'workbook.0.column.1', 'workbook.0.cell.2.3', 'workbook.0.note',
    'slides.0.title', 'slides.2.bullet.1',
  ]
  for (const field of valid) assert.equal(validArtifactSearchField(field), true, field)

  const invalid = [
    '', 'title', 'doc.title.extra', 'doc.block.00.p', 'doc.block.-1.h', 'doc.block.1.5.p',
    'doc.block.9007199254740992.p', 'doc.block.0.ul.-1', 'doc.block.0.email.cc',
    'sheet.column.01', 'sheet.cell.1', 'sheet.cell.1.2.extra', 'sheet.note.0',
    'workbook.0.sheets.0.name', 'workbook.0.cell.0.00', 'workbook.9007199254740992.name',
    'slides.0.bullets.0', 'slides.0.title.0', 'slides.0.bullet.9007199254740992',
  ]
  for (const field of invalid) assert.equal(validArtifactSearchField(field), false, field)
  for (const value of [null, undefined, 42, {}, ['doc.title']]) assert.equal(validArtifactSearchField(value), false)
})

test('search targets round-trip exact canonical decimal revisions and reject malformed input', () => {
  assert.deepEqual(parseArtifactSearchTarget('0/doc.title'), { revision: 0, field: 'doc.title' })
  assert.deepEqual(parseArtifactSearchTarget('12/workbook.2.cell.4.5'), { revision: 12, field: 'workbook.2.cell.4.5' })
  assert.deepEqual(parseArtifactSearchTarget(`${Number.MAX_SAFE_INTEGER}/slides.0.bullet.0`), {
    revision: Number.MAX_SAFE_INTEGER, field: 'slides.0.bullet.0',
  })
  for (const value of [undefined, null, '', '00/doc.title', '-1/doc.title', '1.0/doc.title',
    '9007199254740992/doc.title', '1/doc.block.00.p', '1/doc.title/extra', '1/', '/doc.title', 3]) {
    assert.equal(parseArtifactSearchTarget(value as any), undefined, String(value))
  }
})

test('target keys contain only validated revision and field path', () => {
  const target = { revision: 0, field: 'doc.block.12.email.subject' }
  assert.equal(artifactSearchTargetKey(target), '0/doc.block.12.email.subject')
  assert.throws(() => artifactSearchTargetKey({ revision: -1, field: 'doc.title' } as any), /target/i)
  assert.throws(() => artifactSearchTargetKey({ revision: 1, field: 'doc.title?secret' } as any), /target/i)
})

test('body fields expose stable exact paths in the existing search order', () => {
  const body = {
    type: 'doc' as const,
    title: 'Title',
    blocks: [
      { h: 'Heading' }, { p: 'Paragraph' }, { ul: ['First bullet', 'Second bullet'] },
      { code: ['Line one', 'Line two'] }, { email: { to: 'Ada', subject: 'Hello' } },
    ],
  }
  assert.deepEqual([...artifactSearchFields(body)], [
    { field: 'doc.title', text: 'Title' },
    { field: 'doc.block.0.h', text: 'Heading' },
    { field: 'doc.block.1.p', text: 'Paragraph' },
    { field: 'doc.block.2.ul.0', text: 'First bullet' },
    { field: 'doc.block.2.ul.1', text: 'Second bullet' },
    { field: 'doc.block.3.code.0', text: 'Line one' },
    { field: 'doc.block.3.code.1', text: 'Line two' },
    { field: 'doc.block.4.email.to', text: 'Ada' },
    { field: 'doc.block.4.email.subject', text: 'Hello' },
  ])
})

test('structured Artifact paths use array positions without exposing internal tab IDs', () => {
  assert.deepEqual([...artifactSearchFields({
    type: 'sheet', columns: ['Name', 'Value'], rows: [['Ada', '42']], note: 'Summary',
  })], [
    { field: 'sheet.column.0', text: 'Name' }, { field: 'sheet.column.1', text: 'Value' },
    { field: 'sheet.cell.0.0', text: 'Ada' }, { field: 'sheet.cell.0.1', text: '42' },
    { field: 'sheet.note', text: 'Summary' },
  ])
  assert.deepEqual([...artifactSearchFields({
    type: 'workbook', sheets: [
      { id: 'private-tab-id', name: 'Overview', columns: ['Metric'], rows: [['Total']], note: 'First note' },
      { id: 'another-private-id', name: 'Details', columns: ['Label', 'Amount'], rows: [['One', '2']], note: 'Second note' },
    ],
  })], [
    { field: 'workbook.0.name', text: 'Overview' }, { field: 'workbook.0.column.0', text: 'Metric' },
    { field: 'workbook.0.cell.0.0', text: 'Total' }, { field: 'workbook.0.note', text: 'First note' },
    { field: 'workbook.1.name', text: 'Details' }, { field: 'workbook.1.column.0', text: 'Label' },
    { field: 'workbook.1.column.1', text: 'Amount' }, { field: 'workbook.1.cell.0.0', text: 'One' },
    { field: 'workbook.1.cell.0.1', text: '2' }, { field: 'workbook.1.note', text: 'Second note' },
  ])
  assert.deepEqual([...artifactSearchFields({
    type: 'slides', slides: [{ title: 'Introduction', bullets: ['First', 'Second'] }],
  })], [
    { field: 'slides.0.title', text: 'Introduction' },
    { field: 'slides.0.bullet.0', text: 'First' }, { field: 'slides.0.bullet.1', text: 'Second' },
  ])
  assert.deepEqual([...artifactSearchFields({ type: 'figure', shape: 'bars', caption: 'Not searchable', labels: ['No'], series: [1] })], [])
})
