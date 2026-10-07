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
  parseDocBlocks,
  withDocBlockText,
  type DocBlock,
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

test('editing a patchable Document block preserves its exact stable identity', () => {
  const heading: DocBlock = { h: 'Before', id: 'heading_1' }
  const paragraph: DocBlock = { p: 'Original prose', id: 'block-2' }

  assert.deepEqual(withDocBlockText(heading, 'After'), { h: 'After', id: 'heading_1' })
  assert.deepEqual(withDocBlockText(paragraph, 'Revised prose'), { p: 'Revised prose', id: 'block-2' })
  assert.deepEqual(heading, { h: 'Before', id: 'heading_1' }, 'the caller-owned block stays immutable')
  assert.deepEqual(paragraph, { p: 'Original prose', id: 'block-2' }, 'the caller-owned block stays immutable')
})

test('standalone block admission owns identity and leaves title and empty-document policy to callers', () => {
  assert.deepEqual(parseDocBlocks([]), [])
  const source: DocBlock[] = [{ p: 'Same prose', id: 'first' }, { p: 'Same prose', id: 'second' }]
  assert.deepEqual(parseDocBlocks(source), source, 'equal text does not collapse distinct block identities')
  assert.equal(parseDocBlocks([{ p: 'First', id: 'duplicate' }, { p: 'Second', id: 'duplicate' }]), undefined)
  assert.equal(parseDocBlocks([{ p: 'Legacy' }, { p: 'Identified', id: 'second' }]), undefined)
  assert.equal(parseDocBlocks({ blocks: source }), undefined, 'the block parser does not accept a document envelope')
})

test('non-patchable identified Document blocks remain unchanged', () => {
  const blocks: DocBlock[] = [
    { ul: ['one', 'two'], id: 'list-1' },
    { code: ['const value = 1'], id: 'code-1' },
    { email: { to: 'team@example.test', subject: 'Update' }, id: 'email-1' },
  ]

  for (const block of blocks) {
    assert.strictEqual(withDocBlockText(block, 'ignored'), block)
  }
  assert.deepEqual(blocks, [
    { ul: ['one', 'two'], id: 'list-1' },
    { code: ['const value = 1'], id: 'code-1' },
    { email: { to: 'team@example.test', subject: 'Update' }, id: 'email-1' },
  ])
})
