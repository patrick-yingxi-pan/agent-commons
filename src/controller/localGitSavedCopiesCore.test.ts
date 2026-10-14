import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLocalGitSavedCopiesCore } from './localGitSavedCopiesCore.ts'

const scope = (account: number, target: string) => JSON.stringify([account, target])

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

test('an exact preview receipt coalesces across picker remounts until context acknowledgement', async () => {
  const core = createLocalGitSavedCopiesCore()
  const gate = deferred<void>()
  const calls: string[] = []
  const makeId = () => 'file-copy-id'
  const target = scope(1, 'session-a')
  const first = core.submit(target, 'connection-a', 7, makeId, id => { calls.push(id); return gate.promise })
  const reopened = core.submit(target, 'connection-a', 7, makeId, id => { calls.push(`duplicate:${id}`) })
  assert.equal(first.id, reopened.id)
  assert.equal(first.promise, reopened.promise)
  assert.equal(reopened.coalesced, true)
  assert.deepEqual(calls, [], 'work enters the ordinary context funnel on a queued microtask')
  await Promise.resolve()
  assert.deepEqual(calls, ['file-copy-id'])
  assert.equal(core.isPending(target, 'connection-a', 7), true)
  gate.resolve()
  await first.promise
  assert.equal(core.isPending(target, 'connection-a', 7), false)
  assert.equal(core.id(target, 'connection-a', 7), 'file-copy-id', 'byte-free identity remains stable after ack/reopen')
  assert.deepEqual(core.ids(target), ['file-copy-id'])
  assert.deepEqual(core.ids(scope(1, 'session-b')), [])
})

test('target, connection, account, and fresh preview receipt each fence saved-copy identity', () => {
  const core = createLocalGitSavedCopiesCore()
  let id = 0
  const makeId = () => `id-${++id}`
  const create = (target: string, connection: string, receipt: number) => core.submit(target, connection, receipt, makeId, () => undefined).id
  const first = create(scope(1, 'session'), 'connection-a', 1)
  assert.notEqual(create(scope(1, 'session'), 'connection-a', 2), first, 'a new native preview is a new intent')
  assert.notEqual(create(scope(1, 'session'), 'connection-b', 1), first, 'repositories cannot collide on same path/text')
  assert.notEqual(create(scope(1, 'other-session'), 'connection-a', 1), first, 'copies are scoped to the conversation or draft')
  assert.notEqual(create(scope(2, 'session'), 'connection-a', 1), first, 'account switches fence identity')
  assert.deepEqual(core.ids(scope(1, 'session')).length, 3)
  core.clear()
  assert.deepEqual(core.ids(scope(1, 'session')), [])
})

test('account clear drops only byte-free receipt metadata and does not cancel submitted context work', async () => {
  const core = createLocalGitSavedCopiesCore()
  const gate = deferred<void>()
  let submitted = 0
  const target = scope(1, 'session')
  const intent = core.submit(target, 'connection', 9, () => 'stable-id', () => {
    submitted++
    return gate.promise
  })
  await Promise.resolve()
  core.clear()
  assert.equal(core.ids(target).length, 0)
  assert.equal(submitted, 1)
  gate.resolve()
  await intent.promise
  assert.equal(submitted, 1, 'account clearing does not replay or cancel the context mutation')
})

test('draft identity adopts into the materialized session only when its exact ID is attached there', () => {
  const core = createLocalGitSavedCopiesCore()
  const draft = scope(7, 'draft')
  const session = scope(7, 'session-1')
  const unrelatedSession = scope(7, 'session-2')
  const receiptId = core.submit(draft, 'connection', 12, () => 'saved-copy-id', () => undefined).id

  assert.deepEqual(core.adoptAttachments(session, ['another-file-id']), [])
  assert.deepEqual(core.ids(session), [], 'a same-account session cannot adopt without the represented attachment ID')
  assert.deepEqual(core.adoptAttachments(unrelatedSession, []), [])
  assert.deepEqual(core.ids(unrelatedSession), [], 'another target does not inherit the draft receipt')

  assert.deepEqual(core.adoptAttachments(session, [receiptId]), [receiptId])
  assert.equal(core.id(session, 'connection', 12), receiptId, 'materialization aliases only the byte-free receipt identity')
  assert.deepEqual(core.adoptAttachments(unrelatedSession, ['another-file-id']), [])
})

test('authoritative adoption during a failure notification keeps the live entry and settles its pending state', async () => {
  const core = createLocalGitSavedCopiesCore()
  const target = scope(3, 'session')
  let rejectWork!: (error: Error) => void
  let calls = 0
  const intent = core.submit(target, 'connection', 14, () => 'adopted-id', () => {
    calls++
    return new Promise<void>((_resolve, reject) => { rejectWork = reject })
  })
  await Promise.resolve()
  let adoptedDuringFailure = false
  core.subscribe(target, 'connection', 14, () => {
    if (core.isFailed(target, 'connection', 14) && !adoptedDuringFailure) {
      adoptedDuringFailure = true
      assert.deepEqual(core.adoptAttachments(target, ['adopted-id']), ['adopted-id'])
    }
  })

  rejectWork(new Error('lost acknowledgement'))
  await assert.rejects(intent.promise, /lost acknowledgement/)
  assert.equal(adoptedDuringFailure, true)
  assert.equal(core.isPending(target, 'connection', 14), false)
  assert.equal(core.isFailed(target, 'connection', 14), false)
  const alreadyAttached = core.submit(target, 'connection', 14, () => 'wrong-id', () => { calls++ })
  assert.equal(alreadyAttached.id, 'adopted-id')
  assert.equal(alreadyAttached.coalesced, true)
  await alreadyAttached.promise
  assert.equal(calls, 1, 'an authoritative attachment suppresses retry of the same receipt')
})

