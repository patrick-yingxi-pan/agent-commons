import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { LocalGitReview } from '../../contract/localGitReview.mjs'
import { createLocalGitReviewsCore } from './localGitReviewsCore.ts'

const first: LocalGitReview = {
  version: 1, comparison: 'raw', head: { oid: 'a'.repeat(40), ref: 'refs/heads/main' },
  excludedCount: 0, unchangedCount: 0,
  files: [
    { path: 'a.md', staged: 'modified', unstaged: 'unchanged', head: { kind: 'text', text: 'a0', mode: '100644' },
      index: { kind: 'text', text: 'a1', mode: '100644' }, working: { kind: 'omitted', reason: 'not-needed' } },
    { path: 'b.md', staged: 'unchanged', unstaged: 'modified', head: { kind: 'omitted', reason: 'not-needed' },
      index: { kind: 'text', text: 'b0', mode: '100644' }, working: { kind: 'text', text: 'b1', mode: '100644' } },
  ],
}
const changedPath = (path: string): LocalGitReview => ({
  ...first,
  files: [{ ...first.files[0]!, path, unstaged: 'modified' }],
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

test('review state is stable while idle, shared across subscribers and coalesces explicit reads', async () => {
  const pending = deferred<LocalGitReview>()
  let reads = 0
  let now = 42
  const core = createLocalGitReviewsCore({ read: () => { reads += 1; return pending.promise }, now: () => now })
  const id = 'GIT_A'
  assert.strictEqual(core.get(id), core.get(id), 'idle snapshot identity is stable for useSyncExternalStore')
  const changes: string[] = []
  const unsubscribeA = core.subscribe(id, () => changes.push(`a:${core.get(id).status}`))
  const unsubscribeB = core.subscribe(id, () => changes.push(`b:${core.get(id).status}`))
  const a = core.read(id)
  const b = core.read(id)
  assert.strictEqual(a, b)
  await Promise.resolve()
  assert.equal(reads, 1)
  assert.equal(core.get(id).status, 'loading')
  core.select(id, 'unstaged', null)
  assert.equal(core.get(id).comparison, 'staged', 'selection changes only after a review is ready')
  pending.resolve(first)
  assert.deepEqual(await a, first)
  assert.deepEqual(core.get(id), {
    status: 'ready', result: first, readAt: now, error: null, comparison: 'staged', path: 'a.md', pending: false,
  })
  core.select(id, 'unstaged', 'b.md')
  assert.equal(core.get(id).path, 'b.md')
  assert.equal(core.get(id).comparison, 'unstaged')
  assert.deepEqual(changes, ['a:loading', 'b:loading', 'a:ready', 'b:ready', 'a:ready', 'b:ready'])
  unsubscribeA()
  unsubscribeB()
})

test('refresh retains valid selection and normalizes a missing path to the first comparable change', async () => {
  let current = first
  const core = createLocalGitReviewsCore({ read: async () => current, now: () => 10 })
  await core.read('GIT_A')
  core.select('GIT_A', 'unstaged', 'b.md')
  current = { ...first, files: [...first.files, { ...first.files[0]!, path: 'c.md' }] }
  await core.read('GIT_A')
  assert.equal(core.get('GIT_A').comparison, 'unstaged')
  assert.equal(core.get('GIT_A').path, 'b.md', 'an extant selection survives refresh')
  current = { ...first, files: [{ ...first.files[0]!, path: 'd.md', unstaged: 'modified' }] }
  await core.read('GIT_A')
  assert.equal(core.get('GIT_A').path, 'd.md', 'a removed selection falls back to a current changed path')
})

test('dismiss hides an in-flight review, keeps its slot until settle, then permits a fresh read', async () => {
  const pending = deferred<LocalGitReview>()
  let reads = 0
  const core = createLocalGitReviewsCore({
    read: () => ++reads === 1 ? pending.promise : Promise.resolve(changedPath('fresh.md')),
    now: () => 20,
  })
  const original = core.read('GIT_A')
  core.dismiss('GIT_A')
  assert.equal(core.get('GIT_A').status, 'idle')
  assert.equal(core.get('GIT_A').pending, true, 'dismiss hides content but exposes the occupied native read')
  core.dismiss('GIT_A')
  assert.equal(core.get('GIT_A').pending, true, 'repeated dismissal does not release the in-flight slot')
  assert.strictEqual(core.read('GIT_A'), original, 'dismissed request remains deduplicated for this account epoch')
  await Promise.resolve()
  assert.equal(reads, 1)
  pending.resolve(first)
  assert.equal(await original, null, 'the dismissed response cannot be returned as current state')
  assert.equal(core.get('GIT_A').status, 'idle')
  assert.equal(core.get('GIT_A').pending, false, 'settlement releases the hidden native read slot')
  const retry = core.read('GIT_A')
  assert.equal((await retry)?.files[0]?.path, 'fresh.md')
  assert.equal(reads, 2)
})

test('clear and removal retain pending bookkeeping but fence late replies and allow a new account read', async () => {
  const old = deferred<LocalGitReview>()
  const fresh = deferred<LocalGitReview>()
  let reads = 0
  const core = createLocalGitReviewsCore({
    read: () => ++reads === 1 ? old.promise : fresh.promise,
    now: () => 30,
  })
  const oldRead = core.read('GIT_A')
  core.clear()
  assert.equal(core.get('GIT_A').status, 'idle')
  const newRead = core.read('GIT_A')
  await Promise.resolve()
  assert.equal(reads, 2, 'account epoch can start a fresh native read while retaining old bookkeeping')
  fresh.resolve(changedPath('new-account.md'))
  assert.equal((await newRead)?.files[0]?.path, 'new-account.md')
  assert.equal(core.get('GIT_A').pending, false)
  old.resolve(changedPath('old-account.md'))
  assert.equal(await oldRead, null)
  assert.equal(core.get('GIT_A').result?.files[0]?.path, 'new-account.md')

  const removed = deferred<LocalGitReview>()
  const absentCore = createLocalGitReviewsCore({ read: () => removed.promise, now: () => 31 })
  const removedRead = absentCore.read('GIT_B')
  absentCore.retain([])
  assert.equal(absentCore.get('GIT_B').status, 'idle')
  removed.resolve(changedPath('removed.md'))
  assert.equal(await removedRead, null, 'an authoritative roster removal fences pending review content')
  assert.equal(absentCore.get('GIT_B').result, null)
})

test('failed reads clear current content and explicit retry can recover', async () => {
  let fail = false
  const core = createLocalGitReviewsCore({ read: async () => {
    if (fail) throw new Error('native path detail must not escape')
    return first
  }, now: () => 77 })
  await core.read('GIT_A')
  assert.ok(core.get('GIT_A').result)
  fail = true
  assert.equal(await core.read('GIT_A'), null)
  assert.deepEqual(core.get('GIT_A'), {
    status: 'error', result: null, readAt: null,
    error: 'Could not read this repository review. Check the connection and try again.',
    comparison: 'staged', path: null, pending: false,
  })
  fail = false
  assert.deepEqual(await core.read('GIT_A'), first)
  assert.equal(core.get('GIT_A').status, 'ready')
})

test('explicit roster retention removes only known-absent states and dismiss resets selection', async () => {
  const core = createLocalGitReviewsCore({ read: async id => changedPath(id), now: () => 91 })
  await core.read('GIT_A')
  await core.read('GIT_B')
  core.select('GIT_A', 'unstaged', 'a.md')
  core.retain(['GIT_A'])
  assert.equal(core.get('GIT_A').status, 'ready')
  assert.equal(core.get('GIT_B').status, 'idle')
  core.dismiss('GIT_A')
  assert.deepEqual(core.get('GIT_A'), {
    status: 'idle', result: null, readAt: null, error: null, comparison: 'staged', path: null, pending: false,
  })
})
