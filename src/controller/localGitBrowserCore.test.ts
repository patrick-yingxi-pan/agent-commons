import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLocalGitBrowserCore, type LocalGitBrowseListing, type LocalGitBrowsePreview } from './localGitBrowserCore.ts'

const listing: LocalGitBrowseListing = { version: 1, excludedCount: 2, files: [
  { path: 'README.md', kind: 'file' }, { path: 'merge.txt', kind: 'conflict' },
] }
const preview: LocalGitBrowsePreview = { version: 1, path: 'README.md', sizeBytes: 4, snapshot: { text: 'read' } }
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

test('browser reads only on explicit commands and publishes detached listing and exact preview', async () => {
  const calls: unknown[][] = []
  const core = createLocalGitBrowserCore({
    list: async id => { calls.push(['list', id]); return listing },
    preview: async (id, path) => { calls.push(['preview', id, path]); return preview },
    now: () => 42,
  })
  assert.equal(core.get('repo').listing, null, 'mounting state grants no source read')
  assert.equal(await core.readPreview('repo', 'README.md'), null, 'preview requires an explicitly loaded listing')
  assert.deepEqual(calls, [], 'an unlisted path never reaches the bridge')
  assert.deepEqual(await core.readListing('repo'), listing)
  assert.deepEqual(core.get('repo').listing, listing)
  assert.equal(core.get('repo').preview, null, 'listing never previews a path')
  assert.deepEqual(await core.readPreview('repo', 'README.md'), preview)
  assert.deepEqual(calls, [['list', 'repo'], ['preview', 'repo', 'README.md']])
  assert.equal(core.get('repo').previewReadAt, 42)
})

test('one pending read is coalesced, while Dismiss clears bytes and fences its late result', async () => {
  const pending = deferred<LocalGitBrowseListing>()
  let calls = 0
  const core = createLocalGitBrowserCore({ list: () => { calls++; return pending.promise }, preview: async () => preview, now: () => 1 })
  const first = core.readListing('repo')
  const second = core.readListing('repo')
  assert.equal(calls, 0, 'bridge work begins in the queued microtask')
  await Promise.resolve()
  assert.equal(calls, 1)
  core.dismiss('repo')
  assert.equal(core.get('repo').listing, null)
  assert.equal(core.get('repo').pending, true)
  pending.resolve(listing)
  await Promise.all([first, second])
  assert.equal(core.get('repo').listing, null, 'dismissed path metadata cannot republish')
  assert.equal(core.get('repo').pending, false)
})

test('preview failures drop previous bytes and disconnect retention clears the browser', async () => {
  let fail = false
  const core = createLocalGitBrowserCore({
    list: async () => listing,
    preview: async () => { if (fail) throw new Error('private native detail'); return preview },
    now: () => 1,
  })
  await core.readListing('repo')
  await core.readPreview('repo', 'README.md')
  fail = true
  await core.readPreview('repo', 'README.md')
  assert.equal(core.get('repo').preview, null)
  assert.equal(core.get('repo').previewReceipt, null)
  assert.match(core.get('repo').previewError ?? '', /Could not read this file/)
  assert.doesNotMatch(core.get('repo').previewError ?? '', /private native detail/)
  core.retain([])
  assert.equal(core.get('repo').listing, null)
  assert.equal(core.get('repo').preview, null)
})

test('successful explicit previews get fresh byte-free receipts; dismiss and failure clear the current receipt', async () => {
  let fail = false
  const core = createLocalGitBrowserCore({ list: async () => listing, preview: async () => { if (fail) throw Error('no'); return preview }, now: () => 1 })
  await core.readListing('repo')
  assert.equal(core.get('repo').previewReceipt, null)
  await core.readPreview('repo', 'README.md')
  const first = core.get('repo').previewReceipt
  assert.equal(typeof first, 'number')
  await core.readPreview('repo', 'README.md')
  assert.notEqual(core.get('repo').previewReceipt, first, 'a new explicit source read is a new intent')
  fail = true
  await core.readPreview('repo', 'README.md')
  assert.equal(core.get('repo').previewReceipt, null)
  fail = false
  await core.readPreview('repo', 'README.md')
  core.dismiss('repo')
  assert.equal(core.get('repo').previewReceipt, null)
})

test('starting or failing a listing refresh clears the prior preview receipt', async () => {
  let failListing = false
  const core = createLocalGitBrowserCore({
    list: async () => { if (failListing) throw Error('private listing detail'); return listing },
    preview: async () => preview,
    now: () => 1,
  })
  await core.readListing('repo')
  await core.readPreview('repo', 'README.md')
  assert.notEqual(core.get('repo').previewReceipt, null)
  failListing = true
  const refresh = core.readListing('repo')
  assert.equal(core.get('repo').previewReceipt, null, 'a refresh invalidates the old preview intent immediately')
  await refresh
  assert.equal(core.get('repo').listingStatus, 'error')
  assert.equal(core.get('repo').previewReceipt, null)
})

test('account clear fences pending path listing', async () => {
  const pending = deferred<LocalGitBrowseListing>()
  const core = createLocalGitBrowserCore({ list: () => pending.promise, preview: async () => preview, now: () => 1 })
  const read = core.readListing('repo')
  await Promise.resolve()
  core.clear()
  pending.resolve(listing)
  await read
  assert.equal(core.get('repo').listing, null)
})

test('disconnect retention fences a pending preview and releases its bytes', async () => {
  const pending = deferred<LocalGitBrowsePreview>()
  const core = createLocalGitBrowserCore({ list: async () => listing, preview: () => pending.promise, now: () => 1 })
  await core.readListing('repo')
  const read = core.readPreview('repo', 'README.md')
  await Promise.resolve()
  assert.equal(core.get('repo').preview, null)
  core.retain([])
  assert.equal(core.get('repo').preview, null)
  pending.resolve(preview)
  await read
  assert.equal(core.get('repo').preview, null, 'a disconnected repository cannot republish a late file body')
})
