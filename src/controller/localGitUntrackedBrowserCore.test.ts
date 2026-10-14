import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLocalGitUntrackedBrowserCore } from './localGitUntrackedBrowserCore.ts'

const listing = { version: 1 as const, excludedCount: 0, files: [{ path: 'new.txt', kind: 'file' }] }
const preview = { version: 1 as const, path: 'new.txt', sizeBytes: 3, snapshot: { text: 'new' } }

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}

test('untracked browser reads only after explicit list and preview commands', async () => {
  const calls: string[] = []
  const core = createLocalGitUntrackedBrowserCore({
    list: async (_id, signal) => { calls.push(`list:${signal.aborted}`); return listing },
    preview: async (_id, path) => { calls.push(`preview:${path}`); return preview },
    now: () => 12,
  })
  assert.equal(core.get('repo').listing, null)
  assert.deepEqual(calls, [])
  await core.readListing('repo')
  assert.deepEqual(calls, ['list:false'])
  assert.equal(core.get('repo').preview, null)
  await core.readPreview('repo', 'new.txt')
  assert.deepEqual(calls, ['list:false', 'preview:new.txt'])
  assert.equal(core.get('repo').preview?.snapshot.text, 'new')
})

test('dismiss aborts an in-flight untracked preview and fences late text and receipt', async () => {
  const gate = deferred<typeof preview>()
  let signal: AbortSignal | undefined
  const core = createLocalGitUntrackedBrowserCore({
    list: async () => listing,
    preview: async (_id, _path, issuedSignal) => { signal = issuedSignal; return gate.promise },
    now: () => 12,
  })
  await core.readListing('repo')
  const pending = core.readPreview('repo', 'new.txt')
  await Promise.resolve()
  core.dismiss('repo')
  assert.equal(signal?.aborted, true)
  gate.resolve(preview)
  await pending
  assert.equal(core.get('repo').preview, null)
  assert.equal(core.get('repo').previewReceipt, null)
})

test('account clear fences a pending untracked listing', async () => {
  const gate = deferred<typeof listing>()
  const core = createLocalGitUntrackedBrowserCore({ list: () => gate.promise, preview: async () => preview, now: () => 12 })
  const pending = core.readListing('repo')
  await Promise.resolve()
  core.clear()
  gate.resolve(listing)
  await pending
  assert.equal(core.get('repo').listing, null)
})
