import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { Identity } from '../../contract/identity.ts'
import { refreshAccount } from './account.ts'
import { ApiRequestError, API_BASE } from './client.ts'
import { peek, resetAll, setData } from './cache.ts'
import { keys, paths } from './keys.ts'
import { decideAgentRequest } from './agentRequests.ts'

const tenantId = 'tenant-agent-request-recovery'
const userId = 'user-agent-request-recovery'
const requestId = 'agent-request-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const identity: Identity = {
  user: { id: userId, name: 'Recovery tester' },
  tenant: { id: tenantId, name: 'Recovery test', kind: 'personal' },
  role: 'owner', local: false, via: 'session',
}

function response(status: number): Response {
  return new Response(JSON.stringify({ error: { code: 'conflict', message: 'Request decision could not be confirmed.' } }), {
    status, headers: { 'content-type': 'application/json', 'x-resolved-tenant': tenantId },
  })
}

test('a failed Agent request decision revalidates list, detail, and owner review projections', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch; refreshAccount(null); resetAll() })
  refreshAccount({ userId, tenantId })
  setData(keys.me, identity)

  const source = readFileSync(new URL('./agentRequests.ts', import.meta.url), 'utf8')
  const decisionStart = source.indexOf('export async function decideAgentRequest(')
  assert.notEqual(decisionStart, -1, 'the production decision command must exist')
  const decisionEnd = source.indexOf('\n}', decisionStart)
  assert.ok(decisionEnd > decisionStart, 'the complete decision command is inspected')
  const decision = source.slice(decisionStart, decisionEnd)
  const catchStart = decision.indexOf('} catch (error) {')
  assert.notEqual(catchStart, -1, 'the failure path is present')
  const failure = decision.slice(catchStart)
  assert.ok(failure.includes('refreshAgentRequests(id)'), 'any failed or conflicting POST invalidates addressed reads')
  assert.ok(failure.includes('throw error'), 'the original failure stays visible to the controller')

  const refreshStart = source.indexOf('export function refreshAgentRequests(')
  assert.notEqual(refreshStart, -1, 'the shared read refresh helper must exist')
  const refreshEnd = source.indexOf('\n}', refreshStart)
  const refresh = source.slice(refreshStart, refreshEnd)
  for (const exactInvalidation of [
    'invalidate(keys.agentRequests)',
    'invalidate(keys.agentRequest(id))',
    'invalidate(keys.agentRequestReview(id))',
    'invalidate(keys.agentRequestReplyReview(id))',
  ]) assert.ok(refresh.includes(exactInvalidation), `decision failure refreshes ${exactInvalidation}`)

  for (const status of [409, 503]) {
    const calls: Array<{ url: string; method?: string; body?: string | null }> = []
    globalThis.fetch = async (input, init) => {
      calls.push({ url: String(input), method: init?.method, body: init?.body as string | null | undefined })
      return response(status)
    }
    await assert.rejects(decideAgentRequest(requestId, { action: 'deny', expectedRevision: 7 }, {
      expectedSessionUserId: userId,
    }), (error: unknown) => error instanceof ApiRequestError && error.status === status)
    assert.deepEqual(calls, [{ url: `${API_BASE}${paths.agentRequestDecision(requestId)}`, method: 'POST',
      body: JSON.stringify({ action: 'deny', expectedRevision: 7 }) }],
    'failure revalidation never retries the decision POST')
  }
  assert.equal(peek(keys.me), identity, 'the current identity cache remains intact')
})
