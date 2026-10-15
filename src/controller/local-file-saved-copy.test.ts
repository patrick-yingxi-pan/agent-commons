import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLocalFileSavedCopyCore } from './localFileSavedCopyCore.ts'
import { createLocalGitSavedCopiesCore } from './localGitSavedCopiesCore.ts'
import { imageAssetRef } from '../../contract/imageAssets.ts'
import { createLocalGitConnections } from './localGitConnectionsCore.ts'
import { createLocalGitReviewsCore } from './localGitReviewsCore.ts'

const scope = JSON.stringify([4, 'session-1'])
const image = { mimeType: 'image/png' as const, data: 'bm9ybWFsaXplZA==', width: 2, height: 1, byteLength: 10 }
const original = { name: 'source.svg', data: 'PHN2Zy8+', byteLength: 6 }
const preview = { version: 1 as const, path: 'assets/source.svg', sizeBytes: 6, snapshot: { image, original } }
const uploadedImage = imageAssetRef(`img-${'a'.repeat(64)}`, image, original)

function setup() {
  const saved = createLocalGitSavedCopiesCore()
  const copies = createLocalFileSavedCopyCore()
  const attachId = () => 'ui-host::saved-photo'
  return { saved, copies, attachId }
}

test('PDF saved copies exclude retained recognition bytes before and after explicit OCR', async () => {
  for (const method of [undefined, 'ocr'] as const) {
    const documentImport = { format: 'pdf' as const, status: 'ready' as const, pages: 2, textPages: 1,
      ...(method ? { method } : {}) }
    const selected = { version: 1 as const, path: 'scan.pdf', sizeBytes: 20,
      snapshot: { text: 'exact reviewed text' }, documentImport,
      pdfOcrInput: new TextEncoder().encode('%PDF-private bytes') }
    const expected = { id: 'saved-pdf', name: 'scan.pdf', kind: 'file', text: 'exact reviewed text', documentImport }
    let published = 0
    await createLocalFileSavedCopyCore().submit({
      savedId: 'saved-pdf', preview: selected, controller: new AbortController(),
      isCurrent: () => true, subscribeCurrent: () => () => {},
      prepare: async file => { assert.deepEqual(file, expected); return file as never },
      onAttach: file => { assert.deepEqual(file, expected); published++ },
    })
    assert.equal(published, 1)
  }
})

test('image saved copy prepares the exact normalized PNG and private original before ordinary attachment publication', async () => {
  const { saved, copies, attachId } = setup()
  const preparedCalls: unknown[] = []
  const published: unknown[] = []
  const currentListeners = new Set<() => void>()
  const submission = saved.submit(scope, 'folder-1', 21, attachId, savedId => copies.submit({
    savedId, preview, controller: new AbortController(), isCurrent: () => true,
    subscribeCurrent: listener => { currentListeners.add(listener); return () => currentListeners.delete(listener) },
    prepare: async (file, signal) => { preparedCalls.push({ file, aborted: signal.aborted }); return { id: file.id, name: file.name, kind: 'photo', image: uploadedImage } },
    onAttach: file => published.push({ savedId, file }),
  }), 'folder')

  await submission.promise
  assert.equal(preparedCalls.length, 1)
  assert.deepEqual(preparedCalls[0], { file: { id: 'ui-host::saved-photo', name: 'assets/source.svg', kind: 'photo', imageInput: image, imageOriginal: original }, aborted: false })
  assert.deepEqual(published, [{ savedId: 'ui-host::saved-photo', file: { id: 'ui-host::saved-photo', name: 'assets/source.svg', kind: 'photo', image: uploadedImage } }])
  assert.equal(saved.acknowledgedIds(scope, [], 'folder').length, 0)
  assert.deepEqual(saved.acknowledgedIds(scope, ['ui-host::saved-photo'], 'folder'), ['ui-host::saved-photo'])
  assert.equal(currentListeners.size, 0)
})

