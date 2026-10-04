import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddedContext } from '../types.ts'
import { addedToProjectContexts } from './projectContext.ts'

test('project folder metadata counts captured files when artifacts are projected elsewhere', () => {
  const ctx = {
    kind: 'folder', label: 'docs', artifacts: [],
    folder: { id: 'cloud::docs', label: 'docs/', snapshot: {
      version: 1, snapshotId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', capturedAt: '2026-10-04T12:00:00.000Z', sourceId: 'cloud', path: 'docs',
      files: [{ name: 'a.md', sizeBytes: 3, snapshot: { text: 'doc' } }, { name: 'b.bin', sizeBytes: 1, snapshot: { omitted: 'unsupported' } }],
    } },
  } as AddedContext
  assert.deepEqual(addedToProjectContexts(ctx), [{ kind: 'folder', label: 'docs', meta: '2 files' }])
})

test('project folder metadata keeps local artifact counts and handles empty captures', () => {
  const local = { kind: 'folder', label: 'local', artifacts: [{ id: 'a', name: 'a.md', kind: 'doc', meta: '' }], folder: { id: 'ui-host::local', label: 'local/' } } as AddedContext
  const empty = { kind: 'folder', label: 'empty', artifacts: [], folder: { id: 'cloud::empty', label: 'empty/', snapshot: {
    version: 1, snapshotId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', capturedAt: '2026-10-04T12:00:00.000Z', sourceId: 'cloud', path: 'empty', files: [],
  } } } as AddedContext
  assert.equal(addedToProjectContexts(local)[0]?.meta, '1 file')
  assert.equal(addedToProjectContexts(empty)[0]?.meta, '0 files')
})
