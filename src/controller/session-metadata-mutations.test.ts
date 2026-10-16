import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ApiRequestError } from '../api/client.ts'
import type { Session, SessionMetadataPatch } from '../../contract/index.ts'
import {
  createRevisionedMutationController,
  type RevisionedMutationStatus,
} from './revisionedMutationCore.ts'

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
  const statuses: RevisionedMutationStatus[] = []
  let seq = 0
  const controller = createRevisionedMutationController<Session, SessionMetadataPatch>({
    snapshot: (id) => records.get(id),
    reconcile: async (id) => {
      reconciles.push(id)
      const current = records.get(id)
      if (!current) throw new Error('gone')
      return current
    },
    revision: (current) => current.metadataRevision ?? 0,
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

test('a form may pin its opening revision while explicit Retry rebases it', async () => {
  const h = harness()
  h.records.set('s1', session('s1', 4, 'Updated while the form stayed open'))
  const outcome = h.controller.enqueue('s1', { title: 'My reviewed draft' }, 0)
  const key = h.calls[0]!.idempotencyKey
  assert.equal(h.calls[0]!.expectedRevision, 0, 'the first attempt uses the version the person actually reviewed')

  h.calls[0]!.reject(new Error('changed elsewhere'))
  await tick()
  h.controller.retry()
  assert.equal(h.calls[1]!.expectedRevision, 4, 'Retry alone rebases on reconciled truth')
  assert.equal(h.calls[1]!.idempotencyKey, key, 'rebasing does not mint a second logical act')

  h.calls[1]!.resolve(session('s1', 5, 'My reviewed draft'))
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
  await tick()
  assert.equal(h.calls.length, 2, 'later intent waits for explicit dismissal')
  h.calls[1]!.resolve(session('s1', 1))
  await tick()
  assert.equal(await second, 'applied')
  assert.ok(h.reconciles.length >= 2, 'failure and dismissal both distrust uncertain local state')
})

test('Dismiss does not release later intent until its reconciliation settles', async () => {
  let record = session('s1', 0)
  let reconcileCount = 0
  let releaseDismissReconcile!: (value: Session) => void
  const calls: Call[] = []
  const controller = createRevisionedMutationController<Session, SessionMetadataPatch>({
    snapshot: () => record,
    reconcile: async () => {
      reconcileCount += 1
      if (reconcileCount === 1) return record // the failure-path reconciliation
      return new Promise<Session>((resolve) => {
        releaseDismissReconcile = resolve
      })
    },
    revision: (current) => current.metadataRevision ?? 0,
    mutate: (sessionId, patch, expectedRevision, idempotencyKey) =>
      new Promise<Session>((resolve, reject) => {
        calls.push({ sessionId, patch, expectedRevision, idempotencyKey, resolve, reject })
      }),
    describeFailure: () => ({ message: 'offline', retryable: true }),
    setStatus: () => {},
    mintIdempotencyKey: () => crypto.randomUUID(),
  })

  const first = controller.enqueue('s1', { title: 'One' })
  const second = controller.enqueue('s1', { pinned: true })
  calls[0]!.reject(new Error('offline'))
  await tick()
  controller.discard()
  assert.equal(await first, 'discarded')
  assert.equal(calls.length, 1, 'the next mutation remains held while truth is uncertain')

  record = session('s1', 3, 'Server truth')
  releaseDismissReconcile(record)
  await tick()
  assert.equal(calls.length, 2)
  assert.equal(calls[1]!.expectedRevision, 3, 'the released intent pins reconciled truth')
  calls[1]!.resolve(session('s1', 4, 'Server truth'))
  await tick()
  assert.equal(await second, 'applied')
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

test('isPending filters exact resource and matching patches across the whole held queue', async () => {
  const h = harness()
  const title = h.controller.enqueue('s1', { title: 'Rename' })
  const unrelated = h.controller.enqueue('s1', { pinned: true })
  const otherResource = h.controller.enqueue('s2', { agentId: 'agent-a' })

  assert.equal(h.controller.isPending('s1'), true)
  assert.equal(h.controller.isPending('s1', (patch) => 'agentId' in patch), false)
  assert.equal(h.controller.isPending('s1', (patch) => 'pinned' in patch), true,
    'a queued non-head mutation is still pending')
  assert.equal(h.controller.isPending('s2', (patch) => patch.agentId === 'agent-a'), true)
  assert.equal(h.controller.isPending('s1', (patch) => patch.title === 'Rename'), true)

  h.calls[0]!.resolve(session('s1', 1, 'Rename'))
  await tick()
  h.calls[1]!.resolve({ ...session('s1', 2, 'Rename'), pinned: true })
  await tick()
  h.controller.clearAll()
  assert.deepEqual(await Promise.all([title, unrelated, otherResource]), ['applied', 'applied', 'discarded'])
  assert.equal(h.controller.isPending('s1'), false)
})

test('isPending includes failed and retrying entries until acknowledgement', async () => {
  const h = harness()
  const outcome = h.controller.enqueue('s1', { agentId: 'agent-a' })
  const matches = (patch: Readonly<SessionMetadataPatch>) => patch.agentId === 'agent-a'
  assert.equal(h.controller.isPending('s1', matches), true)

  h.calls[0]!.reject(new Error('offline'))
  await tick()
  assert.equal(h.controller.isPending('s1', matches), true, 'failed intent remains held')
  h.controller.retry()
  assert.equal(h.controller.isPending('s1', matches), true, 'retrying intent remains held')
  h.calls[1]!.resolve(session('s1', 1))
  await tick()
  assert.equal(await outcome, 'applied')
  assert.equal(h.controller.isPending('s1', matches), false)
})

test('isPending retains a dismissed entry through authoritative reconciliation and clearAll fences late settlement', async () => {
  let reconcileCount = 0
  let releaseDismissReconcile!: (value: Session) => void
  const calls: Call[] = []
  const controller = createRevisionedMutationController<Session, SessionMetadataPatch>({
    snapshot: () => session('s1', 0),
    reconcile: async () => {
      reconcileCount += 1
      if (reconcileCount === 1) return session('s1', 0)
      return new Promise<Session>((resolve) => { releaseDismissReconcile = resolve })
    },
    revision: (current) => current.metadataRevision ?? 0,
    mutate: (sessionId, patch, expectedRevision, idempotencyKey) => new Promise<Session>((resolve, reject) => {
      calls.push({ sessionId, patch, expectedRevision, idempotencyKey, resolve, reject })
    }),
    describeFailure: () => ({ message: 'offline', retryable: true }),
    setStatus: () => {},
    mintIdempotencyKey: () => crypto.randomUUID(),
  })
  const matches = (patch: Readonly<SessionMetadataPatch>) => patch.agentId === 'agent-a'
  const dismissed = controller.enqueue('s1', { agentId: 'agent-a' })
  const queuedBinding = controller.enqueue('s1', { agentId: 'agent-b' })
  calls[0]!.reject(new Error('offline'))
  await tick()
  controller.discard()
  assert.equal(await dismissed, 'discarded')
  assert.equal(controller.isPending('s1', matches), true,
    'dismissal stays held while authoritative reconciliation is unresolved')
  assert.equal(controller.isPending('s1', (patch) => patch.agentId === 'agent-b'), true,
    'later queued intent remains visible too')

  controller.clearAll()
  assert.equal(await queuedBinding, 'discarded')
  assert.equal(controller.isPending('s1'), false)
  releaseDismissReconcile(session('s1', 8))
  await tick()
  assert.equal(controller.isPending('s1'), false, 'late reconciliation cannot restore cleared intent')
})

test('isPending releases a dismissed entry when authoritative reconciliation settles', async () => {
  let reconcileCount = 0
  let releaseDismissReconcile!: (value: Session) => void
  const calls: Call[] = []
  const controller = createRevisionedMutationController<Session, SessionMetadataPatch>({
    snapshot: () => session('s1', 0),
    reconcile: async () => {
      reconcileCount += 1
      return reconcileCount === 1
        ? session('s1', 0)
        : new Promise<Session>((resolve) => { releaseDismissReconcile = resolve })
    },
    revision: (current) => current.metadataRevision ?? 0,
    mutate: (sessionId, patch, expectedRevision, idempotencyKey) => new Promise<Session>((resolve, reject) => {
      calls.push({ sessionId, patch, expectedRevision, idempotencyKey, resolve, reject })
    }),
    describeFailure: () => ({ message: 'offline', retryable: true }),
    setStatus: () => {},
    mintIdempotencyKey: () => crypto.randomUUID(),
  })
  const outcome = controller.enqueue('s1', { agentId: 'agent-a' })
  calls[0]!.reject(new Error('offline'))
  await tick()
  controller.discard()
  assert.equal(await outcome, 'discarded')
  assert.equal(controller.isPending('s1'), true)
  releaseDismissReconcile(session('s1', 3))
  await tick()
  assert.equal(controller.isPending('s1'), false)
})

test('binding Dismiss keeps uncertain intent held across failed reads; a later Dismiss heals without replay', async () => {
  let reconcileCount = 0
  let resolveDismissRead!: (value: Session) => void
  const calls: Call[] = []
  const records = new Map<string, Session>([['s1', session('s1', 0)]])
  const statuses: RevisionedMutationStatus[] = []
  const controller = createRevisionedMutationController<Session, SessionMetadataPatch>({
    snapshot: (id) => records.get(id),
    reconcile: async () => {
      reconcileCount += 1
      if (reconcileCount <= 2) throw new Error(`read-${reconcileCount}-failed`)
      return new Promise<Session>((resolve) => { resolveDismissRead = resolve })
    },
    revision: (current) => current.metadataRevision ?? 0,
    mutate: (sessionId, patch, expectedRevision, idempotencyKey) => new Promise<Session>((resolve, reject) => {
      calls.push({ sessionId, patch, expectedRevision, idempotencyKey, resolve, reject })
    }),
    describeFailure: (error) => ({ message: error instanceof Error ? error.message : 'failed', retryable: true }),
    retainOnDismissReadFailure: (patch, error) =>
      ('agentId' in patch) && !(error instanceof Error && error.message === 'authoritatively-absent'),
    setStatus: (status) => statuses.push(status),
    mintIdempotencyKey: () => `session-metadata-${calls.length + 1}`,
  })

  let bindingOutcome: 'applied' | 'discarded' | undefined
  const binding = controller.enqueue('s1', { agentId: 'agent-custom' })
  void binding.then((outcome) => { bindingOutcome = outcome })
  const laterTitle = controller.enqueue('s1', { title: 'Later unrelated edit' })

  // Simulate an acknowledgement loss after the server committed the Agent.
  records.set('s1', { ...session('s1', 1), agentId: 'agent-custom' })
  calls[0]!.reject(new Error('lost-ack'))
  await tick()
  assert.equal(reconcileCount, 1, 'the mutation failure path attempted its authoritative refresh')
  assert.equal(statuses.at(-1)?.error, 'lost-ack')

  controller.discard()
  await tick()
  assert.equal(reconcileCount, 2, 'Dismiss performs a new authoritative read')
  assert.equal(bindingOutcome, undefined, 'failed Dismiss read must not settle the binding as discarded')
  assert.equal(controller.isPending('s1', (patch) => 'agentId' in patch), true)
  assert.equal(statuses.at(-1)?.error, 'Couldn’t read saved changes. Dismiss again to recheck without resending.')
  assert.equal(statuses.at(-1)?.retryable, false, 'Retry must not replay the uncertain binding mutation')
  assert.equal(calls.length, 1, 'neither the binding nor later edit may be replayed/drained')

  controller.discard()
  assert.equal(reconcileCount, 3, 'the next Dismiss retries only the truth read')
  assert.equal(bindingOutcome, undefined)
  assert.equal(calls.length, 1)
  resolveDismissRead(records.get('s1')!)
  await tick()
  assert.equal(await binding, 'discarded')
  assert.equal(controller.isPending('s1', (patch) => 'agentId' in patch), false)
  assert.equal(calls.length, 2, 'only after truth is known may the unrelated queued edit start')
  assert.equal(calls[1]!.patch.title, 'Later unrelated edit')

  calls[1]!.resolve({ ...records.get('s1')!, metadataRevision: 2, title: 'Later unrelated edit' })
  await tick()
  assert.equal(await laterTitle, 'applied')
})

test('clearAll fences a binding Dismiss reconciliation that settles late', async () => {
  let reconcileCount = 0
  let finishDismissRead!: (value: Session) => void
  const calls: Call[] = []
  const statuses: RevisionedMutationStatus[] = []
  const controller = createRevisionedMutationController<Session, SessionMetadataPatch>({
    snapshot: () => session('s1', 0),
    reconcile: async () => {
      reconcileCount += 1
      if (reconcileCount === 1) throw new Error('failure refresh unavailable')
      return new Promise<Session>((resolve) => { finishDismissRead = resolve })
    },
    revision: (current) => current.metadataRevision ?? 0,
    mutate: (sessionId, patch, expectedRevision, idempotencyKey) => new Promise<Session>((resolve, reject) => {
      calls.push({ sessionId, patch, expectedRevision, idempotencyKey, resolve, reject })
    }),
    describeFailure: () => ({ message: 'read unavailable', retryable: true }),
    retainOnDismissReadFailure: (patch) => 'agentId' in patch,
    setStatus: (status) => statuses.push(status),
    mintIdempotencyKey: () => crypto.randomUUID(),
  })
  let bindingOutcome: 'applied' | 'discarded' | undefined
  const binding = controller.enqueue('s1', { agentId: 'agent-custom' })
  void binding.then((outcome) => { bindingOutcome = outcome })
  const queued = controller.enqueue('s1', { agentId: 'agent-next' })
  calls[0]!.reject(new Error('lost-ack'))
  await tick()
  controller.discard()
  assert.equal(bindingOutcome, undefined)
  assert.equal(reconcileCount, 2)

  controller.clearAll()
  assert.deepEqual(await Promise.all([binding, queued]), ['discarded', 'discarded'])
  assert.equal(controller.isPending('s1'), false)
  finishDismissRead(session('s1', 4))
  await tick()
  assert.equal(bindingOutcome, 'discarded')
  assert.equal(statuses.at(-1)?.pendingCount, 0)
  assert.equal(calls.length, 1, 'late reconciliation cannot drain abandoned binding work')
})

test('session binding Dismiss treats only an authoritative 404 as safe absence', async () => {
  const source = readFileSync(new URL('./sessionMetadataMutations.ts', import.meta.url), 'utf8')
  assert.match(source,
    /retainOnDismissReadFailure:\s*\(patch, error\)\s*=>\s*isConversationBindingPatch\(patch\)\s*&&\s*!\(error instanceof ApiRequestError && error\.status === 404\)/,
    'only real binding patches opt into the hold, and only an API 404 makes the read an authoritative absence')

  let reconcileCount = 0
  const calls: Call[] = []
  const records = new Map<string, Session>([['s1', session('s1', 0)]])
  const controller = createRevisionedMutationController<Session, SessionMetadataPatch>({
    snapshot: (id) => records.get(id),
    reconcile: async () => {
      reconcileCount += 1
      if (reconcileCount === 1) return records.get('s1')!
      throw new ApiRequestError('not_found', 'Conversation no longer exists.', 404)
    },
    revision: (current) => current.metadataRevision ?? 0,
    mutate: (sessionId, patch, expectedRevision, idempotencyKey) => new Promise<Session>((resolve, reject) => {
      calls.push({ sessionId, patch, expectedRevision, idempotencyKey, resolve, reject })
    }),
    describeFailure: () => ({ message: 'offline', retryable: true }),
    retainOnDismissReadFailure: (patch, error) => 'agentId' in patch &&
      !(error instanceof ApiRequestError && error.status === 404),
    setStatus: () => {},
    mintIdempotencyKey: () => crypto.randomUUID(),
  })

  const binding = controller.enqueue('s1', { agentId: 'agent-custom' })
  const laterTitle = controller.enqueue('s1', { title: 'After confirmed absence' })
  calls[0]!.reject(new Error('lost acknowledgement'))
  await tick()
  controller.discard()
  await tick()
  assert.equal(reconcileCount, 2)
  assert.equal(await binding, 'discarded')
  assert.equal(controller.isPending('s1', (patch) => 'agentId' in patch), false)
  assert.equal(calls.length, 2, 'a confirmed missing Conversation safely releases later work without replay')
  calls[1]!.resolve(session('s1', 1, 'After confirmed absence'))
  await tick()
  assert.equal(await laterTitle, 'applied')
})

test('legacy Dismiss still settles on failed best-effort reconciliation and drains the FIFO', async () => {
  let reconcileCount = 0
  const calls: Call[] = []
  const controller = createRevisionedMutationController<Session, SessionMetadataPatch>({
    snapshot: () => session('s1', 0),
    reconcile: async () => {
      reconcileCount += 1
      throw new Error(`offline read ${reconcileCount}`)
    },
    revision: (current) => current.metadataRevision ?? 0,
    mutate: (sessionId, patch, expectedRevision, idempotencyKey) => new Promise<Session>((resolve, reject) => {
      calls.push({ sessionId, patch, expectedRevision, idempotencyKey, resolve, reject })
    }),
    describeFailure: (error) => ({ message: error instanceof Error ? error.message : 'failed', retryable: true }),
    setStatus: () => {},
    mintIdempotencyKey: () => crypto.randomUUID(),
  })

  const first = controller.enqueue('s1', { title: 'Legacy title' })
  const second = controller.enqueue('s1', { pinned: true })
  calls[0]!.reject(new Error('mutation unavailable'))
  await tick()
  assert.equal(reconcileCount, 1, 'the failure path performs its normal best-effort refresh')
  controller.discard()
  assert.equal(await first, 'discarded', 'legacy dismissal preserves immediate outcome semantics')
  await tick()
  assert.equal(reconcileCount, 2, 'Dismiss still attempts its authoritative read')
  assert.equal(calls.length, 2, 'failed legacy Dismiss reconciliation releases the following intent')
  calls[1]!.resolve(session('s1', 1))
  await tick()
  assert.equal(await second, 'applied')
})
