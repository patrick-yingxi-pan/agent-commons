import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLocalFolderBrowserCore, type LocalFolderBrowseListing, type LocalFolderBrowsePreview } from './localFolderBrowserCore.ts'

const listing: LocalFolderBrowseListing = { version: 1, visited: 3, hiddenCount: 1, directoryCount: 1, files: [
  { path: 'empty.txt', kind: 'file' }, { path: 'image.png', kind: 'unsupported' },
] }
const preview: LocalFolderBrowsePreview = { version: 1, path: 'empty.txt', sizeBytes: 0, snapshot: { text: '' } }
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}

test('folder browser waits for explicit listing and one listed supported path preview', async () => {
  const calls: unknown[][] = []
  const core = createLocalFolderBrowserCore({
    list: async id => { calls.push(['list', id]); return listing },
    preview: async (id, path) => { calls.push(['preview', id, path]); return preview },
    now: () => 17,
  })
  assert.equal(core.get('folder').listing, null)
  assert.equal(await core.readPreview('folder', 'empty.txt'), null)
  assert.equal(await core.readPreview('folder', 'image.png'), null, 'unsupported path is never read')
  assert.deepEqual(calls, [])
  await core.readListing('folder')
  assert.equal(core.get('folder').preview, null, 'listing does not read a file body')
  await core.readPreview('folder', 'empty.txt')
  assert.deepEqual(core.get('folder').preview, preview, 'empty text is distinct from an omitted or missing result')
  assert.equal(core.get('folder').previewReadAt, 17)
  assert.deepEqual(calls, [['list', 'folder'], ['preview', 'folder', 'empty.txt']])
})

test('folder listing and preview reads coalesce; dismiss clears and fences late native results', async () => {
  const pendingListing = deferred<LocalFolderBrowseListing>()
  let calls = 0
  const core = createLocalFolderBrowserCore({ list: () => { calls++; return pendingListing.promise }, preview: async () => preview, now: () => 1 })
  const first = core.readListing('folder')
  const second = core.readListing('folder')
  await Promise.resolve()
  assert.equal(calls, 1)
  core.dismiss('folder')
  assert.equal(core.get('folder').listing, null)
  assert.equal(core.get('folder').pending, true)
  pendingListing.resolve(listing)
  await Promise.all([first, second])
  assert.equal(core.get('folder').listing, null)
  assert.equal(core.get('folder').pending, false)
})

test('folder receipt is cleared on refresh, failure, dismiss, disconnect, and account clear', async () => {
  let fail = false
  const core = createLocalFolderBrowserCore({
    list: async () => { if (fail) throw Error('private listing detail'); return listing },
    preview: async () => { if (fail) throw Error('private preview detail'); return preview },
    now: () => 1,
  })
  await core.readListing('folder'); await core.readPreview('folder', 'empty.txt')
  const firstReceipt = core.get('folder').previewReceipt
  assert.equal(typeof firstReceipt, 'number')
  const refresh = core.readListing('folder')
  assert.equal(core.get('folder').previewReceipt, null, 'listing refresh invalidates old saved-copy intent')
  await refresh; await core.readPreview('folder', 'empty.txt')
  assert.notEqual(core.get('folder').previewReceipt, firstReceipt)
  fail = true
  await core.readListing('folder')
  assert.equal(core.get('folder').previewReceipt, null)
  assert.doesNotMatch(core.get('folder').listingError ?? '', /private/)
  fail = false
  await core.readListing('folder'); await core.readPreview('folder', 'empty.txt')
  core.dismiss('folder')
  assert.equal(core.get('folder').preview, null)
  assert.equal(core.get('folder').previewReceipt, null)
  await core.readListing('folder'); await core.readPreview('folder', 'empty.txt')
  core.retain([])
  assert.equal(core.get('folder').listing, null)
  core.clear()
  assert.equal(core.get('folder').listing, null)
})

test('account clear fences a late preview body', async () => {
  const pendingPreview = deferred<LocalFolderBrowsePreview>()
  const core = createLocalFolderBrowserCore({ list: async () => listing, preview: () => pendingPreview.promise, now: () => 1 })
  await core.readListing('folder')
  const read = core.readPreview('folder', 'empty.txt')
  await Promise.resolve()
  core.clear()
  pendingPreview.resolve(preview)
  await read
  assert.equal(core.get('folder').preview, null)
  assert.equal(core.get('folder').previewReceipt, null)
})

test('returned listing and preview copies cannot mutate the shared controller projection', async () => {
  const core = createLocalFolderBrowserCore({ list: async () => listing, preview: async () => preview, now: () => 1 })
  const returnedListing = await core.readListing('folder')
  assert.ok(returnedListing)
  returnedListing.files[0]!.path = 'caller-mutated.txt'
  assert.equal(core.get('folder').listing?.files[0]?.path, 'empty.txt')
  const returnedPreview = await core.readPreview('folder', 'empty.txt')
  assert.ok(returnedPreview)
  if ('text' in returnedPreview.snapshot) returnedPreview.snapshot.text = 'caller-mutated'
  assert.equal(core.get('folder').preview?.snapshot.text, '')
})
