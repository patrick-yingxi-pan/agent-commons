import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddedContext } from '../types.ts'
import { folderRecentId } from './folderShortcut.ts'

test('folder recents derive identity from explicit folder records with no artifacts', () => {
  const served = { kind: 'folder', label: 'docs', folder: { id: 'cloud::docs', label: 'docs/' }, artifacts: [], source: { id: 'cloud', kind: 'cloud', label: 'Cloud' } } as AddedContext
  assert.equal(folderRecentId(served as Extract<AddedContext, { kind: 'folder' }>), 'cloud::docs')
})

test('folder recents preserve legacy artifact identity and skip session-only UI-host folders', () => {
  const legacy = { kind: 'folder', label: 'legacy', artifacts: [{ id: 'a', name: 'a', kind: 'doc', meta: '', source: { id: 'runner:one::legacy', label: 'legacy/' } }], source: { id: 'runner:one', kind: 'runner', label: 'Runner' } } as AddedContext
  const local = { kind: 'folder', label: 'local', folder: { id: 'ui-host::local', label: 'local/' }, artifacts: [], source: { id: 'ui-host', kind: 'ui-host', label: 'This computer' } } as AddedContext
  assert.equal(folderRecentId(legacy as Extract<AddedContext, { kind: 'folder' }>), 'runner:one::legacy')
  assert.equal(folderRecentId(local as Extract<AddedContext, { kind: 'folder' }>), undefined)
})
