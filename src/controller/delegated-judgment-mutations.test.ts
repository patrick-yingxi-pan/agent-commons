import test from 'node:test'
import assert from 'node:assert/strict'
import type { Contribution, DelegatedJudgmentRun } from '../../contract/index.ts'
import { refreshAccount } from '../api/account.ts'
import { peek, resetAll, setData } from '../api/cache.ts'
import { delegatedJudgmentId } from '../api/delegatedJudgmentIdentity.ts'
import { applyDelegatedJudgment } from '../api/delegatedJudgmentCommands.ts'
import { keys } from '../api/keys.ts'
import {
  createDelegatedJudgmentMutationFacade,
} from './delegatedJudgmentMutations.ts'

const tenantId = 'judgment-controller-tenant'
const projectId = 'judgment-controller-project'
const contributionId = 'judgment-controller-contribution'
const reviewer = {
  agentId: 'owner-agent',
  agentRevision: 3,
  providerId: 'configured-provider',
  providerRevision: 4,
  connectionRevision: 8,
}

function contribution(judgments: DelegatedJudgmentRun[] = []): Contribution {
  return {
    id: contributionId,
    projectId,
    title: 'Exact judgment test',
    summary: '',
    contributor: 'Contributor',
    openedAt: 1,
    events: [],
    status: 'open',
    changeset: [{ version: 2, at: 2, by: 'Contributor', entries: [] }],
    judgments,
  } as Contribution
}

function intent() {
  return {
    tenantId,
    projectId,
    contributionId,
    delegationId: 'delegation-exact',
    delegationLabel: 'Policy Agent',
    actKind: 'land' as const,
    mode: 'draft' as const,
    policy: 'Keep the change bounded.',
    escalation: ['effectful', 'stranger'] as ('effectful' | 'unreviewed' | 'stranger')[],
    judgment: {
      expectedDelegationRevision: 5,
      expectedChangesetVersion: 2,
      expectedEnvelopeVersion: null,
      reviewer: { ...reviewer },
    },
    reviewerLabel: 'Owner Agent',
    providerLabel: 'Configured endpoint',
    modelId: 'configured-model-id',
    modelLabel: 'Configured model',
    budgetLabel: 'Owner budget disclosure',
  }
}

test('delegated judgment posts the complete request and accepts only its exact pending receipt', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch; refreshAccount(null); resetAll() })
  refreshAccount({ userId: 'judgment-user', tenantId })
  resetAll()
  const projectKey = keys.contributions(projectId)
  const before = contribution()
  setData(projectKey, [before])
  let requestBody: unknown
  let idempotencyKey = ''
  let start!: () => void
  const started = new Promise<void>((resolve) => { start = resolve })
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    idempotencyKey = new Headers(init?.headers).get('Idempotency-Key') ?? ''
    start()
    const id = await delegatedJudgmentId(tenantId, projectId, contributionId, 'delegation-exact', idempotencyKey)
    const run: DelegatedJudgmentRun = {
      id,
      delegationId: 'delegation-exact',
      delegationRevision: 5,
      actKind: 'land',
      mode: 'draft',
      changesetVersion: 2,
      envelopeVersion: null,
      reviewer: 'Owner Agent',
      provider: 'Configured endpoint',
      model: 'configured-model-id',
      startedAt: 10,
      status: 'pending',
    }
    return new Response(JSON.stringify(contribution([run])), {
      headers: { 'content-type': 'application/json', 'x-resolved-tenant': tenantId },
    })
  }

  const selected = intent()
  const result = applyDelegatedJudgment({ ...selected, intentId: 'test-key' }, 'test-key')
  await started
  assert.deepEqual(requestBody, {
    judgment: {
      expectedDelegationRevision: 5,
      expectedChangesetVersion: 2,
      expectedEnvelopeVersion: null,
      reviewer,
    },
  })
  assert.equal(idempotencyKey, 'test-key')
  await result
  assert.deepEqual(peek<Contribution[]>(projectKey)?.[0]?.judgments?.map((run) => run.status), ['pending'])
  assert.equal(peek<Contribution[]>(projectKey)?.[0]?.status, 'open', 'the receipt does not invent a landing')
})

