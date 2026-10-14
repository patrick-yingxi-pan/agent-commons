import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseLocalGitUntrackedFileListing, parseLocalGitUntrackedFilePreview,
  parseLocalGitUntrackedFileRequest, parseLocalGitUntrackedFilesRequest } from './localGitUntrackedBrowse.mjs'

const operationId = '4ca5af48-2a21-4c80-9bfe-f627ef872e23'
const listing = { scope: 'untracked', version: 1, excludedCount: 0, files: [{ path: 'draft.md', kind: 'file' }] }
const preview = { scope: 'untracked', version: 1, path: 'draft.md', sizeBytes: 5, snapshot: { text: 'draft' } }

test('untracked requests are closed, scope-bound, and detached', () => {
  assert.deepEqual(parseLocalGitUntrackedFilesRequest({ scope: 'untracked', operationId }), { scope: 'untracked', operationId })
  assert.deepEqual(parseLocalGitUntrackedFileRequest({ scope: 'untracked', path: 'draft.md', operationId }),
    { scope: 'untracked', path: 'draft.md', operationId })
  for (const value of [
    { scope: 'tracked', operationId }, { scope: 'untracked', operationId, extra: true },
    { scope: 'untracked', operationId: 'bad' }, Object.defineProperty({ scope: 'untracked', operationId }, 'operationId', { enumerable: true, get() { throw new Error('getter') } }),
  ]) assert.equal(parseLocalGitUntrackedFilesRequest(value), undefined)
  for (const value of [
    { scope: 'tracked', path: 'draft.md', operationId },
    { scope: 'untracked', path: '../secret', operationId },
    { scope: 'untracked', path: 'draft.md', operationId, extra: true },
  ]) assert.equal(parseLocalGitUntrackedFileRequest(value), undefined)
})

test('untracked outputs require exact scope and closed bounded records, then detach nested data', () => {
  const parsedListing = parseLocalGitUntrackedFileListing(listing)!
  assert.deepEqual(parsedListing, listing)
  assert.notStrictEqual(parsedListing.files, listing.files)
  assert.notStrictEqual(parsedListing.files[0], listing.files[0])
  const parsedPreview = parseLocalGitUntrackedFilePreview(preview)!
  assert.deepEqual(parsedPreview, preview)
  assert.notStrictEqual(parsedPreview.snapshot, preview.snapshot)
  for (const value of [
    { ...listing, scope: 'tracked' }, { ...listing, extra: true },
    { ...listing, files: [{ path: 'draft.md', kind: 'conflict' }] },
    { ...listing, files: [{ path: 'draft.md', kind: 'sparse' }] },
    { ...preview, scope: 'tracked' }, { ...preview, extra: true },
  ]) {
    assert.equal('path' in value ? parseLocalGitUntrackedFilePreview(value) : parseLocalGitUntrackedFileListing(value), undefined)
  }
  const accessor = Object.defineProperty({ ...preview }, 'scope', { enumerable: true, get() { throw new Error('getter') } })
  assert.equal(parseLocalGitUntrackedFilePreview(accessor), undefined)
})
