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

for (const dispose of ['dismiss', 'disconnect', 'account'] as const) {
  test(`${dispose} aborts pending renderer extraction and fences its delayed text`, async () => {
    let extractionSignal: AbortSignal | undefined
    let finish!: (value: { path: string; snapshot: { text: string } }) => void
    const core = createLocalFileBrowserCore({
      list: async () => ({ files: [{ path: 'report.pdf', kind: 'file' }] }),
      preview: async (_id, path, signal) => {
        extractionSignal = signal
        return new Promise<{ path: string; snapshot: { text: string } }>(resolve => { finish = resolve })
      },
      now: () => 1, isPreviewable: kind => kind === 'file', listingError: 'list failed', previewError: 'preview failed',
    })
    await core.readListing('source')
    const request = core.readPreview('source', 'report.pdf')
    await Promise.resolve()
    assert.ok(extractionSignal, 'the extraction receives a cancellation signal')
    assert.equal(extractionSignal.aborted, false)
    if (dispose === 'dismiss') core.dismiss('source')
    else if (dispose === 'disconnect') core.retain([])
    else core.clear()
    assert.equal(extractionSignal.aborted, true)
    assert.equal(core.get('source').preview, null)
    finish({ path: 'report.pdf', snapshot: { text: 'late private document' } })
    assert.equal(await request, null)
    assert.equal(core.get('source').preview, null)
    assert.equal(core.get('source').previewReceipt, null)
  })
}

test('dismiss before the queued native read prevents starting the read at all', async () => {
  let calls = 0
  const core = createLocalFileBrowserCore({
    list: async () => { calls++; return { files: [] } }, preview: async () => ({ path: 'unused' }),
    now: () => 1, isPreviewable: () => true, listingError: 'list failed', previewError: 'preview failed',
  })
  const request = core.readListing('source')
  core.dismiss('source')
  await request
  assert.equal(calls, 0)
  assert.equal(core.get('source').pending, false)
})
