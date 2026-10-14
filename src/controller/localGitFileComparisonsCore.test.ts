import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { LocalGitFileComparison } from '../../contract/localGitFileComparison.mjs'
import { createLocalGitFileComparisonsCore } from './localGitFileComparisonsCore.ts'

function captured(path: string, comparison: 'staged' | 'unstaged' = 'staged'): LocalGitFileComparison {
  return {
    version: 1, scope: 'file-comparison', path, comparison,
    head: { oid: null, ref: 'refs/heads/main' },
    status: 'ready', change: 'modified',
    before: { kind: 'text', text: 'before', mode: '100644' },
    after: { kind: 'text', text: 'after', mode: '100644' },
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

test('unseen IDs return one stable idle snapshot for useSyncExternalStore', () => {
  const core = createLocalGitFileComparisonsCore({ read: async () => captured('file.txt'), now: () => 0 })
  assert.strictEqual(core.get('unseen'), core.get('unseen'))
  assert.strictEqual(core.get('unseen'), core.get('another-unseen'), 'all unmaterialized IDs share the immutable idle snapshot')
})

test('file comparison reads only on explicit submit and coalesces same request across remount subscribers', async () => {
  const gate = deferred<LocalGitFileComparison>()
  const reads: Array<{ id: string; path: string; comparison: string; signal: AbortSignal }> = []
  const core = createLocalGitFileComparisonsCore({
    read(id, selection, signal) { reads.push({ id, ...selection, signal }); return gate.promise },
    now: () => 123,
  })
  const updates: string[] = []
  const unsubscribe = core.subscribe('repo', () => updates.push(core.get('repo').status))
  core.setDraftPath('repo', 'head-only/deleted.txt')
  core.setComparison('repo', 'staged')
  assert.equal(reads.length, 0, 'typing and selecting a direction never read source bytes')
  const first = core.read('repo')
  const second = core.read('repo')
  assert.strictEqual(first, second, 'identical pending compares coalesce')
  await Promise.resolve()
  assert.deepEqual(reads.map(({ id, path, comparison }) => ({ id, path, comparison })), [
    { id: 'repo', path: 'head-only/deleted.txt', comparison: 'staged' },
  ])
  const source = captured('head-only/deleted.txt')
  gate.resolve(source)
  const result = await first
  assert.deepEqual(result, source)
  assert.equal(core.get('repo').status, 'ready')
  assert.equal(core.get('repo').readAt, 123)
  assert.strictEqual(core.get('repo').result, result, 'the exact detached capture is shared by all pane mounts')
  assert.ok(updates.includes('loading') && updates.includes('ready'))
  unsubscribe()
})

test('editing either request field aborts pending work and prevents old capture from replacing the draft', async () => {
  const gate = deferred<LocalGitFileComparison>()
  let signal: AbortSignal | undefined
  const core = createLocalGitFileComparisonsCore({
    read(_id, _selection, requestSignal) { signal = requestSignal; return gate.promise },
    now: () => 1,
  })
  core.setDraftPath('repo', 'src/first.ts')
  const pending = core.read('repo')
  await Promise.resolve()
  core.setDraftPath('repo', 'src/second.ts')
  assert.equal(signal?.aborted, true)
  gate.resolve(captured('src/first.ts'))
  assert.equal(await pending, null)
  assert.equal(core.get('repo').draftPath, 'src/second.ts')
  assert.equal(core.get('repo').result, null)
  assert.equal(core.get('repo').status, 'idle')

  const nextGate = deferred<LocalGitFileComparison>()
  const secondCore = createLocalGitFileComparisonsCore({ read: () => nextGate.promise, now: () => 2 })
  secondCore.setDraftPath('repo', 'src/file.ts')
  const stale = secondCore.read('repo')
  secondCore.setComparison('repo', 'unstaged')
  nextGate.resolve(captured('src/file.ts'))
  assert.equal(await stale, null)
  assert.equal(secondCore.get('repo').comparison, 'unstaged')
  assert.equal(secondCore.get('repo').result, null)
})

test('Dismiss, connection removal, and account clear abort and fence late comparison results', async () => {
  const gates: Array<ReturnType<typeof deferred<LocalGitFileComparison>>> = []
  const core = createLocalGitFileComparisonsCore({
    read() { const gate = deferred<LocalGitFileComparison>(); gates.push(gate); return gate.promise },
    now: () => 3,
  })
  core.setDraftPath('dismissed', 'file.txt')
  const dismissed = core.read('dismissed')
  await Promise.resolve()
  core.dismiss('dismissed')
  gates[0]!.resolve(captured('file.txt'))
  assert.equal(await dismissed, null)
  assert.equal(core.get('dismissed').result, null)

  core.setDraftPath('removed', 'file.txt')
  const removed = core.read('removed')
  await Promise.resolve()
  core.retain([])
  gates[1]!.resolve(captured('file.txt'))
  assert.equal(await removed, null)
  assert.equal(core.get('removed').draftPath, '')
  assert.strictEqual(core.get('removed'), core.get('never-materialized'), 'removed IDs release cached draft state')

  core.setDraftPath('account', 'file.txt')
  const account = core.read('account')
  await Promise.resolve()
  core.clear()
  gates[2]!.resolve(captured('file.txt'))
  assert.equal(await account, null)
  assert.equal(core.get('account').status, 'idle')
})

test('read error remains retryable and mismatched results cannot become captured state', async () => {
  let count = 0
  const core = createLocalGitFileComparisonsCore({
    read: async () => {
      count += 1
      if (count === 1) throw new Error('native read failed')
      return captured('different.txt')
    },
    now: () => 4,
  })
  core.setDraftPath('repo', 'file.txt')
  assert.equal(await core.read('repo'), null)
  assert.equal(core.get('repo').status, 'error')
  assert.equal(await core.read('repo'), null)
  assert.equal(core.get('repo').status, 'error')
  assert.equal(core.get('repo').result, null)
})
