import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseStructuredArtifactEdit } from './artifactEditing.ts'

const content = { type: 'sheet', columns: ['A'], rows: [[' 001\n=1+1 ']] }
test('structured edit preserves detached literal values and requires reviewed body ordering', () => {
  const input = { content, expectedRevision: 7 }
  const parsed = parseStructuredArtifactEdit(input)
  assert.deepEqual(parsed, input)
  assert.notEqual(parsed?.content, content)
  for (const expectedRevision of [undefined, null, -1, 1.2, '7', Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(parseStructuredArtifactEdit({ content, expectedRevision }), undefined)
  }
})

test('structured edit accepts one complete workbook body under the existing whole-body revision precondition', () => {
  const content = {
    type: 'workbook',
    sheets: [{ id: 'main', name: 'Main', columns: ['A'], rows: [['=literal']] }],
  }
  const parsed = parseStructuredArtifactEdit({ content, expectedRevision: 12 })
  assert.deepEqual(parsed, { content, expectedRevision: 12 })
  assert.notEqual(parsed?.content, content)
  assert.equal(parseStructuredArtifactEdit({ content: { ...content, revision: 3 }, expectedRevision: 12 }), undefined)
})

test('document replacement preserves detached literal blocks and stable identity', () => {
  const content = { type: 'doc', title: ' Notes ', blocks: [
    { id: 'heading', h: ' Heading ' }, { id: 'paragraph', p: ' text\n' },
    { id: 'list', ul: [' first ', 'second'] }, { id: 'code', code: ['  =literal'] },
    { id: 'email', email: { to: 'a@example.test', subject: ' Subject ' } },
  ] }
  const parsed = parseStructuredArtifactEdit({ content, expectedRevision: 2 })
  assert.deepEqual(parsed, { content, expectedRevision: 2 })
  assert.notEqual(parsed?.content, content)
  assert.ok(parsed?.content.type === 'doc')
  assert.notEqual(parsed.content.blocks, content.blocks)
  assert.notEqual(parsed.content.blocks[2], content.blocks[2])
})

test('document replacement rejects unknown identity, duplicate IDs and over-budget bodies without clipping', () => {
  const content = { type: 'doc', title: 'Notes', blocks: [{ id: 'one', p: 'text' }] }
  for (const bad of [
    { ...content, title: '' }, { ...content, title: 'x'.repeat(241) },
    { ...content, blocks: [] }, { ...content, blocks: [{ p: 'legacy' }] },
    { ...content, blocks: [{ id: 'one\n', p: 'invalid' }] },
    { ...content, blocks: [{ id: 'one', p: 'a' }, { id: 'one', p: 'b' }] },
    { ...content, blocks: [{ id: 'one', p: 'x'.repeat(2_001) }] },
    { ...content, blocks: Array.from({ length: 11 }, (_, n) => ({ id: `b${n}`, p: 'x'.repeat(2_000) })) },
    { ...content, revision: 2 }, { ...content, extra: true },
  ]) assert.equal(parseStructuredArtifactEdit({ content: bad, expectedRevision: 2 }), undefined)
})

test('structured edits reject mixed operations, forged ordering, unknown keys and invalid bodies whole', () => {
  for (const input of [null, [], {}, { content }, Object.create({ content, expectedRevision: 0 }),
    { content, expectedRevision: 0, block: 0, text: 'mixed' },
    { content, expectedRevision: 0, revision: 0 },
    { content: { ...content, revision: 3 }, expectedRevision: 0 },
    { content: { ...content, rows: [[1]] }, expectedRevision: 0 },
    { content: { ...content, rows: [] }, expectedRevision: 0 },
    { content: { type: 'doc', blocks: [] }, expectedRevision: 0 },
  ]) assert.equal(parseStructuredArtifactEdit(input), undefined)
})
