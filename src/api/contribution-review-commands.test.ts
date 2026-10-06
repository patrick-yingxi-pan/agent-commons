import test from 'node:test'
import assert from 'node:assert/strict'
import type { Contribution, ContributionReviewRun } from '../../contract/index.ts'
import { refreshAccount } from './account.ts'
import { peek, resetAll, setData } from './cache.ts'
import { applyContributionReview, reconcileContributionReview, type ContributionReviewIntent } from './contributionReviewCommands.ts'
import { contributionReviewId } from './contributionReviewIdentity.ts'
import { keys } from './keys.ts'

const tenantId = 'review-tenant'
const projectId = 'review-project'
const contributionId = 'review-contribution'
const key = 'stable-review-key'
const reviewer = {
  agentId: 'owner-reviewer',
  agentRevision: 5,
  providerId: 'configured-endpoint',
  providerRevision: 7,
  connectionRevision: 11,
}
const intent: ContributionReviewIntent = {
  intentId: key,
  tenantId,
  projectId,
  contributionId,
  expectedVersion: 3,
  reviewer,
  reviewerLabel: 'Reviewer',
  providerLabel: 'Endpoint',
  modelLabel: 'Model One',
  budgetLabel: 'Reviewer token budget: 100 / day.',
}

function baseContribution(reviews: ContributionReviewRun[] = []): Contribution {
  return {
    id: contributionId,
    projectId,
    title: 'Review the proposal',
    summary: '',
    contributor: 'Contributor',
    openedAt: 1,
    events: [],
    status: 'open',
    reviews,
    changeset: [1, 2, 3].map((version) => ({ version, at: version, by: 'Contributor', entries: [] })),
  } as Contribution
}

function run(id: string, status: ContributionReviewRun['status'], version = 3): ContributionReviewRun {
  return {
    id,
    version,
    reviewer: 'Reviewer',
    provider: 'Endpoint',
    model: 'Model One',
    startedAt: 12,
    ...(status === 'pending' ? {} : { finishedAt: 20 }),
    status,
    ...(status === 'uncertain' ? { summary: 'The outcome could not be confirmed.' } : {}),
  }
}

const response = (body: unknown) => new Response(JSON.stringify(body), {
  headers: { 'content-type': 'application/json', 'x-resolved-tenant': tenantId },
})

test('review POST freezes exact version and binding under one stable key; pending receipt is accepted', async (t) => {
  const originalFetch = globalThis.fetch
  const projectKey = keys.contributions(projectId)
  t.after(() => { globalThis.fetch = originalFetch; refreshAccount(null); resetAll() })
  refreshAccount({ userId: 'review-user', tenantId })
  resetAll()
  setData(projectKey, [{ ...baseContribution(), reviewedVersion: 3 }])
  const id = await contributionReviewId(tenantId, projectId, contributionId, key)
  let postedBody: unknown
  let postedKey: string | null = null
  globalThis.fetch = async (_input, init) => {
    postedBody = JSON.parse(String(init?.body))
    postedKey = new Headers(init?.headers).get('Idempotency-Key')
    return response(baseContribution([run(id, 'pending')]))
  }

  await applyContributionReview(intent, key)

  assert.deepEqual(postedBody, { expectedVersion: 3, reviewer })
  assert.equal(postedKey, key)
  assert.equal(peek<Contribution[]>(projectKey)?.[0]?.reviewedVersion, undefined,
    'a new pending review clears a prior same-version pass stamp')
})

test('review accepts exact uncertain receipt as transport truth without converting it to a pass', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch; refreshAccount(null); resetAll() })
  refreshAccount({ userId: 'review-user', tenantId })
  resetAll()
  const id = await contributionReviewId(tenantId, projectId, contributionId, key)
  globalThis.fetch = async () => response(baseContribution([run(id, 'uncertain')]))

  await assert.doesNotReject(applyContributionReview(intent, key))
})

test('review reconciliation merges only its exact receipt and keeps a terminal receipt over stale pending data', async (t) => {
  const originalFetch = globalThis.fetch
  const projectKey = keys.contributions(projectId)
  t.after(() => { globalThis.fetch = originalFetch; refreshAccount(null); resetAll() })
  refreshAccount({ userId: 'review-user', tenantId })
  resetAll()
  const id = await contributionReviewId(tenantId, projectId, contributionId, key)
  setData(projectKey, [baseContribution([run(id, 'pending')])])
  globalThis.fetch = async () => response([baseContribution([run(id, 'uncertain')])])

  assert.equal(await reconcileContributionReview(intent, undefined, key), true)
  const cached = peek<Contribution[]>(projectKey)?.[0]
  assert.equal(cached?.reviews?.length, 1)
  assert.equal(cached?.reviews?.[0]?.status, 'uncertain')
})

test('a delayed old-version receipt cannot clear a newer pass stamp or overwrite its changeset', async (t) => {
  const originalFetch = globalThis.fetch
  const projectKey = keys.contributions(projectId)
  t.after(() => { globalThis.fetch = originalFetch; refreshAccount(null); resetAll() })
  refreshAccount({ userId: 'review-user', tenantId })
  resetAll()
  const id = await contributionReviewId(tenantId, projectId, contributionId, key)
  const newer = {
    ...baseContribution([run('newer-pass', 'passed', 4)]),
    changeset: [1, 2, 3, 4].map((version) => ({ version, at: version, by: 'Contributor', entries: [] })),
    reviewedVersion: 4,
    summary: 'Later Contribution truth',
  }
  setData(projectKey, [newer])
  globalThis.fetch = async () => response([baseContribution([run(id, 'findings', 3)])])

  assert.equal(await reconcileContributionReview(intent, undefined, key), true)
  const cached = peek<Contribution[]>(projectKey)?.[0]
  assert.equal(cached?.reviewedVersion, 4)
  assert.equal(cached?.changeset?.length, 4)
  assert.equal(cached?.summary, 'Later Contribution truth')
  assert.equal(cached?.reviews?.find((review) => review.id === id)?.status, 'findings')
})

test('a different receipt or version cannot acknowledge this review', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch; refreshAccount(null); resetAll() })
  refreshAccount({ userId: 'review-user', tenantId })
  resetAll()
  const id = await contributionReviewId(tenantId, projectId, contributionId, key)
  globalThis.fetch = async () => response(baseContribution([run(id, 'passed', 2)]))

  await assert.rejects(applyContributionReview(intent, key), /frozen changeset version/)
})