test('same receipt coalesces while pending and a failed retry reuses its opaque saved identity and captured preview', async () => {
  const { saved, copies, attachId } = setup()
  let release!: () => void
  let attempt = 0
  let publishAttempts = 0
  const uploads: unknown[] = []
  const publish: unknown[] = []
  const work = (savedId: string) => copies.submit({
    savedId, preview, controller: new AbortController(), isCurrent: () => true, subscribeCurrent: () => () => {},
    prepare: async file => {
      uploads.push({ name: file.name, image: file.imageInput, original: file.imageOriginal })
      if (attempt++ === 0) await new Promise<void>(resolve => { release = resolve })
      return { id: file.id, name: file.name, kind: 'photo', image: uploadedImage }
    },
    onAttach: file => { if (publishAttempts++ === 0) throw new Error('lost acknowledgement'); publish.push({ savedId, file }) },
  })
  const first = saved.submit(scope, 'folder-1', 22, attachId, work, 'folder')
  const duplicate = saved.submit(scope, 'folder-1', 22, attachId, work, 'folder')
  assert.equal(duplicate.coalesced, true)
  assert.equal(first.id, duplicate.id)
  assert.equal(saved.isPending(scope, 'folder-1', 22, 'folder'), true)
  await new Promise<void>(resolve => setTimeout(resolve, 0))
  release()
  await assert.rejects(first.promise, /lost acknowledgement/)
  const retry = saved.submit(scope, 'folder-1', 22, attachId, work, 'folder')
  assert.equal(retry.id, first.id)
  await retry.promise
  assert.equal(uploads.length, 2)
  assert.deepEqual(uploads, [{ name: 'assets/source.svg', image, original }, { name: 'assets/source.svg', image, original }])
  assert.equal(publish[0] && (publish[0] as { savedId: string }).savedId, first.id)
})

test('a remounted receipt subscriber sees a prior failure and a new attempt clears it without storing source bytes', async () => {
  const saved = createLocalGitSavedCopiesCore()
  const makeId = () => 'ui-host::failed-copy'
  const first = saved.submit(scope, 'folder-2', 23, makeId, () => { throw new Error('lost acknowledgement') }, 'folder')
  await assert.rejects(first.promise, /lost acknowledgement/)
  assert.equal(saved.isPending(scope, 'folder-2', 23, 'folder'), false)
  assert.equal(saved.isFailed(scope, 'folder-2', 23, 'folder'), true)

  const observed: Array<{ pending: boolean; failed: boolean }> = []
  const snapshot = () => ({
    pending: saved.isPending(scope, 'folder-2', 23, 'folder'),
    failed: saved.isFailed(scope, 'folder-2', 23, 'folder'),
  })
  const unsubscribe = saved.subscribe(scope, 'folder-2', 23, () => observed.push(snapshot()), 'folder')
  assert.deepEqual(snapshot(), { pending: false, failed: true }, 'a newly mounted view reads receipt-scoped failure immediately')
  const retry = saved.submit(scope, 'folder-2', 23, makeId, () => 'acknowledged', 'folder')
  assert.equal(retry.id, first.id)
  assert.deepEqual(snapshot(), { pending: true, failed: false }, 'Retry clears the old failure before work begins')
  await retry.promise
  assert.deepEqual(snapshot(), { pending: false, failed: false })
  assert.deepEqual(observed, [
    { pending: true, failed: false },
    { pending: false, failed: false },
  ])
  unsubscribe()
  saved.clear()
  assert.equal(saved.isFailed(scope, 'folder-2', 23, 'folder'), false, 'account disposal drops receipt failure metadata')
})

