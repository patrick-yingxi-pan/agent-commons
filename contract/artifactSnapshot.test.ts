import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  artifactContextId,
  artifactIdFromContextId,
  artifactSnapshotText,
  buildArtifactSnapshot,
  isArtifactSnapshot,
} from './artifactSnapshot.ts'

const at = '2026-10-08T00:00:00.000Z'
const receipt = '12345678-1234-4123-8123-123456789012'

test('Artifact context identity is canonical, isolated, and round-trips opaque IDs', () => {
  for (const id of ['artifact-1', 'id/with spaces', 'é']) {
    assert.equal(artifactIdFromContextId(artifactContextId(id)), id)
  }
  assert.equal(artifactIdFromContextId('artifact::id%2fwith%20spaces'), null)
  assert.equal(artifactIdFromContextId('artifact::%'), null)
  assert.equal(artifactIdFromContextId('discussion::artifact-1'), null)
})

test('snapshot builder preserves detached canonical content for all five body families', () => {
  const cases = [
    { artifactId: 'doc-1', title: 'Brief', artifactKind: 'doc', body: { type: 'doc', title: 'Brief', blocks: [
      { id: 'stable-h', h: 'Heading' }, { id: 'stable-p', p: 'Body' }, { id: 'stable-ul', ul: ['One', 'Two'] },
      { id: 'stable-code', code: ['literal'] }, { id: 'stable-email', email: { to: 'a@example.test', subject: 'Hello' } },
    ] } },
    { artifactId: 'email-1', title: 'Email', artifactKind: 'email', body: { type: 'doc', title: 'Email', blocks: [{ id: 'email-header', email: { to: 'a@example.test', subject: 'Hello' } }] } },
    { artifactId: 'sheet-1', title: 'Grid', artifactKind: 'sheet', body: { type: 'sheet', columns: ['Name'], rows: [['Ada']], note: 'Literal' } },
    { artifactId: 'book-1', title: 'Workbook', artifactKind: 'sheet', body: { type: 'workbook', sheets: [{ id: 'tab-1', name: 'Tab', columns: ['Name'], rows: [['Ada']] }] } },
    { artifactId: 'slides-1', title: 'Deck', artifactKind: 'slide', body: { type: 'slides', slides: [{ title: 'Start', bullets: ['One'] }] } },
    { artifactId: 'figure-1', title: 'Chart', artifactKind: 'image', body: { type: 'figure', shape: 'bars', headline: 'Quarterly', caption: 'Growth', labels: ['Q1'], series: [4], series2: [5], legend: ['A', 'B'] } },
  ] as const
  for (const [index, source] of cases.entries()) {
    const snapshot = buildArtifactSnapshot({ ...source, body: { ...source.body, revision: index + 3 } } as never, receipt, at)
    assert.ok(snapshot, source.artifactId)
    assert.equal(snapshot.revision, index + 3)
    assert.deepEqual(snapshot.body, source.body)
    assert.equal(isArtifactSnapshot(snapshot), true)
    assert.equal(artifactSnapshotText(snapshot), JSON.stringify({ title: source.title, artifactKind: source.artifactKind, revision: index + 3, body: snapshot.body }))
  }
})

test('snapshot admission rejects unsupported, mixed-kind, extra-key, over-budget, and malformed figure bodies', () => {
  const valid = buildArtifactSnapshot({ artifactId: 'doc-2', title: 'Brief', artifactKind: 'doc', body: { type: 'doc', title: 'Brief', blocks: [{ id: 'block-1', p: 'Body' }] } }, receipt, at)
  assert.ok(valid)
  assert.equal(isArtifactSnapshot({ ...valid, body: { ...valid.body, extra: 'smuggled' } }), false)
  const hiddenBody = { ...valid.body }
  Object.defineProperty(hiddenBody, 'hidden', { value: 'dropped by JSON', enumerable: false })
  assert.equal(isArtifactSnapshot({ ...valid, body: hiddenBody }), false)
  const symbolBody = { ...valid.body, [Symbol('hidden')]: 'dropped by JSON' }
  assert.equal(isArtifactSnapshot({ ...valid, body: symbolBody }), false)
  assert.equal(buildArtifactSnapshot({ artifactId: 'x', title: 'No body', artifactKind: 'doc', body: undefined as never }, receipt, at), null)
  assert.equal(buildArtifactSnapshot({ artifactId: 'x', title: 'Mismatch', artifactKind: 'slide', body: { type: 'sheet', columns: ['A'], rows: [['x']] } }, receipt, at), null)
  assert.equal(buildArtifactSnapshot({ artifactId: 'x', title: 'Bad chart', artifactKind: 'image', body: { type: 'figure', shape: 'bars', caption: 'x', series: [Number.NaN] } }, receipt, at), null)
  const sparseSeries = new Array(2) as number[]
  sparseSeries[0] = 1
  assert.equal(buildArtifactSnapshot({ artifactId: 'x', title: 'Sparse chart', artifactKind: 'image', body: { type: 'figure', shape: 'bars', caption: 'x', series: sparseSeries } }, receipt, at), null)
  const multilineFigure = buildArtifactSnapshot({ artifactId: 'x', title: 'Chart', artifactKind: 'image', body: {
    type: 'figure', shape: 'line', caption: 'First line\nSecond line', labels: Array.from({ length: 33 }, (_, index) => `Label ${index}`),
  } }, receipt, at)
  assert.equal(multilineFigure?.body.type, 'figure', 'canonical figure text is preserved literally when the whole copy remains within budget')
  assert.equal(buildArtifactSnapshot({ artifactId: 'x', title: 'Big', artifactKind: 'doc', body: {
    type: 'doc', title: 'Big', blocks: Array.from({ length: 100 }, (_, index) => ({ id: `b-${index}`, p: 'é'.repeat(1_000) })),
  } }, receipt, at), null)
})

test('read-only Artifact snapshots preserve an existing wholly legacy Document without assigning identities', () => {
  const snapshot = buildArtifactSnapshot({
    artifactId: 'legacy-doc', title: 'Legacy', artifactKind: 'doc',
    body: { type: 'doc', title: 'Legacy', blocks: [{ p: 'Still readable' }, { email: { to: 'a@example.test', subject: 'Hello' } }] },
  }, receipt, at)
  assert.ok(snapshot)
  assert.deepEqual(snapshot.body, {
    type: 'doc', title: 'Legacy', blocks: [{ p: 'Still readable' }, { email: { to: 'a@example.test', subject: 'Hello' } }],
  })
})