test('a delayed envelope-approval receipt cannot replace newer usage on an already-approved envelope', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch; refreshAccount(null); resetAll() })
  refreshAccount({ userId: 'judgment-envelope-user', tenantId })
  resetAll()
  const projectKey = keys.contributions(projectId)
  const current = contribution()
  current.envelope = {
    version: 7,
    status: 'approved',
    lines: [{ id: 'line-1', type: 'comment', target: 'release', cardinality: 4, harness: 'dry-run', note: '', used: 4 }],
    proposedBy: 'Contributor',
    proposedAt: 1,
    approvedBy: 'Owner',
    approvedAt: 2,
    approvedVersion: 7,
  }
  setData(projectKey, [current])

  const selected = intent()
  selected.actKind = 'approve-envelope'
  selected.judgment.expectedChangesetVersion = null
  selected.judgment.expectedEnvelopeVersion = 7
  const serverTruth = contribution([{
    id: await delegatedJudgmentId(tenantId, projectId, contributionId, 'delegation-exact', 'delayed-envelope-key'),
    delegationId: 'delegation-exact',
    delegationRevision: 5,
    actKind: 'approve-envelope',
    mode: 'draft',
    changesetVersion: null,
    envelopeVersion: 7,
    reviewer: 'Owner Agent',
    provider: 'Configured endpoint',
    model: 'configured-model-id',
    startedAt: 10,
    status: 'decided',
    decision: 'approve',
  }])
  serverTruth.envelope = {
    ...current.envelope!,
    lines: [{ ...current.envelope!.lines[0]!, used: 1 }],
  }
  globalThis.fetch = async () => new Response(JSON.stringify(serverTruth), {
    headers: { 'content-type': 'application/json', 'x-resolved-tenant': tenantId },
  })

  await applyDelegatedJudgment(selected, 'delayed-envelope-key')
  const retained = peek<Contribution[]>(projectKey)?.[0]?.envelope
  assert.equal(retained?.status, 'approved')
  assert.equal(retained?.lines[0]?.used, 4, 'current approved envelope usage wins over the older acknowledgement snapshot')
})

test('a lazy client-load failure retains the frozen judgment until explicit retry', async (t) => {
  let failLoad = true
  let loadCount = 0
  let dispatched: unknown
  const statuses: Array<{ error: string | null; retryable: boolean }> = []
  const fakeRuntime = {
    enqueueDelegatedJudgmentRuntime: async (value: unknown) => { dispatched = value; return 'applied' as const },
    retryDelegatedJudgmentRuntime: () => undefined,
    discardDelegatedJudgmentRuntime: () => undefined,
    clearDelegatedJudgments: () => undefined,
  }
  const facade = createDelegatedJudgmentMutationFacade({
    subscribeAccountSwitch: () => () => undefined,
    onStatus: (status) => statuses.push({ error: status.error, retryable: status.retryable }),
    loadRuntime: async () => {
      loadCount += 1
      if (failLoad) throw new Error('simulated chunk refusal')
      return fakeRuntime as unknown as typeof import('./delegatedJudgmentMutationRuntime.ts')
    },
  })
  t.after(facade.dispose)

  const selected = intent()
  const result = facade.enqueue(selected)
  await new Promise((resolve) => setImmediate(resolve))
  const held = facade.heldIntent(projectId, contributionId)
  assert.ok(held)
  assert.equal(facade.isHeld(projectId, contributionId), true)
  assert.equal(statuses.at(-1)?.retryable, true)
  assert.match(statuses.at(-1)?.error ?? '', /No provider request was sent/)
  selected.judgment.reviewer.connectionRevision = 99
  assert.equal(held.judgment.reviewer.connectionRevision, 8)

  failLoad = false
  facade.retry()
  assert.equal(await result, 'applied')
  assert.equal(loadCount, 2)
  assert.equal((dispatched as { judgment: { reviewer: { connectionRevision: number } } }).judgment.reviewer.connectionRevision, 8)
  assert.equal(facade.heldIntent(projectId, contributionId), null)
})

