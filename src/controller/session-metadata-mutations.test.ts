import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Session, SessionMetadataPatch } from '../../contract/index.ts'
import {
  createSessionMetadataMutationController,
  type SessionMetadataMutationStatus,
} from './sessionMetadataMutationsCore.ts'

interface Call {
  sessionId: string
  patch: SessionMetadataPatch
  expectedRevision: number
  idempotencyKey: string
  resolve: (session: Session) => void
  reject: (error: unknown) => void
}

const session = (id: string, metadataRevision: number, title = id): Session => ({
  id,
  title,
  caps: ['chat'],
  preview: '',
  metadataRevision,
})
const tick = () => new Promise<void>((resolve) => setImmediate(resolve))

function harness() {
  const records = new Map<string, Session>([['s1', session('s1', 0)]])
  const calls: Call[] = []
  const reconciles: string[] = []
  const statuses: SessionMetadataMutationStatus[] = []
  let seq = 0
  const controller = createSessionMetadataMutationController({
    snapshot: (id) => records.get(id),
    reconcile: async (id) => {
      reconciles.push(id)
      const current = records.get(id)
      if (!current) throw new Error('gone')
      return current
    },
    mutate: (sessionId, patch, expectedRevision, idempotencyKey) =>
      new Promise<Session>((resolve, reject) => {
        calls.push({ sessionId, patch, expectedRevision, idempotencyKey, resolve, reject })
      }),
    describeFailure: (error) => ({
      message: error instanceof Error ? error.message : 'failed',
      retryable: true,
    }),
    setStatus: (next) => statuses.push(next),
    mintIdempotencyKey: () => `session-metadata-${(seq += 1)}`,
  })
  return { controller, calls, records, reconciles, statuses }
}

test('metadata edits serialize and each acknowledgement becomes the next precondition', async () => {
  const h = harness()
  const renamed = h.controller.enqueue('s1', { title: 'Renamed' })
  const pinned = h.controller.enqueue('s1', { pinned: true })
  assert.equal(h.calls.length, 1, 'only the FIFO head reaches the server')
  assert.equal(h.calls[0]!.expectedRevision, 0)
  assert.equal(h.statuses.at(-1)?.pendingCount, 2)

  const revisionOne = session('s1', 1, 'Renamed')
  h.records.set('s1', revisionOne)
  h.calls[0]!.resolve(revisionOne)
  await tick()
  assert.equal(await renamed, 'applied')
  assert.equal(h.calls.length, 2)
  assert.equal(h.calls[1]!.expectedRevision, 1, 'the second edit rebases on the acknowledgement')

  const revisionTwo = { ...revisionOne, pinned: true, metadataRevision: 2 }
  h.records.set('s1', revisionTwo)
  h.calls[1]!.resolve(revisionTwo)
  await tick()
  assert.equal(await pinned, 'applied')
  assert.equal(h.statuses.at(-1)?.busy, false)
})

test('a stale conflict refreshes server truth and Retry keeps the logical key', async () => {
  const h = harness()
  const outcome = h.controller.enqueue('s1', { title: 'My title' })
  const key = h.calls[0]!.idempotencyKey
  h.records.set('s1', session('s1', 4, 'Other device'))
  h.calls[0]!.reject(new Error('changed elsewhere'))
  await tick()
  assert.deepEqual(h.reconciles, ['s1'])
  assert.equal(h.statuses.at(-1)?.error, 'changed elsewhere')

  h.controller.retry()
  assert.equal(h.calls.length, 2)
  assert.equal(h.calls[1]!.expectedRevision, 4, 'Retry rebases on the refreshed revision')
  assert.equal(h.calls[1]!.idempotencyKey, key, 'Retry retransmits one logical mutation')
  const landed = session('s1', 5, 'My title')
  h.records.set('s1', landed)
  h.calls[1]!.resolve(landed)
  await tick()
  assert.equal(await outcome, 'applied')
})

test('Dismiss reconciles uncertain state and advances the held queue', async () => {
  const h = harness()
  const first = h.controller.enqueue('s1', { title: 'One' })
  const second = h.controller.enqueue('s1', { pinned: true })
  h.calls[0]!.reject(new Error('offline'))
  await tick()
  h.controller.discard()
  assert.equal(await first, 'discarded')
  assert.equal(h.calls.length, 2, 'later intent waits for explicit dismissal')
  h.calls[1]!.resolve(session('s1', 1))
  await tick()
  assert.equal(await second, 'applied')
  assert.ok(h.reconciles.length >= 2, 'failure and dismissal both distrust uncertain local state')
})

test('account clearing drops late acknowledgements without projecting success', async () => {
  const h = harness()
  const first = h.controller.enqueue('s1', { title: 'Old account' })
  const second = h.controller.enqueue('s1', { pinned: true })
  h.controller.clearAll()
  assert.deepEqual(await Promise.all([first, second]), ['discarded', 'discarded'])
  h.calls[0]!.resolve(session('s1', 1, 'Old account'))
  await tick()
  assert.equal(h.statuses.at(-1)?.pendingCount, 0)
})
