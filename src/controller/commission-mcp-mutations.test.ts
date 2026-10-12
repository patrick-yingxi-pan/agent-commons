import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as React from 'react'
import type { CommissionMcpDecisionRequest, CommissionMcpDecisionResponse, CommissionMcpReview } from '../../contract/commissionMcpApi.ts'
import type { Identity } from '../../contract/identity.ts'
import { refreshAccount } from '../api/account.ts'
import { keys } from '../api/keys.ts'
import { resetAll, setData } from '../api/cache.ts'
import { peek } from '../api/cache.ts'
import { useCommissionMcpReview } from '../api/commissionMcpHooks.ts'
import { enqueueCommissionMcpMutation, commissionMcpHeldDecision, commissionMcpHeldPresentation, dismissCommissionMcpMutation, isCommissionMcpHeld, retryCommissionMcpMutation } from './commissionMcpMutations.ts'

const commissionId = 'commission-held'
const tenantId = 'tenant-held'
const userId = 'owner-held'

function review(): CommissionMcpReview {
  return { commissionId, projectId: 'project-held', configurationRevision: 1, reviewHash: 'b'.repeat(64), execution: null,
    policy: { version: 1, revision: 3, approval: null }, active: false, blockedReason: null, disclosures: [], tools: [], claims: [] }
}
function response(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json', 'x-resolved-tenant': tenantId } })
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
async function waitFor(predicate: () => boolean) {
  for (let i = 0; i < 50 && !predicate(); i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(predicate(), true, 'expected asynchronous mutation step to start')
}

test('Commission MCP decision remains held and retries the exact frozen body and request key', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch; refreshAccount(null); resetAll(); dismissCommissionMcpMutation() })
  refreshAccount({ userId, tenantId })
  setData<Identity>(keys.me, { user: { id: userId, name: 'Owner' }, tenant: { id: tenantId, name: 'Tenant', kind: 'personal' }, role: 'owner', local: false, via: 'session' })
  const request: CommissionMcpDecisionRequest = { requestId: 'stable-request', action: 'revoke', expectedRevision: 3 }
  const presentation = { disclosures: ['Reviewed scope'], modelLabel: 'Model One', labels: { toolA: 'Search' } }
  const receipt: CommissionMcpDecisionResponse = { commissionId, requestId: request.requestId, decisionId: 'decision', review: review() }
  const reconciliation = deferred<Response>()
  const posts: Array<{ body: string; key: string }> = []
  let gets = 0
  globalThis.fetch = async (_input, init) => {
    if (init?.method === 'POST') {
      posts.push({ body: String(init.body), key: new Headers(init.headers).get('Idempotency-Key') ?? '' })
      return posts.length === 1 ? Promise.reject(new Error('connection lost')) : response(receipt)
    }
    gets += 1
    return reconciliation.promise
  }

  const outcome = enqueueCommissionMcpMutation(commissionId, request, presentation)
  assert.ok(outcome)
  presentation.disclosures[0] = 'changed after submit'
  presentation.labels.toolA = 'Changed'
  await waitFor(() => gets === 1)
  assert.equal(isCommissionMcpHeld(commissionId), true, 'navigation/remount lifetime is owned outside the component')
  assert.deepEqual(commissionMcpHeldDecision(commissionId), request)
  assert.deepEqual(commissionMcpHeldPresentation(commissionId), { disclosures: ['Reviewed scope'], modelLabel: 'Model One', labels: { toolA: 'Search' } })
  assert.equal(Object.isFrozen(commissionMcpHeldPresentation(commissionId)?.labels), true)
  reconciliation.resolve(response(review()))
  await waitFor(() => posts.length === 1)
  await new Promise((resolve) => setTimeout(resolve, 0))
  retryCommissionMcpMutation()
  assert.equal(await outcome, 'applied')
  assert.deepEqual(posts, [
    { body: JSON.stringify(request), key: request.requestId },
    { body: JSON.stringify(request), key: request.requestId },
  ])
  assert.equal(isCommissionMcpHeld(commissionId), false)
})

test('authoritative Commission MCP unavailability can be explicitly dismissed without claiming the decision succeeded', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch; refreshAccount(null); resetAll(); dismissCommissionMcpMutation() })
  refreshAccount({ userId, tenantId })
  setData<Identity>(keys.me, { user: { id: userId, name: 'Owner' }, tenant: { id: tenantId, name: 'Tenant', kind: 'personal' }, role: 'owner', local: false, via: 'session' })
  const request: CommissionMcpDecisionRequest = { requestId: 'unavailable-request', action: 'revoke', expectedRevision: 3 }
  let gets = 0
  globalThis.fetch = async (_input, init) => {
    if (init?.method === 'POST') return Promise.reject(new Error('connection lost'))
    gets += 1
    return new Response(JSON.stringify({ error: { code: 'not_found', message: 'unavailable' } }), {
      status: 404, headers: { 'content-type': 'application/json', 'x-resolved-tenant': tenantId },
    })
  }
  const outcome = enqueueCommissionMcpMutation(commissionId, request)
  assert.ok(outcome)
  await waitFor(() => gets === 1)
  await new Promise((resolve) => setTimeout(resolve, 0))
  dismissCommissionMcpMutation()
  assert.equal(await outcome, 'discarded')
  assert.equal(isCommissionMcpHeld(commissionId), false)
})

