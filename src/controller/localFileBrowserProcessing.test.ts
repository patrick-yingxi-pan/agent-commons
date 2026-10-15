import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLocalFileBrowserCore } from './localFileBrowserCore.ts'

const path = 'reports/scan.pdf'
const original = { version: 1, path, sizeBytes: 12, snapshot: { text: 'embedded text' }, documentImport: { format: 'pdf', status: 'ready', pages: 2, textPages: 1 } }
const recognized = { version: 1, path, sizeBytes: 12, snapshot: { text: 'recognized text' }, documentImport: { format: 'pdf', status: 'ready', pages: 2, textPages: 2, method: 'ocr' } }

function setup(processPreview: (preview: typeof original, signal: AbortSignal) => Promise<unknown>) {
  let now = 10
  const core = createLocalFileBrowserCore({
    list: async () => ({ files: [{ path, kind: 'file' }] }),
    preview: async () => structuredClone(original),
    processPreview: processPreview as never,
    now: () => now++, isPreviewable: () => true,
    listingError: 'listing failed', previewError: 'preview failed',
  })
  return { core, setNow: (value: number) => { now = value } }
}

async function ready(core: ReturnType<typeof createLocalFileBrowserCore>) {
  await core.readListing('folder')
  await core.readPreview('folder', path)
  const state = core.get('folder')
  assert.ok(state.previewReceipt)
  assert.equal(state.preview?.path, path)
  return state.previewReceipt
}

test('OCR starts only for the exact current ready receipt and success advances receipt without changing preview read time', async () => {
  let finish!: (value: unknown) => void
  let calls = 0
  const { core, setNow } = setup(async (_preview, signal) => {
    calls++
    assert.equal(signal.aborted, false)
    return new Promise(resolve => { finish = resolve })
  })
  const receipt = await ready(core)
  const readAt = core.get('folder').previewReadAt
  assert.equal(await core.processPreview('folder', receipt + 1), null)
  assert.equal(core.get('folder').processingStatus, 'idle')
  assert.equal(calls, 0)

  const pending = core.processPreview('folder', receipt)
  await Promise.resolve()
  assert.equal(calls, 1)
  assert.equal(core.get('folder').processingStatus, 'loading')
  assert.equal(core.get('folder').preview?.snapshot.text, 'embedded text')
  assert.equal(core.get('folder').pending, true)
  const duplicate = core.processPreview('folder', receipt)
  await Promise.resolve()
  assert.equal(calls, 1, 'the same active receipt shares one processor invocation')

  setNow(999)
  finish({ status: 'ready', preview: structuredClone(recognized) })
  await Promise.all([pending, duplicate])
  const state = core.get('folder')
  assert.equal(state.preview?.snapshot.text, 'recognized text')
  assert.equal(state.previewReadAt, readAt)
  assert.notEqual(state.previewReceipt, receipt)
  assert.equal(state.processingStatus, 'idle')
  assert.equal(state.processingError, null)
  assert.equal(state.pending, false)
})

test('processor failures and cross-path results preserve the prior preview and receipt', async () => {
  for (const result of [
    { status: 'error', message: 'safe OCR failure' },
    { status: 'ready', preview: { ...recognized, path: 'other.pdf' } },
  ]) {
    const { core } = setup(async () => result)
    const receipt = await ready(core)
    const before = core.get('folder')
    await core.processPreview('folder', receipt)
    const after = core.get('folder')
    assert.equal(after.preview, before.preview)
    assert.equal(after.previewReceipt, receipt)
    assert.equal(after.previewReadAt, before.previewReadAt)
    assert.equal(after.processingStatus, 'error')
    assert.equal(typeof after.processingError, 'string')
    assert.equal(after.pending, false)
  }
})

