import assert from 'node:assert/strict'
import { test } from 'node:test'
import { artifactBodyExcerpt } from './artifactExcerpt.ts'
import { MAX_ARTIFACT_EXCERPT_CHARS, type DocBlock } from './content.ts'
import { authoredArtifact } from './artifactAuthoring.ts'

test('document previews use the first nonblank block and normalize one bounded line', () => {
  for (const [block, expected] of [
    [{ p: 'Current\n paragraph' }, 'Current paragraph'],
    [{ h: 'Current heading' }, 'Current heading'],
    [{ ul: ['First', 'Second'] }, 'First · Second'],
    [{ code: ['First', 'Second'] }, 'First Second'],
    [{ email: { subject: 'Review', to: 'Ada' } }, 'Review · Ada'],
  ] as Array<[DocBlock, string]>) {
    assert.equal(artifactBodyExcerpt({ type: 'doc', title: 'Not the preview', blocks: [{ p: '  ' }, block, { p: 'Later' }] }), expected)
  }
  assert.equal(artifactBodyExcerpt({ type: 'doc', title: 'Empty', blocks: [] }), '')
  assert.equal(artifactBodyExcerpt({ type: 'doc', title: 'Long', blocks: [{ p: 'x'.repeat(300) }] }), 'x'.repeat(MAX_ARTIFACT_EXCERPT_CHARS))
})

test('structured previews follow row counts, columns, slide counts and first title', () => {
  assert.equal(artifactBodyExcerpt({ type: 'sheet', columns: ['Current', 'Value'], rows: [['A', '1'], ['B', '2']] }), '2 rows · Current · Value')
  assert.equal(artifactBodyExcerpt({ type: 'slides', slides: [{ title: 'Current', bullets: [] }, { title: 'Later', bullets: [] }] }), '2 slides · Current')
  assert.equal(artifactBodyExcerpt({ type: 'figure', shape: 'bars', caption: 'Separate representation' }), undefined)
})

test('authoring and current-body projection share the same preview oracle', () => {
  for (const [kind, input] of [
    ['doc', 'Opening.\n\nLater.'],
    ['sheet', { type: 'sheet', columns: ['Long\n column'], rows: [['A']] }],
    ['slide', { type: 'slides', slides: [{ title: 'Long\n title', bullets: [] }] }],
  ] as const) {
    const authored = authoredArtifact('Notes', kind, input)
    assert.ok(authored)
    assert.equal(authored.excerpt, artifactBodyExcerpt(authored.body))
  }
})
