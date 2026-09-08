/** Structured authored artifact bodies are validated before graph mutation and
 * remain exact, id-keyed values (no spreadsheet formula evaluation). */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { store } from './index.ts'

const op = (name: string, kind: 'sheet' | 'slide', body: unknown) => ({
  kind: 'save-artifact',
  artifact: { name, kind, meta: kind === 'sheet' ? 'Sheet' : 'Slides', body },
}) as never

test('sheet and slides saves materialize exact revision-zero bodies by artifact id', () => {
  const tenant = `tenant-structured-${Date.now().toString(36)}`
  const sheetBody = { type: 'sheet', columns: ['Name', 'Formula'], rows: [['Ada', '=SUM(A1:A2)'], ['Grace', '2']], note: 'Literal cells.' }
  const slideBody = { type: 'slides', slides: [{ title: 'Launch', bullets: ['One', 'Two'] }, { title: 'Close', bullets: [] }] }
  store.applyRelationOp(op(`structured-${Date.now().toString(36)}.csv`, 'sheet', sheetBody), tenant)
  store.applyRelationOp(op(`structured-${Date.now().toString(36)}.slides`, 'slide', slideBody), tenant)
  const rows = store.listArtifacts(tenant)
  const sheet = rows.find((row) => row.kind === 'sheet' && row.name.endsWith('.csv'))
  const slides = rows.find((row) => row.kind === 'slide' && row.name.endsWith('.slides'))
  assert.ok(sheet && slides)
  const content = store.artifactContent(tenant)
  assert.deepEqual(content[sheet.id], { ...sheetBody, revision: 0 })
  assert.deepEqual(content[slides.id], { ...slideBody, revision: 0 })
  assert.equal((content[sheet.id] as any).rows[0][1], '=SUM(A1:A2)')
  assert.throws(() => store.applyRelationOp(op(sheet.name, 'sheet', { type: 'sheet', columns: ['Name'], rows: [['Different body']] }), tenant), /changed|conflict|exists/i, 'same name/source with different body cannot overwrite')
  assert.deepEqual(store.artifactContent(tenant)[sheet.id], { ...sheetBody, revision: 0 }, 'body remains unchanged after the rejected collision')
})

test('structured body validation rejects malformed, oversized, unknown, and kind-mismatched saves before minting rows', () => {
  const tenant = `tenant-structured-invalid-${Date.now().toString(36)}`
  const before = store.listArtifacts(tenant).length
  const cases: Array<{ kind: 'sheet' | 'slide'; body: unknown; label: string }> = [
    { kind: 'sheet', body: { type: 'sheet', columns: ['A'], rows: [['x']], extra: true }, label: 'unknown key' },
    { kind: 'sheet', body: { type: 'sheet', columns: ['A'], rows: [['x']], revision: 7 }, label: 'caller revision key' },
    { kind: 'sheet', body: { type: 'slides', slides: [] }, label: 'shape-kind mismatch' },
    { kind: 'sheet', body: { type: 'sheet', columns: [], rows: [['x']] }, label: 'empty columns' },
    { kind: 'sheet', body: { type: 'sheet', columns: Array.from({ length: 33 }, (_, i) => `C${i}`), rows: [Array.from({ length: 33 }, () => 'x')] }, label: 'too many columns' },
    { kind: 'sheet', body: { type: 'sheet', columns: ['A'], rows: Array.from({ length: 201 }, () => ['x']) }, label: 'too many rows' },
    { kind: 'sheet', body: { type: 'sheet', columns: ['A'], rows: [['x'.repeat(2001)]] }, label: 'cell too long' },
    { kind: 'sheet', body: { type: 'sheet', columns: ['A'], rows: [['x']], note: 'n'.repeat(2001) }, label: 'note too long' },
    { kind: 'sheet', body: { type: 'sheet', columns: ['A'.repeat(241)], rows: [['x']] }, label: 'label too long' },
    { kind: 'slide', body: { type: 'slides', slides: [{ title: 'x', bullets: Array.from({ length: 21 }, () => 'bullet') }] }, label: 'too many bullets' },
    { kind: 'slide', body: { type: 'slides', slides: Array.from({ length: 41 }, () => ({ title: 'x', bullets: [] })) }, label: 'too many slides' },
    { kind: 'slide', body: { type: 'slides', slides: [{ title: '', bullets: [] }] }, label: 'blank slide title' },
    { kind: 'slide', body: { type: 'slides', slides: [{ title: 'x', bullets: ['x'], extra: 'no' }] }, label: 'unknown slide key' },
  ]
  for (const [index, candidate] of cases.entries()) {
    assert.throws(() => store.applyRelationOp(op(`invalid-structured-${index}.bin`, candidate.kind, candidate.body), tenant), candidate.label)
    assert.equal(store.listArtifacts(tenant).length, before, `${candidate.label}: graph unchanged`)
  }
})