test('processor cancellation and rejection preserve the exact prior preview identity', async () => {
  for (const process of [
    async () => ({ status: 'cancelled' }),
    async () => { throw new Error('/Users/private.pdf native diagnostic') },
  ]) {
    const { core } = setup(process)
    const receipt = await ready(core)
    const before = core.get('folder')
    await core.processPreview('folder', receipt)
    const after = core.get('folder')
    assert.equal(after.preview, before.preview)
    assert.equal(after.previewReceipt, receipt)
    assert.equal(after.previewReadAt, before.previewReadAt)
    assert.equal(after.pending, false)
    if (after.processingStatus === 'error') {
      assert.doesNotMatch(after.processingError ?? '', /private|native diagnostic|\/Users\//i)
    } else {
      assert.equal(after.processingStatus, 'idle')
      assert.equal(after.processingError, null)
    }
  }
})

test('one physically pending OCR operation blocks reads and competing receipt work', async () => {
  let finish!: (value: unknown) => void
  const { core } = setup(async () => new Promise(resolve => { finish = resolve }))
  const receipt = await ready(core)
  const pending = core.processPreview('folder', receipt)
  await Promise.resolve()
  const previewRead = core.readPreview('folder', path)
  const listingRead = core.readListing('folder')
  assert.equal(await previewRead, null)
  assert.equal(await listingRead, null)
  assert.equal(core.get('folder').previewReceipt, receipt)
  finish({ status: 'ready', preview: structuredClone(recognized) })
  await pending
})

test('a reentrant subscriber cannot start another browser operation from the processing notification', async () => {
  let finish!: (value: unknown) => void
  let previewCalls = 0
  let nestedRead: Promise<unknown> | undefined
  const core = createLocalFileBrowserCore({
    list: async () => ({ files: [{ path, kind: 'file' }] }),
    preview: async () => { previewCalls++; return structuredClone(original) },
    processPreview: async () => new Promise(resolve => { finish = resolve }) as never,
    now: () => 10, isPreviewable: () => true,
    listingError: 'listing failed', previewError: 'preview failed',
  })
  const receipt = await ready(core)
  const unsubscribe = core.subscribe('folder', () => {
    if (core.get('folder').processingStatus === 'loading') nestedRead = core.readPreview('folder', path)
  })
  const pending = core.processPreview('folder', receipt)
  await Promise.resolve()
  assert.equal(previewCalls, 1, 'a nested read cannot reach the source')
  assert.equal(core.get('folder').processingStatus, 'loading')
  assert.ok(nestedRead)
  finish({ status: 'ready', preview: structuredClone(recognized) })
  await pending
  assert.equal(await nestedRead, null)
  unsubscribe()
})

test('a reentrant dismiss from the processing notification aborts and fences OCR', async () => {
  let calls = 0
  const core = createLocalFileBrowserCore({
    list: async () => ({ files: [{ path, kind: 'file' }] }),
    preview: async () => structuredClone(original),
    processPreview: async () => {
      calls++
      return { status: 'ready', preview: structuredClone(recognized) }
    },
    now: () => 10, isPreviewable: () => true,
    listingError: 'listing failed', previewError: 'preview failed',
  })
  const receipt = await ready(core)
  const unsubscribe = core.subscribe('folder', () => {
    if (core.get('folder').processingStatus === 'loading') core.dismiss('folder')
  })
  const pending = core.processPreview('folder', receipt)
  await pending
  assert.equal(calls, 0, 'dismiss aborts before the queued processor invocation begins')
  assert.equal(core.get('folder').preview, null)
  assert.equal(core.get('folder').preview, null)
  assert.equal(core.get('folder').previewReceipt, null)
  unsubscribe()
})

test('cancel signals the processor immediately but keeps the operation pending until physical settlement', async () => {
  let signal!: AbortSignal
  let finish!: (value: unknown) => void
  const { core } = setup(async (_preview, receivedSignal) => {
    signal = receivedSignal
    return new Promise(resolve => { finish = resolve })
  })
  const receipt = await ready(core)
  const oldPreview = core.get('folder').preview
  const pending = core.processPreview('folder', receipt)
  await Promise.resolve()
  core.cancelProcessing('folder')
  assert.equal(signal.aborted, true)
  assert.equal(core.get('folder').preview, oldPreview)
  assert.equal(core.get('folder').previewReceipt, receipt)
  assert.equal(core.get('folder').pending, true)
  const joined = core.processPreview('folder', receipt)
  finish({ status: 'ready', preview: structuredClone(recognized) })
  await Promise.all([pending, joined])
  assert.equal(core.get('folder').preview, oldPreview)
  assert.equal(core.get('folder').previewReceipt, receipt)
  assert.equal(core.get('folder').pending, false)
})

for (const disposal of ['dismiss', 'retain', 'clear'] as const) {
  test(`${disposal} aborts pending OCR and fences late completion`, async () => {
    let signal!: AbortSignal
    let finish!: (value: unknown) => void
    const { core } = setup(async (_preview, receivedSignal) => {
      signal = receivedSignal
      return new Promise(resolve => { finish = resolve })
    })
    const receipt = await ready(core)
    const pending = core.processPreview('folder', receipt)
    await Promise.resolve()
    if (disposal === 'dismiss') core.dismiss('folder')
    else if (disposal === 'retain') core.retain([])
    else core.clear()
    assert.equal(signal.aborted, true)
    assert.equal(core.get('folder').preview, null)
    finish({ status: 'ready', preview: structuredClone(recognized) })
    await pending
    assert.equal(core.get('folder').preview, null)
    assert.equal(core.get('folder').previewReceipt, null)
  })
}
