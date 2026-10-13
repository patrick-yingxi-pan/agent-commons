import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLocalFileBrowserCore } from './localFileBrowserCore.ts'

test('shared file browser detaches source result, stored projection, and caller result', async () => {
  const listing = { files: [{ path: 'note.txt', kind: 'file' }] }
  const preview = { path: 'note.txt', sizeBytes: 4, snapshot: { text: 'note' } }
  const core = createLocalFileBrowserCore({
    list: async () => listing,
    preview: async () => preview,
    now: () => 1,
    isPreviewable: kind => kind === 'file',
    listingError: 'listing failed',
    previewError: 'preview failed',
  })
  const returned = await core.readListing('item')
  assert.ok(returned)
  returned.files[0]!.path = 'caller.txt'
  assert.equal(core.get('item').listing?.files[0]?.path, 'note.txt')
  listing.files[0]!.path = 'source-mutated.txt'
  assert.equal(core.get('item').listing?.files[0]?.path, 'note.txt')
  const returnedPreview = await core.readPreview('item', 'note.txt')
  assert.ok(returnedPreview)
  if ('text' in returnedPreview.snapshot) returnedPreview.snapshot.text = 'caller'
  assert.equal(core.get('item').preview?.snapshot.text, 'note')
  preview.snapshot.text = 'source-mutated'
  assert.equal(core.get('item').preview?.snapshot.text, 'note')
})
