import test from 'node:test'
import assert from 'node:assert/strict'
import type { Contribution, ContributionReviewRun } from '../../contract/index.ts'
import { refreshAccount } from '../api/account.ts'
import { peek, resetAll, setData } from '../api/cache.ts'
import { contributionReviewId } from '../api/contributionReviewIdentity.ts'
import { keys } from '../api/keys.ts'
import {
  createContributionReviewMutationFacade,
  enqueueContributionReview,
  heldContributionReviewIntent,
} from './contributionReviewMutations.ts'

const tenantId = 'review-controller-tenant'
const projectId = 'review-controller-project'
const contributionId = 'review-controller-contribution'

function row(reviews: ContributionReviewRun[] = []): Contribution {
  return {
    id: contributionId,
    projectId,
    title: 'Controller test contribution',
    summary: '',
    contributor: 'Contributor',
    openedAt: 1,
    events: [],
    status: 'open',
    changeset: [{ version: 1, at: 1, by: 'Contributor', entries: [] }],
    reviews,
  } as Contribution
}

test('same Contribution coalesces one frozen reviewer action and account switch fences its late response', async (t) => {
  const originalFetch = globalThis.fetch
  const projectKey = keys.contributions(projectId)
  t.after(() => { globalThis.fetch = originalFetch; refreshAccount(null); resetAll() })
  refreshAccount({ userId: 'review-controller-user', tenantId })
  resetAll()
  const before = row()
  setData(projectKey, [before])
  let start!: () => void
  const started = new Promise<void>((resolve) => { start = resolve })
  let finish!: (response: Response) => void
  const response = new Promise<Response>((resolve) => { finish = resolve })
  let requestBody: unknown
  let requestKey = ''
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    requestKey = new Headers(init?.headers).get('Idempotency-Key') ?? ''
    start()
    return response
  }

  const binding = {
    agentId: 'selected-agent',
    agentRevision: 5,
    providerId: 'selected-provider',
    providerRevision: 7,
    connectionRevision: 11,
  }
  const first = enqueueContributionReview({
    tenantId,
    projectId,
    contributionId,
    expectedVersion: 1,
    reviewer: binding,
    reviewerLabel: 'Selected reviewer',
    providerLabel: 'Selected provider',
    modelLabel: 'Selected model',
    budgetLabel: 'Owner budget disclosure',
  })
  await started
  const held = heldContributionReviewIntent(projectId, contributionId)
  assert.ok(held)
  binding.agentRevision = 99
  const coalesced = enqueueContributionReview({
    tenantId,
    projectId,
    contributionId,
    expectedVersion: 1,
    reviewer: binding,
    reviewerLabel: 'Changed label',
    providerLabel: 'Changed provider',
    modelLabel: 'Changed model',
    budgetLabel: 'Changed budget',
  })
  assert.strictEqual(coalesced, first)
  assert.deepEqual(requestBody, {
    expectedVersion: 1,
    reviewer: {
      agentId: 'selected-agent',
      agentRevision: 5,
      providerId: 'selected-provider',
      providerRevision: 7,
      connectionRevision: 11,
    },
  })
  assert.equal(requestKey, held.intentId)

  refreshAccount({ userId: 'other-user', tenantId: 'other-tenant' })
  assert.equal(heldContributionReviewIntent(projectId, contributionId), null)
  assert.equal(await first, 'discarded')
  const id = await contributionReviewId(tenantId, projectId, contributionId, requestKey)
  const terminal: ContributionReviewRun = {
    id,
    version: 1,
    reviewer: 'Selected reviewer',
    provider: 'Selected provider',
    model: 'Selected model',
    startedAt: 10,
    finishedAt: 20,
    status: 'passed',
    summary: 'No findings.',
    findings: [],
  }
  finish(new Response(JSON.stringify(row([terminal])), {
    headers: { 'content-type': 'application/json', 'x-resolved-tenant': tenantId },
  }))
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(peek<Contribution[]>(projectKey), [before],
    'a response from the previous account cannot publish its review receipt')
})

test('a failed runtime load retains one frozen review and Retry admits it without a second key', async (t) => {
  let failLoad = true
  let loadCount = 0
  let runtimeDispatches = 0
  let loadedIntent: unknown
  const statuses: Array<{ error: string | null; retryable: boolean }> = []
  const fakeRuntime = {
    enqueueContributionReviewRuntime: async (intent: unknown) => {
      runtimeDispatches += 1
      loadedIntent = intent
      return 'applied' as const
    },
    retryContributionReviewRuntime: () => undefined,
    discardContributionReviewRuntime: () => undefined,
    clearContributionReviews: () => undefined,
  }
  const facade = createContributionReviewMutationFacade({
    subscribeAccountSwitch: () => () => undefined,
    onStatus: (status) => statuses.push({ error: status.error, retryable: status.retryable }),
    loadRuntime: async () => {
      loadCount += 1
      if (failLoad) throw new Error('simulated chunk refusal')
      return fakeRuntime as unknown as typeof import('./contributionReviewMutationRuntime.ts')
    },
  })
  t.after(facade.dispose)

  const action = facade.enqueue({
    tenantId,
    projectId,
    contributionId,
    expectedVersion: 1,
    reviewer: { ...reviewerForTest },
    reviewerLabel: 'Frozen reviewer',
    providerLabel: 'Frozen endpoint',
    modelLabel: 'Frozen model',
    budgetLabel: 'Owner budget disclosure',
  })
  await new Promise((resolve) => setImmediate(resolve))
  const held = facade.heldIntent(projectId, contributionId)
  assert.ok(held)
  assert.equal(facade.isHeld(projectId, contributionId), true)
  assert.equal(runtimeDispatches, 0)
  assert.equal(statuses.at(-1)?.retryable, true)
  assert.match(statuses.at(-1)?.error ?? '', /No request was sent/)

  failLoad = false
  facade.retry()
  assert.equal(await action, 'applied')
  assert.equal(loadCount, 2)
  assert.equal(runtimeDispatches, 1)
  assert.equal(loadedIntent && (loadedIntent as { intentId: string }).intentId, held.intentId)
  assert.deepEqual((loadedIntent as { reviewer: unknown }).reviewer, held.reviewer)
  assert.equal(facade.heldIntent(projectId, contributionId), null)
})

const reviewerForTest = {
  agentId: 'selected-agent',
  agentRevision: 5,
  providerId: 'selected-provider',
  providerRevision: 7,
  connectionRevision: 11,
}