test('receipt replacement or account switch aborts before saved-copy publication', async () => {
  const { saved, copies, attachId } = setup()
  const controller = new AbortController()
  let current = true
  let notify!: () => void
  let prepared = 0
  let published = 0
  const submission = saved.submit(scope, 'git-1', 31, attachId, savedId => copies.submit({
    savedId, preview, controller, isCurrent: () => current,
    subscribeCurrent: listener => { notify = listener; return () => {} },
    prepare: async (_file, signal) => {
      prepared++
      current = false
      notify()
      assert.equal(signal.aborted, true)
      return { id: savedId, name: 'assets/source.svg', kind: 'photo', image: uploadedImage }
    },
    onAttach: () => { published++ },
  }), 'git')
  await submission.promise
  assert.equal(prepared, 1)
  assert.equal(published, 0)
  assert.equal(saved.acknowledgedIds(scope, [], 'git').length, 0)
})

test('an omitted image-import outcome cannot become an empty text attachment', async () => {
  const copies = createLocalFileSavedCopyCore()
  let published = 0
  await assert.rejects(copies.submit({
    savedId: 'ui-host::omitted',
    preview: { version: 1, path: 'assets/large.png', sizeBytes: 9_000_000, snapshot: { omitted: 'image-import' }, imageFailure: 'too-large' },
    controller: new AbortController(), isCurrent: () => true,
    subscribeCurrent: () => () => {},
    prepare: async file => ({ id: file.id, name: file.name, kind: 'file', text: '' }),
    onAttach: () => { published++ },
  }), /no attachable saved copy/)
  assert.equal(published, 0)
})

test('a stale receipt at the first async boundary never starts image preparation', async () => {
  const copies = createLocalFileSavedCopyCore()
  let prepared = 0
  let published = 0
  const controller = new AbortController()
  await copies.submit({
    savedId: 'ui-host::stale', preview, controller, isCurrent: () => false,
    subscribeCurrent: () => () => {},
    prepare: async file => { prepared++; return file },
    onAttach: () => { published++ },
  })
  assert.equal(prepared, 0)
  assert.equal(published, 0)
})

test('Disconnect retires a captured comparison before native completion and cancels pre-context preparation', async () => {
  let finishDisconnect!: () => void
  let finishPrepare!: () => void
  const disconnectGate = new Promise<void>(resolve => { finishDisconnect = resolve })
  const prepareGate = new Promise<void>(resolve => { finishPrepare = resolve })
  const connections = createLocalGitConnections({
    list: async () => [{ id: `GIT_${'A'.repeat(32)}`, name: 'Review source', remembered: false }],
    connect: async () => null, disconnect: async () => disconnectGate,
  })
  await connections.reload()
  const id = connections.get().rows[0]!.id
  const reviews = createLocalGitReviewsCore({
    now: () => 1,
    read: async () => ({ version: 1, comparison: 'raw', head: { oid: null, ref: null }, excludedCount: 0, unchangedCount: 0, files: [] }),
  })
  connections.subscribeDisconnect(sourceId => reviews.dismiss(sourceId))
  await reviews.read(id)
  const captured = reviews.get(id).result
  const controller = new AbortController()
  let published = 0
  const work = createLocalFileSavedCopyCore().submit({
    savedId: 'ui-host::comparison', preview: { version: 1, path: 'comparison.json', sizeBytes: 2, snapshot: { text: '{}' } }, controller,
    isCurrent: () => reviews.get(id).result === captured,
    subscribeCurrent: listener => reviews.subscribe(id, listener),
    prepare: async file => { await prepareGate; return { id: file.id, name: file.name, kind: 'file', text: file.text! } },
    onAttach: () => { published++ },
  })
  const disconnect = connections.disconnect(id)
  assert.equal(connections.get().busy, true)
  assert.equal(connections.get().rows.length, 1, 'the native disconnect is still pending')
  assert.equal(reviews.get(id).result, null, 'explicit Disconnect clears the captured review immediately')
  assert.equal(controller.signal.aborted, true, 'pre-context preparation is fenced before native acknowledgement')
  finishPrepare()
  await work
  assert.equal(published, 0)
  finishDisconnect()
  await disconnect
})