test('account switch clears the held Commission MCP request and fences a late receipt', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch; refreshAccount(null); resetAll(); dismissCommissionMcpMutation() })
  refreshAccount({ userId, tenantId })
  setData<Identity>(keys.me, { user: { id: userId, name: 'Owner' }, tenant: { id: tenantId, name: 'Tenant', kind: 'personal' }, role: 'owner', local: false, via: 'session' })
  const request: CommissionMcpDecisionRequest = { requestId: 'account-switch-request', action: 'revoke', expectedRevision: 3 }
  const responsePending = deferred<Response>()
  globalThis.fetch = async () => responsePending.promise
  const outcome = enqueueCommissionMcpMutation(commissionId, request)
  assert.ok(outcome)
  await waitFor(() => isCommissionMcpHeld(commissionId))
  await new Promise((resolve) => setTimeout(resolve, 0))
  refreshAccount({ userId: 'other-owner', tenantId: 'other-tenant' })
  resetAll()
  assert.equal(await outcome, 'discarded')
  responsePending.resolve(response({ commissionId, requestId: request.requestId, decisionId: 'late', review: review() }))
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(isCommissionMcpHeld(commissionId), false)
})

test('a decision acknowledgement refetches base and model-choice reviews without SSE', async (t) => {
  const originalFetch = globalThis.fetch
  const internals = (React as unknown as { __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: { H: unknown } })
    .__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE
  const originalDispatcher = internals.H
  const cleanups: Array<() => void> = []
  t.after(() => {
    for (const cleanup of cleanups) cleanup()
    internals.H = originalDispatcher
    refreshAccount(null)
    resetAll()
    globalThis.fetch = originalFetch
  })
  refreshAccount({ userId, tenantId })
  setData<Identity>(keys.me, { user: { id: userId, name: 'Owner' }, tenant: { id: tenantId, name: 'Tenant', kind: 'personal' }, role: 'owner', local: false, via: 'session' })
  const selection = { providerId: 'provider-live', modelId: 'model-live' }
  const oldReview = { ...review(), policy: { version: 1 as const, revision: 3, approval: null }, reviewHash: 'c'.repeat(64) }
  const currentReview = { ...review(), policy: { version: 1 as const, revision: 4, approval: null }, reviewHash: 'd'.repeat(64) }
  const request: CommissionMcpDecisionRequest = {
    requestId: 'refresh-both-review-keys', action: 'approve',
    approval: { expectedRevision: 3, expectedConfigurationRevision: 1, reviewHash: 'c'.repeat(64),
      execution: { agentId: 'agent-live', providerId: selection.providerId, modelId: selection.modelId },
      expiresAt: 90_000, maxWorkItems: 3, tools: [] },
  }
  let decisionSent = false
  let reads = 0
  globalThis.fetch = async (input, init) => {
    if (init?.method === 'POST') {
      decisionSent = true
      return response({ commissionId, requestId: request.requestId, decisionId: 'refresh-receipt', review: currentReview })
    }
    reads += 1
    return response(decisionSent ? currentReview : oldReview)
  }
  internals.H = {
    useCallback: (callback: unknown) => callback,
    useSyncExternalStore: (subscribe: (listener: () => void) => () => void, getSnapshot: () => unknown) => {
      cleanups.push(subscribe(() => {}))
      return getSnapshot()
    },
    useEffect: (effect: () => void) => { effect() },
  }
  useCommissionMcpReview(commissionId)
  useCommissionMcpReview(commissionId, selection)
  internals.H = originalDispatcher
  await waitFor(() => reads === 2)
  const baseKey = keys.commissionMcpPermission(commissionId)
  const choiceKey = keys.commissionMcpPermission(commissionId, selection)
  await waitFor(() => peek<CommissionMcpReview>(baseKey)?.policy.revision === 3 && peek<CommissionMcpReview>(choiceKey)?.policy.revision === 3)

  const outcome = enqueueCommissionMcpMutation(commissionId, request)
  assert.ok(outcome)
  assert.equal(await outcome, 'applied')
  await waitFor(() => peek<CommissionMcpReview>(baseKey)?.policy.revision === 4 && peek<CommissionMcpReview>(choiceKey)?.policy.revision === 4)
  assert.equal(reads, 4, 'the keyed acknowledgement invalidated both mounted review variants without an SSE event')
})
