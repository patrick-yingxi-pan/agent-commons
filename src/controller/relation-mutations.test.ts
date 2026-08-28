import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emptyGraph, type RelationGraph, type RelationOp } from '../../contract/index.ts'
import {
  createRelationMutationController,
  type RelationMutationStatus,
} from './relationMutationsCore.ts'

interface Call {
  op: RelationOp
  idempotencyKey: string
  resolve: (graph: RelationGraph) => void
  reject: (error: unknown) => void
}

const op = (id: string): RelationOp => ({
  kind: 'create-project',
  projectId: id,
  projectName: id,
  projectDescription: '',
})
const graph = (revision: number): RelationGraph => ({ ...emptyGraph(), revision })
const tick = () => new Promise<void>((resolve) => setImmediate(resolve))

function harness(options: { throwOnCommit?: boolean } = {}) {
  const calls: Call[] = []
  const commits: Array<{ op: RelationOp; graph: RelationGraph }> = []
  const reconciled: RelationOp[] = []
  const statuses: RelationMutationStatus[] = []
  let seq = 0
  const controller = createRelationMutationController({
    mutate: (relation, idempotencyKey) =>
      new Promise<RelationGraph>((resolve, reject) => calls.push({ op: relation, idempotencyKey, resolve, reject })),
    commit: (relation, returned) => {
      if (options.throwOnCommit) throw new Error('projection failed')
      commits.push({ op: relation, graph: returned })
    },
    reconcile: (relation) => reconciled.push(relation),
    describeFailure: () => ({ message: 'Couldn’t confirm.', retryable: true }),
    setStatus: (status) => statuses.push(status),
    mintIdempotencyKey: () => `idem-${(seq += 1)}`,
  })
  return { controller, calls, commits, reconciled, statuses }
}

test('relation edits serialize and project only acknowledged snapshots in user order', async () => {
  const h = harness()
  const first = h.controller.enqueue(op('one'))
  const second = h.controller.enqueue(op('two'))

  assert.equal(h.calls.length, 1, 'only the FIFO head reaches the server')
  assert.deepEqual(h.commits, [], 'enqueue does not optimistically project a graph')
  assert.deepEqual(h.statuses.at(-1)?.pendingKeys, ['create-project:one', 'create-project:two'])

  h.calls[0]!.resolve(graph(1))
  await tick()
  assert.equal(await first, 'applied')
  assert.deepEqual(h.commits.map((entry) => entry.graph.revision), [1])
  assert.equal(h.calls.length, 2, 'the second edit begins only after the first acknowledgement')

  h.calls[1]!.resolve(graph(2))
  await tick()
  assert.equal(await second, 'applied')
  assert.deepEqual(h.commits.map((entry) => entry.graph.revision), [1, 2])
  assert.equal(h.statuses.at(-1)?.busy, false)
  assert.deepEqual(h.statuses.at(-1)?.pendingKeys, [])
})

test('failure holds later intent and Retry reuses the same logical idempotency key', async () => {
  const h = harness()
  const first = h.controller.enqueue(op('one'))
  const second = h.controller.enqueue(op('two'))
  const firstKey = h.calls[0]!.idempotencyKey

  h.calls[0]!.reject(new Error('offline'))
  await tick()
  assert.equal(h.calls.length, 1, 'later intent cannot jump a failed head')
  assert.equal(h.statuses.at(-1)?.failedKey, 'create-project:one')
  assert.equal(h.statuses.at(-1)?.error, 'Couldn’t confirm.')

  h.controller.retry()
  assert.equal(h.calls.length, 2)
  assert.equal(h.calls[1]!.idempotencyKey, firstKey, 'retry is retransmission, not a second mutation')
  h.calls[1]!.resolve(graph(1))
  await tick()
  assert.equal(await first, 'applied')
  assert.equal(h.calls.length, 3, 'the queued edit follows the recovered head')
  h.calls[2]!.resolve(graph(2))
  await tick()
  assert.equal(await second, 'applied')
})

test('Dismiss reconciles an uncertain head, settles it discarded, and advances the queue', async () => {
  const h = harness()
  const first = h.controller.enqueue(op('one'))
  const second = h.controller.enqueue(op('two'))
  h.calls[0]!.reject(new Error('offline'))
  await tick()

  h.controller.discard()
  assert.equal(await first, 'discarded')
  assert.deepEqual(h.reconciled.map((entry) => entry.kind === 'create-project' && entry.projectId), ['one'])
  assert.equal(h.calls.length, 2, 'later intent begins after the explicit dismissal')
  h.calls[1]!.resolve(graph(1))
  await tick()
  assert.equal(await second, 'applied')
})

test('account clearing drops late acknowledgements and settles every abandoned caller', async () => {
  const h = harness()
  const first = h.controller.enqueue(op('one'))
  const second = h.controller.enqueue(op('two'))
  h.controller.clearAll()
  assert.deepEqual(await Promise.all([first, second]), ['discarded', 'discarded'])

  h.calls[0]!.resolve(graph(1))
  await tick()
  assert.deepEqual(h.commits, [], 'an old account cannot project into the new world')
  assert.deepEqual(h.statuses.at(-1)?.pendingKeys, [])
})

test('a local projection exception reconciles but cannot recast a server success as failure', async () => {
  const h = harness({ throwOnCommit: true })
  const result = h.controller.enqueue(op('one'))
  h.calls[0]!.resolve(graph(1))
  await tick()
  assert.equal(await result, 'applied')
  assert.equal(h.reconciled.length, 1)
  assert.equal(h.statuses.at(-1)?.error, null)
})
