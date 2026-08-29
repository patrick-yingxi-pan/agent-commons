import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_ARTIFACT_BLOCK_CHARS,
  MAX_ARTIFACT_EXCERPT_CHARS,
  MAX_AUTHORED_DOCUMENT_BLOCKS,
  MAX_AUTHORED_DOCUMENT_CHARS,
  MAX_AUTHORED_DOCUMENT_SOURCE_CHARS,
  authoredDocument,
  docBlockText,
} from './content.ts'

test('plain text becomes canonical consent text plus a titled, editable revision-zero document', () => {
  const authored = authoredDocument('release-brief.md', ' First line.\nwrapped here. \n\n Second paragraph. ')
  assert.ok(authored)
  assert.equal(authored.body.type, 'doc')
  if (authored.body.type !== 'doc') return
  assert.equal(authored.body.title, 'release-brief')
  assert.equal(authored.body.revision, 0)
  assert.deepEqual(authored.body.blocks.map(docBlockText), ['First line. wrapped here.', 'Second paragraph.'])
  assert.equal(authored.text, 'First line. wrapped here.\n\nSecond paragraph.')
  assert.equal(authored.excerpt, 'First line. wrapped here.')
})

test('authored documents are bounded and blank bodies are refused', () => {
  assert.equal(authoredDocument('empty.md', ' \n '), undefined)
  const text = Array.from({ length: MAX_AUTHORED_DOCUMENT_BLOCKS + 10 }, (_, i) => `${i}-${'x'.repeat(MAX_ARTIFACT_BLOCK_CHARS + 50)}`).join('\n\n')
  const authored = authoredDocument('bounded.md', text)
  assert.ok(authored)
  assert.ok(authored.excerpt.length <= MAX_ARTIFACT_EXCERPT_CHARS)
  assert.ok(authored.text.length <= MAX_AUTHORED_DOCUMENT_CHARS)
  assert.equal(authored.body.type, 'doc')
  if (authored.body.type !== 'doc') return
  assert.ok(authored.body.blocks.length <= MAX_AUTHORED_DOCUMENT_BLOCKS)
  assert.ok(authored.body.blocks.every((block) => (docBlockText(block)?.length ?? 0) <= MAX_ARTIFACT_BLOCK_CHARS))
})

test('one long paragraph is preserved across bounded editable blocks', () => {
  const raw = `${'bounded prose '.repeat(1_536)}12345678901`.slice(0, MAX_AUTHORED_DOCUMENT_SOURCE_CHARS)
  const authored = authoredDocument('long-form.md', raw)
  assert.ok(authored)
  assert.equal(
    authored.text.replace(/\s+/g, ' ').trim(),
    raw,
    'block sizing must not silently discard the tail of an otherwise in-budget document',
  )
  assert.equal(authored.body.type, 'doc')
  if (authored.body.type !== 'doc') return
  assert.ok(authored.body.blocks.length > 1)
  assert.ok(authored.body.blocks.every((block) => (docBlockText(block)?.length ?? 0) <= MAX_ARTIFACT_BLOCK_CHARS))
})

test('an in-budget document with unusually many short paragraphs keeps its complete tail', () => {
  const raw = Array.from({ length: MAX_AUTHORED_DOCUMENT_BLOCKS + 17 }, (_, index) => `Paragraph ${index}.`).join('\n\n')
  const authored = authoredDocument('many-paragraphs.md', raw)
  assert.ok(authored)
  assert.equal(authored.text, raw)
  assert.equal(authored.body.type, 'doc')
  if (authored.body.type !== 'doc') return
  assert.ok(authored.body.blocks.length <= MAX_AUTHORED_DOCUMENT_BLOCKS)
  assert.ok(authored.body.blocks.every((block) => (docBlockText(block)?.length ?? 0) <= MAX_ARTIFACT_BLOCK_CHARS))
})