async function verifyQueuedJudgmentAfterFirstLoadFailure(recovery: 'retry' | 'dismiss'): Promise<void> {
  let failLoad = true
  let loadCount = 0
  const dispatched: Array<{ contributionId: string; delegationId: string; judgment: { expectedDelegationRevision: number; reviewer: { connectionRevision: number } } }> = []
  const fakeRuntime = {
    enqueueDelegatedJudgmentRuntime: async (value: ReturnType<typeof intent> & { intentId: string }) => {
      dispatched.push(value)
      return 'applied' as const
    },
    retryDelegatedJudgmentRuntime: () => undefined,
    discardDelegatedJudgmentRuntime: () => undefined,
    clearDelegatedJudgments: () => undefined,
  }
  const facade = createDelegatedJudgmentMutationFacade({
    subscribeAccountSwitch: () => () => undefined,
    loadRuntime: async () => {
      loadCount += 1
      if (failLoad) throw new Error('simulated chunk refusal')
      return fakeRuntime as unknown as typeof import('./delegatedJudgmentMutationRuntime.ts')
    },
  })
  try {
    const first = facade.enqueue(intent())
    await new Promise((resolve) => setImmediate(resolve))
    const secondRequest = intent()
    secondRequest.contributionId = 'second-contribution'
    secondRequest.delegationId = 'second-delegation'
    secondRequest.judgment.expectedDelegationRevision = 9
    secondRequest.judgment.reviewer.connectionRevision = 22
    const second = facade.enqueue(secondRequest)
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(loadCount, 1, 'the first untrusted runtime failure blocks but does not drop later intents')
    assert.equal(facade.isHeld(projectId, contributionId), true)
    assert.equal(facade.isHeld(projectId, 'second-contribution'), true)

    failLoad = false
    if (recovery === 'retry') {
      facade.retry()
      assert.deepEqual(await Promise.all([first, second]), ['applied', 'applied'])
      assert.equal(dispatched.length, 2)
      assert.deepEqual(dispatched.map(({ contributionId, delegationId }) => [contributionId, delegationId]), [
        [contributionId, 'delegation-exact'],
        ['second-contribution', 'second-delegation'],
      ])
      assert.deepEqual(dispatched.map(({ judgment }) => [judgment.expectedDelegationRevision, judgment.reviewer.connectionRevision]), [
        [5, 8],
        [9, 22],
      ], 'later requests retain their own frozen revisions and reviewer binding')
    } else {
      facade.discard()
      assert.equal(await first, 'discarded')
      assert.equal(await second, 'applied')
      assert.deepEqual(dispatched.map(({ contributionId, delegationId, judgment }) => [contributionId, delegationId, judgment.expectedDelegationRevision, judgment.reviewer.connectionRevision]), [
        ['second-contribution', 'second-delegation', 9, 22],
      ], 'dismissing the failed first intent advances the queue without substituting its payload')
    }
    assert.equal(loadCount, 2)
    assert.equal(facade.isHeld(projectId, contributionId), false)
    assert.equal(facade.isHeld(projectId, 'second-contribution'), false)
  } finally {
    facade.dispose()
  }
}

test('retrying a failed runtime load drains later exact judgment intents in FIFO order', async () => {
  await verifyQueuedJudgmentAfterFirstLoadFailure('retry')
})

test('dismissing a failed runtime load advances to the next exact judgment intent', async () => {
  await verifyQueuedJudgmentAfterFirstLoadFailure('dismiss')
})
