import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  emptyGraph,
  type CreateProjectRequest,
  type Project,
  type RelationGraph,
  type RelationOp,
} from '../../contract/index.ts'
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

interface ProjectCall {
  input: CreateProjectRequest
  idempotencyKey: string
  resolve: (project: Project) => void
  reject: (error: unknown) => void
}

const op = (id: string): RelationOp => ({
  kind: 'create-project',
  projectId: id,
  projectName: id,
  projectDescription: '',
})
const graph = (revision: number): RelationGraph => ({ ...emptyGraph(), revision })
const project = (name: string): Project => ({
  id: `p-${name}`,
  name,
  description: '',
  updatedAt: 1,
  instructions: '',
  scheduled: [],
  contexts: [],
  sessionIds: [],
})
const tick = () => new Promise<void>((resolve) => setImmediate(resolve))

function harness(options: {
  throwOnCommit?: boolean
  reconcile?: (relation: RelationOp) => Promise<unknown> | void
} = {}) {
  const calls: Call[] = []
  const commits: Array<{ op: RelationOp; graph: RelationGraph }> = []
  const reconciled: RelationOp[] = []
  const projectCalls: ProjectCall[] = []
  const reconciledProjects: CreateProjectRequest[] = []
  const statuses: RelationMutationStatus[] = []
  let seq = 0
  const controller = createRelationMutationController({
    mutate: (relation, idempotencyKey) =>
      new Promise<RelationGraph>((resolve, reject) => calls.push({ op: relation, idempotencyKey, resolve, reject })),
    commit: (relation, returned) => {
      if (options.throwOnCommit) throw new Error('projection failed')
      commits.push({ op: relation, graph: returned })
    },
    reconcile: (relation) => {
      reconciled.push(relation)
      return options.reconcile?.(relation)
    },
    rebase: async (relation) => relation,
    describeFailure: () => ({ message: 'Couldn’t confirm.', retryable: true }),
    createProject: (input, idempotencyKey) =>
      new Promise<Project>((resolve, reject) => projectCalls.push({ input, idempotencyKey, resolve, reject })),
    reconcileProject: (input) => reconciledProjects.push(input),
    describeProjectFailure: () => ({ message: 'Project still held.', retryable: true }),
    setStatus: (status) => statuses.push(status),
    mintIdempotencyKey: () => `idem-${(seq += 1)}`,
  })
  return { controller, calls, commits, reconciled, projectCalls, reconciledProjects, statuses }
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
  assert.deepEqual(h.calls[1]!.op, h.calls[0]!.op, 'transport retry keeps the exact precondition too')
  h.calls[1]!.resolve(graph(1))
  await tick()
  assert.equal(await first, 'applied')
  assert.equal(h.calls.length, 3, 'the queued edit follows the recovered head')
  h.calls[2]!.resolve(graph(2))
  await tick()
  assert.equal(await second, 'applied')
})

test('a Project prose conflict rebases only its precondition and keeps desired text plus logical key', async () => {
  const calls: Call[] = []
  const statuses: RelationMutationStatus[] = []
  const rebased: RelationOp[] = []
  const controller = createRelationMutationController({
    mutate: (relation, idempotencyKey) =>
      new Promise<RelationGraph>((resolve, reject) => calls.push({ op: relation, idempotencyKey, resolve, reject })),
    commit: () => {},
    reconcile: async () => {},
    rebase: async (relation) => {
      const next = relation.kind === 'set-project-description'
        ? { ...relation, expectedDescription: 'Remote text' }
        : relation
      rebased.push(next)
      return next
    },
    describeFailure: () => ({ message: 'Project changed.', retryable: true, rebase: true }),
    createProject: async () => project('unused'),
    reconcileProject: async () => {},
    describeProjectFailure: () => ({ message: 'unused', retryable: false }),
    setStatus: (status) => statuses.push(status),
    mintIdempotencyKey: () => 'idem-project-prose',
  })
  const held: RelationOp = {
    kind: 'set-project-description',
    projectId: 'p-live',
    projectName: 'Live',
    description: 'My held draft',
    expectedDescription: 'Opening text',
  }
  const result = controller.enqueue(held)
  calls[0]!.reject(new Error('409'))
  await tick()
  assert.equal(statuses.at(-1)?.error, 'Project changed.')
  assert.equal(rebased.length, 1, 'authoritative text is loaded before Retry is offered')

  controller.retry()
  assert.equal(calls.length, 2)
  assert.equal(calls[1]!.idempotencyKey, calls[0]!.idempotencyKey)
  assert.deepEqual(calls[1]!.op, {
    ...held,
    expectedDescription: 'Remote text',
  })
  calls[1]!.resolve(graph(2))
  await tick()
  assert.equal(await result, 'applied')
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

test('Dismiss waits for authoritative reconciliation before settling or releasing later intent', async () => {
  let release!: () => void
  const reconciliation = new Promise<void>((resolve) => { release = resolve })
  const h = harness({ reconcile: () => reconciliation })
  const first = h.controller.enqueue(op('one'))
  const second = h.controller.enqueue(op('two'))
  h.calls[0]!.reject(new Error('offline'))
  await tick()

  let settled = false
  void first.then(() => { settled = true })
  h.controller.discard()
  await tick()
  assert.equal(settled, false, 'dismissed outcome waits for the authoritative read')
  assert.equal(h.calls.length, 1, 'later intent cannot plan against stale graph state')

  release()
  await tick()
  assert.equal(await first, 'discarded')
  assert.equal(h.calls.length, 2)
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

test('Project creation retries the exact intent and logical key, then returns only server identity', async () => {
  const h = harness()
  const input = { name: 'Same intent', description: 'One held request' }
  const result = h.controller.enqueueProject(input)
  const key = h.projectCalls[0]!.idempotencyKey

  h.projectCalls[0]!.reject(new Error('offline'))
  await tick()
  assert.equal(h.statuses.at(-1)?.error, 'Project still held.')
  assert.match(h.statuses.at(-1)?.failedKey ?? '', /^direct-project:/)

  h.controller.retry()
  assert.equal(h.projectCalls[1]!.idempotencyKey, key)
  assert.deepEqual(h.projectCalls.map((call) => call.input), [input, input])
  h.projectCalls[1]!.resolve(project('Same intent'))
  await tick()

  assert.deepEqual(await result, { kind: 'created', resource: project('Same intent') })
  assert.deepEqual(h.statuses.at(-1)?.pendingKeys, [])
})

test('dismissing uncertain Project creation reconciles it before later relation intent proceeds', async () => {
  const h = harness()
  const input = { name: 'one' }
  const first = h.controller.enqueueProject(input)
  const second = h.controller.enqueue(op('two'))

  assert.equal(h.calls.length, 0, 'mixed intent cannot jump the active Project creation')
  h.projectCalls[0]!.reject(new Error('uncertain'))
  await tick()
  h.controller.discard()

  assert.deepEqual(await first, { kind: 'discarded' })
  assert.deepEqual(h.reconciledProjects, [input])
  assert.equal(h.calls.length, 1, 'later relation intent begins only after explicit dismissal')
  h.calls[0]!.resolve(graph(1))
  await tick()
  assert.equal(await second, 'applied')
})
