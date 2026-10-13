import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isLocalFolderFileSelection, parseLocalFolderFileListing, parseLocalFolderFilePreview } from './localFolderBrowse.mjs'

const listing = { version: 1, visited: 5, hiddenCount: 1, directoryCount: 1, files: [
  { path: 'nested/a.ts', kind: 'file' }, { path: 'nested/link.ts', kind: 'unsupported' },
  { path: 'notes.txt', kind: 'file' },
] }

test('folder browse parsers detach a complete bounded listing and whole preview', () => {
  const parsed = parseLocalFolderFileListing(listing)
  assert.deepEqual(parsed, listing)
  assert.notStrictEqual(parsed, listing)
  assert.notStrictEqual(parsed?.files[0], listing.files[0])
  const preview = parseLocalFolderFilePreview({ version: 1, path: 'notes.txt', sizeBytes: 2, snapshot: { text: 'ok' } })
  assert.deepEqual(preview, { version: 1, path: 'notes.txt', sizeBytes: 2, snapshot: { text: 'ok' } })
})

test('folder browse selections reject hidden, absolute, traversal, accessor, and mutable-record shapes', () => {
  assert.equal(isLocalFolderFileSelection({ path: 'nested/notes.txt' }), true)
  for (const path of ['.hidden.txt', 'nested/.secret', '../notes.txt', '/tmp/notes.txt', 'C:/notes.txt', 'nested\\notes.txt', '']) {
    assert.equal(isLocalFolderFileSelection({ path }), false, path)
  }
  assert.equal(isLocalFolderFileSelection(Object.defineProperty({}, 'path', { enumerable: true, get() { throw new Error('getter') } })), false)
  assert.equal(isLocalFolderFileSelection(Object.assign(Object.create({ inherited: true }), { path: 'notes.txt' })), false)
})

test('folder listing validates exact visible/raw counts, sort, path budgets, kinds, and closed records', () => {
  for (const bad of [
    { ...listing, extra: true },
    { ...listing, hiddenCount: 0 },
    { ...listing, visited: 501 },
    { ...listing, directoryCount: 65 },
    { ...listing, files: [...listing.files].reverse() },
    { ...listing, files: [{ path: '.secret.txt', kind: 'file' }] },
    { ...listing, files: [{ path: 'image.png', kind: 'file' }] },
    { ...listing, files: [{ path: 'notes.txt', kind: 'directory' }] },
    { ...listing, files: [{ path: '../outside.txt', kind: 'unsupported' }] },
    { ...listing, files: [{ path: 'x'.repeat(4097), kind: 'unsupported' }] },
  ]) assert.equal(parseLocalFolderFileListing(bad), undefined)
})

test('folder previews refuse mismatched bytes, malformed UTF-8 text, unsupported names, and invalid omissions', () => {
  for (const bad of [
    { version: 1, path: 'notes.txt', sizeBytes: 3, snapshot: { text: 'ok' } },
    { version: 1, path: 'notes.txt', sizeBytes: 1, snapshot: { text: '\ud800' } },
    { version: 1, path: 'image.png', sizeBytes: 4, snapshot: { text: 'test' } },
    { version: 1, path: 'notes.txt', sizeBytes: 0, snapshot: { omitted: 'too-large' } },
    { version: 1, path: 'notes.txt', sizeBytes: 1, snapshot: { omitted: 'binary' } },
  ]) assert.equal(parseLocalFolderFilePreview(bad), undefined)
  assert.deepEqual(parseLocalFolderFilePreview({ version: 1, path: 'notes.txt', sizeBytes: 65537, snapshot: { omitted: 'too-large' } })?.snapshot,
    { omitted: 'too-large' })
})
