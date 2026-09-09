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
