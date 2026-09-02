import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createAcknowledgedActionMutationController,
  type AcknowledgedActionMutationDeps,
} from './acknowledgedActionMutationCore.ts'
import type { RevisionedMutationStatus } from './revisionedMutationCore.ts'

type Pending = {
  resourceId: string
  idempotencyKey: string
  resolve: () => void
  reject: (error: unknown) => void
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

function harness() {
  const calls: Pending[] = []
  const statuses: RevisionedMutationStatus[] = []
  const reconciled: { resourceId: string; baseline: readonly string[]; idempotencyKey: string }[] = []
  const realized = new Set<string>()
  let key = 0
  const deps: AcknowledgedActionMutationDeps<string, readonly string[]> = {
    resourceId: (resourceId) => resourceId,
    snapshot: (resourceId) => [`before:${resourceId}`],
    mutate: (resourceId, idempotencyKey) => new Promise<void>((resolve, reject) => {
      calls.push({ resourceId, idempotencyKey, resolve, reject })
    }),
    reconcile: async (resourceId, baseline, idempotencyKey) => {
      reconciled.push({ resourceId, baseline, idempotencyKey })
      return realized.has(resourceId)
    },
    describeFailure: () => ({ message: 'Run intent still held.', retryable: true }),
    setStatus: (status) => statuses.push(status),
    mintIdempotencyKey: () => `logical-run-${++key}`,
  }
  return {
    calls,
    statuses,
    reconciled,
    realized,
    controller: createAcknowledgedActionMutationController(deps),
  }
}

test('acknowledged actions serialize and Retry reuses one logical key', async () => {
  const h = harness()
  const first = h.controller.enqueue('routine-one')
  const second = h.controller.enqueue('routine-two')
  assert.equal(h.calls.length, 1, 'later intent cannot jump an unresolved head')
  const key = h.calls[0]!.idempotencyKey

  h.calls[0]!.reject(new Error('offline'))
  await tick()
  assert.equal(h.statuses.at(-1)?.error, 'Run intent still held.')
  assert.deepEqual(h.reconciled, [{
    resourceId: 'routine-one',
    baseline: ['before:routine-one'],
    idempotencyKey: key,
  }])

  h.controller.retry()
  assert.equal(h.calls[1]!.idempotencyKey, key, 'Retry is retransmission of the same act')
  h.calls[1]!.resolve()
  await tick()
  assert.equal(await first, 'applied')
  assert.equal(h.calls[2]!.resourceId, 'routine-two')

  h.calls[2]!.resolve()
  await tick()
  assert.equal(await second, 'applied')
  assert.equal(h.statuses.at(-1)?.pendingCount, 0)
})

test('authoritative reconciliation heals a committed action whose acknowledgement was lost', async () => {
  const h = harness()
  const result = h.controller.enqueue('routine-realized')
  h.realized.add('routine-realized')
  h.calls[0]!.reject(new Error('response lost'))
  await tick()

  assert.equal(await result, 'applied')
  assert.equal(h.statuses.at(-1)?.error, null)
  assert.equal(h.statuses.at(-1)?.pendingCount, 0)
})

test('Dismiss reconciles before releasing later action intent', async () => {
  const h = harness()
  const first = h.controller.enqueue('routine-one')
  const second = h.controller.enqueue('routine-two')
  h.calls[0]!.reject(new Error('uncertain'))
  await tick()

  const reconciledBefore = h.reconciled.length
  h.controller.discard()
  await tick()
  assert.ok(h.reconciled.length > reconciledBefore, 'Dismiss performs one final truth read')
  assert.equal(await first, 'discarded')
  assert.equal(h.calls.at(-1)?.resourceId, 'routine-two', 'later intent starts only after reconciliation')

  h.calls.at(-1)!.resolve()
  await tick()
  assert.equal(await second, 'applied')
})

test('clearing the account scope discards queued work and ignores a late acknowledgement', async () => {
  const h = harness()
  const first = h.controller.enqueue('routine-one')
  const second = h.controller.enqueue('routine-two')
  h.controller.clearAll()
  assert.equal(await first, 'discarded')
  assert.equal(await second, 'discarded')
  assert.equal(h.statuses.at(-1)?.pendingCount, 0)

  h.calls[0]!.resolve()
  await tick()
  assert.equal(h.calls.length, 1, 'the retired account cannot drain its old queue')
})

test('an action input may carry payload while exposing a stable recovery resource id', async () => {
  type Intent = { intentId: string; title: string }
  const statuses: RevisionedMutationStatus[] = []
  const calls: Intent[] = []
  const controller = createAcknowledgedActionMutationController<Intent, string[]>({
    resourceId: (intent: Intent) => intent.intentId,
    snapshot: () => [] as string[],
    mutate: async (intent: Intent) => { calls.push(intent) },
    reconcile: async () => false,
    describeFailure: () => ({ message: 'held', retryable: true }),
    setStatus: (status: RevisionedMutationStatus) => statuses.push(status),
    mintIdempotencyKey: () => 'dispatch-key',
  })
  const intent = { intentId: 'dispatch-intent-1', title: 'Triage support' }

  assert.equal(await controller.enqueue(intent), 'applied')
  assert.deepEqual(calls, [intent])
  assert.equal(statuses.find((status) => status.busy)?.activeResourceId, intent.intentId)
})
