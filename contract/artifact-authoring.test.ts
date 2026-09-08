import assert from 'node:assert/strict'
import { test } from 'node:test'
import { authoredArtifact, parseStructuredArtifactBody } from './artifactAuthoring.ts'
import { authoredDocument } from './content.ts'
import { relationContentPreview } from './relations.ts'

const sheet = () => ({ type: 'sheet' as const, columns: ['Measure', 'Value'], rows: [['Cost', '=SUM(A1:A2)'], ['Notes', '  literal\ntext\t☀  ']], note: 'No formula calculation.' })
const slides = () => ({ type: 'slides' as const, slides: [{ title: 'Launch', bullets: ['One', 'Two\ncontinued'] }, { title: 'Next', bullets: [] }] })

test('structured authoring preserves every accepted value and owns a detached canonical body', () => {
  for (const [kind, raw] of [['sheet', sheet()], ['slide', slides()]] as const) {
    const original = structuredClone(raw)
    const result = authoredArtifact('authored', kind, raw)
    assert.ok(result)
    assert.deepEqual(result.body, { ...original, revision: 0 })
    assert.deepEqual(result.draftBody, original)
    assert.notEqual(result.draftBody, raw)
    assert.equal(JSON.stringify(result.body).includes('=SUM(A1:A2)'), kind === 'sheet')
    assert.ok(result.excerpt.length > 0 && result.excerpt.length <= 160)
  }
  const raw = sheet()
  const parsed = parseStructuredArtifactBody(raw)!
  raw.rows[0][0] = 'changed after submission'
  assert.equal(parsed.type === 'sheet' && parsed.rows[0][0], 'Cost')
})

test('structured parser refuses malformed, mismatched, sparse and authority-bearing content', () => {
  const invalid = [null, '', [], {}, { ...sheet(), revision: 1 }, { ...sheet(), extra: true },
    { ...sheet(), columns: [] }, { ...sheet(), columns: [' '] }, { ...sheet(), rows: [] },
    { ...sheet(), rows: [['short']] }, { ...sheet(), rows: [[1, 2]] },
    { ...sheet(), rows: [['ok', null]] }, { ...sheet(), note: 3 },
    { ...sheet(), columns: new Array(2) }, { ...sheet(), rows: [new Array(2)] },
    { ...slides(), slides: [] }, { type: 'slides', slides: [{ title: '', bullets: [] }] },
    { type: 'slides', slides: [{ title: 'T', bullets: 'wrong' }] },
    { type: 'slides', slides: [{ title: 'T', bullets: ['ok'], layout: 'injected' }] },
    { type: 'slides', slides: [{ title: 'T', bullets: [undefined] }] }]
  for (const value of invalid) assert.equal(parseStructuredArtifactBody(value), undefined, JSON.stringify(value))
  assert.equal(authoredArtifact('mismatch', 'sheet', slides()), undefined)
  assert.equal(authoredArtifact('mismatch', 'slide', sheet()), undefined)
  assert.equal(authoredArtifact('mismatch', 'doc', sheet()), undefined)
  assert.equal(authoredArtifact('mismatch', 'image', slides()), undefined)
  assert.equal(authoredArtifact('bad\u0000name', 'sheet', sheet()), undefined)
})

test('every structural and aggregate bound rejects rather than truncates', () => {
  for (const raw of [
    { ...sheet(), columns: Array(33).fill('C'), rows: [Array(33).fill('')] },
    { ...sheet(), rows: Array.from({ length: 201 }, () => ['', '']) },
    { ...sheet(), columns: ['x'.repeat(241), 'B'] },
    { ...sheet(), rows: [['x'.repeat(2001), '']] },
    { ...sheet(), note: 'x'.repeat(2001) },
    { ...slides(), slides: Array.from({ length: 41 }, () => ({ title: 'T', bullets: [] })) },
    { type: 'slides', slides: [{ title: 'x'.repeat(241), bullets: [] }] },
    { type: 'slides', slides: [{ title: 'T', bullets: Array(21).fill('b') }] },
    { type: 'slides', slides: [{ title: 'T', bullets: ['x'.repeat(2001)] }] },
    { type: 'sheet', columns: ['C'], rows: Array.from({ length: 10 }, () => ['x'.repeat(2000)]) },
    { type: 'slides', slides: [{ title: 'T', bullets: Array(10).fill('x'.repeat(2000)) }] },
  ]) assert.equal(parseStructuredArtifactBody(raw), undefined)
  const atLimit = { type: 'sheet', columns: ['C'], rows: Array.from({ length: 10 }, (_, i) => ['x'.repeat(i === 0 ? 1999 : 2000)]) }
  assert.deepEqual(parseStructuredArtifactBody(atLimit), atLimit, 'aggregate ceiling is inclusive')
})

test('document compatibility and consent projections use the same canonical authoring boundary', () => {
  const doc = authoredDocument('notes.md', 'First.\n\nSecond.')!
  assert.deepEqual(authoredArtifact('notes.md', 'doc', 'First.\n\nSecond.'), { body: doc.body, draftBody: doc.text, excerpt: doc.excerpt })
  for (const [kind, body] of [['sheet', sheet()], ['slide', slides()]] as const) {
    const preview = relationContentPreview({ kind: 'save-artifact', artifact: { name: 'Proposal', kind, meta: kind, body } }, () => undefined, () => undefined)
    assert.deepEqual(preview?.structured, body)
    assert.equal(preview?.label, kind === 'sheet' ? 'Sheet content' : 'Slide content')
  }
})
