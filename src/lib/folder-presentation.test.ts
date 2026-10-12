import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { WorkspaceFolder } from '../../contract/index.ts'
import { isRecursiveFolder, servedFolderFileCount } from './folderPresentation.ts'

test('saved scope comes only from the exact served or native copy, never nested-looking names', () => {
  const folder: WorkspaceFolder = { id: 'cloud::docs', label: 'docs/' }
  const common = { snapshotId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', capturedAt: '2026-10-11T12:00:00.000Z', files: [] }
  const served = { ...common, sourceId: 'cloud', path: 'docs/nested' }
  const local = { ...common, connectionId: 'LOCAL_test' as const }
  assert.equal(isRecursiveFolder(), false)
  assert.equal(isRecursiveFolder(folder), false)
  assert.equal(isRecursiveFolder({ ...folder, snapshot: { ...served, version: 1 } }), false)
  assert.equal(isRecursiveFolder({ ...folder, localSnapshot: { ...local, version: 1 } }), false)
  assert.equal(isRecursiveFolder({ ...folder, snapshot: { ...served, version: 2, scope: 'recursive' } }), true)
  assert.equal(isRecursiveFolder({ ...folder, localSnapshot: { ...local, version: 2, scope: 'recursive' } }), true)
})

test('catalog file counts always disclose top-level metadata, including zero and singular counts', () => {
  for (const [count, label] of [[0, '0 top-level files'], [1, '1 top-level file'], [3, '3 top-level files']] as const) {
    assert.equal(servedFolderFileCount(count), label)
  }
})
