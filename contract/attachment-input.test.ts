import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ATTACHMENT_INPUT_MAX_ITEMS,
  ATTACHMENT_TEXT_FILE_BYTES,
  ATTACHMENT_TEXT_TOTAL_BYTES,
  isAttachmentInput,
  planAttachmentInput,
} from './attachmentInput.ts'
import type { Attachment } from './entities.ts'

let nextId = 0
const uiFile = (previewText: string, overrides: Partial<Attachment> = {}): Attachment => ({
  id: overrides.id ?? `file-fixture-${nextId++}`,
  label: overrides.label ?? 'notes.txt',
  kind: 'file',
  source: { id: 'ui-host', kind: 'ui-host', label: 'This computer' },
  previewText,
  ...overrides,
})

test('accepts exact UTF-8 file and total byte boundaries, including an empty readable file', () => {
  const exact = 'é'.repeat(ATTACHMENT_TEXT_FILE_BYTES / 2)
  const planned = planAttachmentInput([uiFile(exact), uiFile('')])
  assert.deepEqual(planned.map(({ status, bytes }) => ({ status, bytes })), [
    { status: 'ready', bytes: ATTACHMENT_TEXT_FILE_BYTES },
    { status: 'ready', bytes: 0 },
  ])

  const total = planAttachmentInput([uiFile('a'.repeat(ATTACHMENT_TEXT_FILE_BYTES)), uiFile('b'.repeat(ATTACHMENT_TEXT_FILE_BYTES))])
  assert.equal(total[0]?.status, 'ready')
  assert.equal(total[1]?.status, 'ready')
  assert.equal(total.reduce((sum, item) => sum + (item.bytes ?? 0), 0), ATTACHMENT_TEXT_TOTAL_BYTES)
})

test('measures UTF-8 bytes rather than JavaScript string length at the file boundary', () => {
  const over = 'é'.repeat(ATTACHMENT_TEXT_FILE_BYTES / 2 + 1)
  const result = planAttachmentInput([uiFile(over)])[0]!
  assert.equal(result.status, 'too-large')
  assert.equal(result.bytes, ATTACHMENT_TEXT_FILE_BYTES + 2)
})

test('omits a whole oversized file and releases its unused budget for later files', () => {
  const planned = planAttachmentInput([
    uiFile('a'.repeat(ATTACHMENT_TEXT_FILE_BYTES)),
    uiFile('x'.repeat(ATTACHMENT_TEXT_FILE_BYTES + 1)),
    uiFile('b'.repeat(ATTACHMENT_TEXT_FILE_BYTES)),
  ])
  assert.deepEqual(planned.map((item) => item.status), ['ready', 'too-large', 'ready'])
  assert.equal(planned[1]?.attachment.previewText, 'x'.repeat(ATTACHMENT_TEXT_FILE_BYTES + 1))
})

test('applies the total limit without truncating a file', () => {
  const planned = planAttachmentInput([
    uiFile('a'.repeat(ATTACHMENT_TEXT_FILE_BYTES)),
    uiFile('b'.repeat(ATTACHMENT_TEXT_FILE_BYTES)),
    uiFile('c'),
  ])
  assert.equal(planned[2]?.status, 'total-limit')
  assert.equal(planned[2]?.bytes, 1)
  assert.equal(planned[2]?.attachment.previewText, 'c')
})

test('only UI-host text files are model-ready; photos, remote files, and blob URLs stay preview-only', () => {
  const photo = uiFile('photo bytes', { id: 'photo', kind: 'photo', previewUrl: 'blob:https://example/photo' })
  const cloud = uiFile('remote text', { id: 'cloud', source: { id: 'cloud', kind: 'cloud', label: 'Cloud' }, previewUrl: 'blob:https://example/cloud' })
  const runner = uiFile('runner text', { id: 'runner', source: { id: 'runner:one', kind: 'runner', label: 'Runner', runnerId: 'one' } })
  const planned = planAttachmentInput([photo, cloud, runner])
  assert.deepEqual(planned.map(({ status }) => status), ['preview-only', 'preview-only', 'preview-only'])
  assert.equal(planned.every(({ status }) => status !== 'ready'), true)
})

test('invalid legacy shapes are safely marked unavailable', () => {
  const invalid = [null, { id: 'x', label: 'bad', kind: 'file', previewText: 42 }, { id: 'y', label: 'bad', kind: 'file', source: { kind: 'other', id: 'x', label: 'x' } }] as unknown as Attachment[]
  assert.equal(isAttachmentInput(invalid[0]), false)
  assert.deepEqual(planAttachmentInput(invalid).map(({ status }) => status), ['unavailable', 'unavailable', 'unavailable'])
})

test('accepts the bounded DOCX outcome union and rejects forged failure text metadata', () => {
  const ready = uiFile('Word body', {
    label: 'brief.docx',
    documentImport: { format: 'docx', status: 'ready' },
  })
  const failed = uiFile('forged body', {
    label: 'broken.docx',
    documentImport: { format: 'docx', status: 'invalid' },
  })
  assert.equal(isAttachmentInput(ready), true)
  assert.equal(isAttachmentInput(failed), true)
  assert.equal(isAttachmentInput({ ...ready, documentImport: { format: 'docx', status: 'ready', pages: 1 } }), false)
  assert.deepEqual(planAttachmentInput([ready, failed]).map(({ status }) => status), ['ready', 'unavailable'])
})

test('the item cap is fixed and does not turn later metadata into file content', () => {
  const planned = planAttachmentInput(Array.from({ length: ATTACHMENT_INPUT_MAX_ITEMS + 1 }, (_, i) => uiFile(`text-${i}`, { id: `file-${i}` })))
  assert.equal(planned.length, ATTACHMENT_INPUT_MAX_ITEMS + 1)
  assert.equal(planned[ATTACHMENT_INPUT_MAX_ITEMS]?.status, 'item-limit')
  assert.equal(planned[ATTACHMENT_INPUT_MAX_ITEMS]?.bytes, undefined)
})
