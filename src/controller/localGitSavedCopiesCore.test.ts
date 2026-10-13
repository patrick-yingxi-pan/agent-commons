import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLocalGitSavedCopiesCore } from './localGitSavedCopiesCore.ts'

const scope = (account: number, target: string) => JSON.stringify([account, target])

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
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
