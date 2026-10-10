import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { RoutineMcpReview, RoutineMcpDecisionRequest, RoutineMcpDecisionResponse } from '../../contract/routineMcpApi.ts'
import { refreshAccount } from './account.ts'
import { keys } from './keys.ts'
import { peek, resetAll, setData } from './cache.ts'
import { decideRoutineMcp, getRoutineMcpReview } from './routineMcpReview.ts'
import { AccountSwitchedError } from './client.ts'
import type { Identity } from '../../contract/identity.ts'

const ROUTINE = 'routine-cache-race'
const TENANT = 'routine-cache-tenant'
const USER = 'routine-cache-owner'

function review(revision: number, active: boolean): RoutineMcpReview {
  return {
    routineId: ROUTINE,
    definitionRevision: 3,
    reviewHash: 'a'.repeat(64),
    policy: {
      version: 1,
      revision,
      approval: active ? {
        definitionRevision: 3,
        reviewHash: 'a'.repeat(64),
        approvedAt: 10,
        expiresAt: 100,
        maxCallsPerRun: 2,
        tools: [],
      } : null,
    },
    active,
    disclosures: [],
    tools: [],
    runs: [],
  }
}

function response(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json', 'x-resolved-tenant': TENANT } })
}

test('a delayed old Routine MCP review cannot overwrite a decision acknowledgement in the cache', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch; refreshAccount(null); resetAll() })
  refreshAccount({ userId: USER, tenantId: TENANT })
  const identity: Identity = { user: { id: USER, name: 'Owner' }, tenant: { id: TENANT, name: 'Tenant', kind: 'personal' }, role: 'owner', local: false, via: 'session' }
  setData(keys.me, identity)
  let releaseRead!: (value: Response) => void
  const old = review(7, true)
  const current = review(8, false)
  const request: RoutineMcpDecisionRequest = { requestId: 'revoke-exact-key', action: 'revoke', expectedRevision: 7 }
  const acknowledgement: RoutineMcpDecisionResponse = {
    routineId: ROUTINE,
    requestId: request.requestId,
    decisionId: 'revoke-exact-key',
    review: current,
  }
  const calls: string[] = []
  globalThis.fetch = async (_input, init) => {
    calls.push(init?.method ?? 'GET')
    if (init?.method === 'POST') return response(acknowledgement)
    return new Promise<Response>((resolve) => { releaseRead = resolve })
  }

  const delayedRead = getRoutineMcpReview(ROUTINE)
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  await decideRoutineMcp(ROUTINE, request)
  assert.deepEqual(peek(keys.scheduleMcpPermission(ROUTINE)), current, 'the exact server acknowledgement publishes current policy')
  releaseRead(response(old))
  assert.deepEqual(await delayedRead, old, 'the fetcher returns its response to its cache owner')
  assert.deepEqual(peek(keys.scheduleMcpPermission(ROUTINE)), current,
    'a stale GET must not publish around the query cache generation fence')
  assert.deepEqual(calls, ['GET', 'POST'])
})

for (const returnToOwner of [false, true]) {
  test(`Routine MCP acknowledgement cannot publish across an account switch${returnToOwner ? ' away and back' : ''}`, async (t) => {
    const originalFetch = globalThis.fetch
    t.after(() => { globalThis.fetch = originalFetch; refreshAccount(null); resetAll() })
    refreshAccount({ userId: USER, tenantId: TENANT })
    resetAll()
    const request: RoutineMcpDecisionRequest = { requestId: 'switch-race-key', action: 'revoke', expectedRevision: 7 }
    const acknowledgement: RoutineMcpDecisionResponse = {
      routineId: ROUTINE, requestId: request.requestId, decisionId: 'switch-race-decision', review: review(8, false),
    }
    let echoReads = 0
    globalThis.fetch = async () => ({
      status: 200,
      ok: true,
      headers: { get(name: string) {
        assert.equal(name, 'x-resolved-tenant')
        echoReads += 1
        if (echoReads === 2) {
          // Queue the transition after the transport's final body/identity
          // check, but before its caller resumes to publish the response.
          queueMicrotask(() => {
            refreshAccount({ userId: 'other-owner', tenantId: 'other-tenant' })
            resetAll()
            if (returnToOwner) refreshAccount({ userId: USER, tenantId: TENANT })
          })
        }
        return TENANT
      } },
      text: async () => JSON.stringify(acknowledgement),
    }) as Response

    let failure: unknown
    try { await decideRoutineMcp(ROUTINE, request) } catch (error) { failure = error }
    assert.equal(echoReads, 2, 'the response passed both real transport checks before switching')
    assert.equal(peek(keys.scheduleMcpPermission(ROUTINE)), undefined,
      'the prior account response must not repopulate a reset private cache')
    assert.ok(failure instanceof AccountSwitchedError, 'publication rejects the crossed acknowledgement')
  })
}