test('attachment adoption mutates receipt state without notifying subscribers during render projection', async () => {
  const core = createLocalGitSavedCopiesCore()
  const target = scope(3, 'session')
  const gate = deferred<void>()
  const intent = core.submit(target, 'connection', 15, () => 'render-adopted-id', () => gate.promise)
  await Promise.resolve()
  let notifications = 0
  core.subscribe(target, 'connection', 15, () => { notifications++ })

  assert.deepEqual(core.adoptAttachments(target, ['render-adopted-id']), ['render-adopted-id'])
  assert.equal(notifications, 0, 'render-time authoritative projection must not synchronously notify external-store subscribers')
  assert.equal(core.isPending(target, 'connection', 15), false)
  gate.resolve()
  await intent.promise
  assert.equal(notifications, 1, 'the settled in-flight submission still publishes its own completion')
})

test('removing an acknowledged attachment re-enables explicit attach with the same saved identity', async () => {
  const core = createLocalGitSavedCopiesCore()
  const target = scope(3, 'session')
  let calls = 0
  const first = core.submit(target, 'connection', 17, () => 'reattachable-id', () => { calls++ })
  await first.promise
  assert.deepEqual(core.acknowledgedIds(target, ['reattachable-id']), ['reattachable-id'])

  assert.deepEqual(core.acknowledgedIds(target, []), [], 'an authoritative removal clears the Added projection')
  const second = core.submit(target, 'connection', 17, () => 'wrong-id', () => { calls++ })
  assert.equal(second.id, 'reattachable-id')
  assert.equal(second.coalesced, false)
  await second.promise
  assert.equal(calls, 2, 'explicit reattach performs fresh work while preserving the opaque saved ID')
})

test('draft promotion aliases the live receipt entry so late failure cannot strand or revive the adopted target', async () => {
  const core = createLocalGitSavedCopiesCore()
  const draft = scope(4, 'draft')
  const session = scope(4, 'session')
  const gate = deferred<void>()
  const intent = core.submit(draft, 'connection', 16, () => 'promoted-id', () => gate.promise)
  await Promise.resolve()
  assert.deepEqual(core.adoptAttachments(session, ['promoted-id']), ['promoted-id'])
  assert.equal(core.isPending(session, 'connection', 16), false)
  gate.reject(new Error('late lost acknowledgement'))
  await assert.rejects(intent.promise, /late lost acknowledgement/)
  assert.equal(core.isPending(session, 'connection', 16), false)
  assert.equal(core.isFailed(session, 'connection', 16), false)
  assert.equal(core.id(session, 'connection', 16), 'promoted-id')
})

test('acknowledged saved-copy projection counts only known IDs present in actual attachments', () => {
  const core = createLocalGitSavedCopiesCore()
  const target = scope(9, 'session')
  const id = core.submit(target, 'connection', 4, () => 'saved-copy-id', () => undefined).id
  const unrelated = core.submit(target, 'connection', 5, () => 'pending-copy-id', () => undefined).id
  assert.deepEqual(core.acknowledgedIds(target, ['other-context-id']), [])
  assert.deepEqual(core.acknowledgedIds(target, [id, 'other-context-id']), [id])
  assert.equal(core.acknowledgedIds(target, [id, unrelated]).length, 2,
    'each recognized receipt contributes only when its exact attachment ID is authoritative')
})

test('acknowledged saved-copy counts stay isolated by source kind', () => {
  const core = createLocalGitSavedCopiesCore()
  const target = scope(9, 'session')
  const create = (source: 'git' | 'git-untracked' | 'folder') => core.submit(
    target, 'same-connection', 4, () => `${source}-copy-id`, () => undefined, source,
  ).id
  const gitId = create('git')
  const untrackedId = create('git-untracked')
  const folderId = create('folder')

  assert.notEqual(gitId, folderId, 'identical receipt coordinates from distinct sources remain distinct intents')
  assert.notEqual(gitId, untrackedId, 'tracked and untracked receipt counters cannot alias')
  assert.notEqual(untrackedId, folderId, 'untracked and folder receipt coordinates remain distinct intents')
  assert.deepEqual(core.acknowledgedIds(target, [gitId, folderId], 'git'), [gitId])
  assert.deepEqual(core.acknowledgedIds(target, [gitId, untrackedId], 'git-untracked'), [untrackedId])
  assert.deepEqual(core.acknowledgedIds(target, [gitId, folderId], 'folder'), [folderId])
})

test('adoption retains account fencing even when another account presents the same attachment ID', () => {
  const core = createLocalGitSavedCopiesCore()
  const draft = scope(7, 'draft')
  const otherAccountSession = scope(8, 'session')
  const id = core.submit(draft, 'connection', 12, () => 'saved-copy-id', () => undefined).id
  assert.deepEqual(core.adoptAttachments(otherAccountSession, [id]), [])
  assert.deepEqual(core.ids(otherAccountSession), [])
})

test('read-only identity lookup never creates IDs or retains a row for an un-attached preview', () => {
  const core = createLocalGitSavedCopiesCore()
  const target = scope(4, 'session')
  assert.equal(core.id(target, 'connection', 21), undefined)
  assert.equal(core.id(target, 'connection', 21), undefined)
  assert.deepEqual(core.ids(target), [])
})
