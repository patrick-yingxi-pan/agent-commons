import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isServedFolderSnapshot } from './servedFolderSnapshot.ts'

const base = { version: 1, snapshotId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', capturedAt: '2026-10-04T12:00:00.000Z', sourceId: 'cloud', path: 'docs', files: [{ name: 'a.txt', sizeBytes: 2, snapshot: { text: 'é' } }] }

test('admits a bounded exact served folder snapshot, including empty folders and files', () => {
  assert.equal(isServedFolderSnapshot(base), true)
  assert.equal(isServedFolderSnapshot({ ...base, files: [] }), true)
  assert.equal(isServedFolderSnapshot({ ...base, files: [{ name: 'a.bin', sizeBytes: 9, snapshot: { omitted: 'unsupported' } }] }), true)
})

test('rejects malformed folder provenance, shape, ordering, and unsafe paths', () => {
  for (const value of [
    { ...base, extra: true }, { ...base, sourceId: 'ui-host' }, { ...base, path: '../docs' },
    { ...base, files: [{ name: '.secret', sizeBytes: 0, snapshot: { text: '' } }] },
    { ...base, files: [{ name: 'a.txt', sizeBytes: 1, snapshot: { text: 'é' } }] },
    { ...base, files: [{ name: 'b.txt', sizeBytes: 0, snapshot: { text: '' } }, { name: 'a.txt', sizeBytes: 0, snapshot: { text: '' } }] },
    { ...base, files: [{ name: 'a.txt', sizeBytes: 0, snapshot: { text: '', omitted: 'budget' } }] },
    { ...base, files: [{ name: 'a.txt', sizeBytes: 0, snapshot: { omitted: 'mystery' } }] },
    { ...base, path: `a/${'b/'.repeat(62)}last`, files: [{ name: 'child.txt', sizeBytes: 0, snapshot: { text: '' } }] },
    { ...base, files: [{ name: 'x'.repeat(4092), sizeBytes: 0, snapshot: { text: '' } }] },
    { ...base, files: [{ name: 'a.txt', sizeBytes: 1, snapshot: { text: 'a\v' } }] },
  ]) assert.equal(isServedFolderSnapshot(value), false)
})

test('enforces readable count, per-file and total UTF-8 limits', () => {
  const text = 'x'.repeat(65536)
  assert.equal(isServedFolderSnapshot({ ...base, files: [{ name: 'a.txt', sizeBytes: text.length, snapshot: { text } }] }), true)
  assert.equal(isServedFolderSnapshot({ ...base, files: [{ name: 'a.txt', sizeBytes: text.length + 1, snapshot: { text: `${text}x` } }] }), false)
  assert.equal(isServedFolderSnapshot({ ...base, files: Array.from({ length: 25 }, (_, i) => ({ name: `${String(i).padStart(2, '0')}.txt`, sizeBytes: 0, snapshot: { text: '' } })) }), false)
})
