import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Session } from '../../contract/index.ts'
import {
  createSessionDeletionMutationController,
  describeSessionDeletionHttpFailure,
} from './sessionDeletionMutationsCore.ts'
import type { RevisionedMutationStatus } from './revisionedMutationCore.ts'

interface DeleteCall {
  sessionId: string
  expectedRevision: number
  idempotencyKey: string
  resolve: () => void
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
  const records = new Map<string, Session>([
    ['s1', session('s1', 0)],
    ['s2', session('s2', 3)],
  ])
  const calls: DeleteCall[] = []
  const reconciles: string[] = []
  const statuses: RevisionedMutationStatus[] = []
  let seq = 0
  let reconcileGate: Promise<void> | null = null
  const controller = createSessionDeletionMutationController({
    reconcile: async (id) => {
      reconciles.push(id)
      await reconcileGate
      return records.get(id) ?? null
    },
    mutate: (sessionId, expectedRevision, idempotencyKey) =>
      new Promise<void>((resolve, reject) => {
        calls.push({ sessionId, expectedRevision, idempotencyKey, resolve, reject })
      }),
    describeFailure: (error) => ({
      message: error instanceof Error ? error.message : 'failed',
      retryable: true,
      rebaseOnRetry: error instanceof Error && error.message.includes('changed elsewhere'),
    }),
    setStatus: (next) => statuses.push(next),
    mintIdempotencyKey: () => `session-delete-${(seq += 1)}`,
  })
  return {
    controller,
    calls,
    records,
    reconciles,
    statuses,
    holdReconcile() {
      let release!: () => void
      reconcileGate = new Promise<void>((resolve) => { release = resolve })
      return () => {
        reconcileGate = null
        release()
      }
    },
  }
}

test('busy deletion conflicts preserve their actionable server explanation without rebasing consent', () => {
  for (const message of [
    'Wait for or cancel the current reply before deleting this conversation.',
    'Wait for the current summary to finish before deleting this conversation.',
  ]) {
    assert.deepEqual(
      describeSessionDeletionHttpFailure(409, message),
      { message, retryable: true, rebaseOnRetry: false },
    )
  }
})

test('deletion stays pending until acknowledgement and serializes later intent', async () => {
  const h = harness()
  const first = h.controller.enqueue('s1', 0)
  const duplicate = h.controller.enqueue('s1', 0)
  const second = h.controller.enqueue('s2', 3)

  assert.equal(h.calls.length, 1, 'only the FIFO head reaches the server')
  assert.equal(h.calls[0]!.expectedRevision, 0, 'the destructive act pins the reviewed row')
  assert.equal(h.statuses.at(-1)?.pendingCount, 2, 'a duplicate joins its logical deletion')

  h.records.set('s2', session('s2', 9, 'Changed while queued'))
  h.records.delete('s1')
  h.calls[0]!.resolve()
  await tick()
  assert.deepEqual(await Promise.all([first, duplicate]), ['applied', 'applied'])
  assert.equal(h.calls.length, 2)
  assert.equal(h.calls[1]!.expectedRevision, 3, 'queued deletion keeps the revision its confirmation displayed')

  h.records.delete('s2')
  h.calls[1]!.resolve()
  await tick()
  assert.equal(await second, 'applied')
})

test('a stale delete refreshes truth and Retry reuses its key against the new revision', async () => {
  const h = harness()
  const outcome = h.controller.enqueue('s1', 0)
  const key = h.calls[0]!.idempotencyKey
  h.records.set('s1', session('s1', 4, 'Other device title'))
  h.calls[0]!.reject(new Error('changed elsewhere'))
  await tick()

  assert.deepEqual(h.reconciles, ['s1'])
  assert.equal(h.statuses.at(-1)?.error, 'changed elsewhere')
  h.controller.retry()
  assert.equal(h.calls.length, 2)
  assert.equal(h.calls[1]!.expectedRevision, 4, 'Retry pins the reconciled row')
  assert.equal(h.calls[1]!.idempotencyKey, key, 'Retry retains one logical mutation')

  h.records.delete('s1')
  h.calls[1]!.resolve()
  await tick()
  assert.equal(await outcome, 'applied')
})

test('transport Retry keeps the exact confirmed revision even after reconciliation sees a newer row', async () => {
  const h = harness()
  const outcome = h.controller.enqueue('s1', 0)
  const key = h.calls[0]!.idempotencyKey
  h.records.set('s1', session('s1', 5, 'Changed after confirmation'))
  h.calls[0]!.reject(new Error('offline'))
  await tick()

  h.controller.retry()
  assert.equal(h.calls.length, 2)
  assert.equal(h.calls[1]!.expectedRevision, 0, 'uncertainty never expands stale consent')
  assert.equal(h.calls[1]!.idempotencyKey, key)
  h.calls[1]!.reject(new Error('changed elsewhere'))
  await tick()
  h.controller.discard()
  await tick()
  assert.equal(await outcome, 'discarded')
})

test('authoritative absence after a lost acknowledgement completes deletion', async () => {
  const h = harness()
  const outcome = h.controller.enqueue('s1', 0)
  h.records.delete('s1')
  h.calls[0]!.reject(new Error('socket closed'))
  await tick()

  assert.equal(await outcome, 'applied')
  assert.equal(h.statuses.at(-1)?.error, null)
  assert.deepEqual(h.reconciles, ['s1'])
})

test('Dismiss reconciles before it retains the conversation and releases later deletion', async () => {
  const h = harness()
  const first = h.controller.enqueue('s1', 0)
  const second = h.controller.enqueue('s2', 3)
  h.calls[0]!.reject(new Error('offline'))
  await tick()

  const release = h.holdReconcile()
  h.controller.discard()
  assert.equal(h.calls.length, 1, 'later deletion remains held while truth is uncertain')
  release()
  await tick()

  assert.equal(await first, 'discarded')
  assert.equal(h.calls.length, 2, 'later deletion starts only after reconciliation')
  h.records.delete('s2')
  h.calls[1]!.resolve()
  await tick()
  assert.equal(await second, 'applied')
})

test('account clearing drops late deletion acknowledgements without reporting success', async () => {
  const h = harness()
  const outcome = h.controller.enqueue('s1', 0)
  h.controller.clearAll()
  assert.equal(await outcome, 'discarded')
  h.calls[0]!.resolve()
  await tick()
  assert.equal(h.statuses.at(-1)?.pendingCount, 0)
})
