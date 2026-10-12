import { test } from 'node:test'
import assert from 'node:assert/strict'
import { keys, paths } from './keys.ts'
import { refreshAccount } from './account.ts'
import { resetAll } from './cache.ts'
import { decideCommissionMcp, getCommissionMcpReview } from './commissionMcpReview.ts'
import type { CommissionMcpDecisionRequest, CommissionMcpDecisionResponse, CommissionMcpReview } from '../../contract/commissionMcpApi.ts'

const tenantId = 'commission-tenant'
const commissionId = 'commission-one'
const selection = { providerId: 'provider a', modelId: 'model/b' }

function review(): CommissionMcpReview {
  return {
    commissionId, projectId: 'project-one', configurationRevision: 4, reviewHash: 'a'.repeat(64), execution: null,
    policy: { version: 1, revision: 2, approval: null }, active: false, blockedReason: null,
    disclosures: [], tools: [], claims: [],
  }
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json', 'x-resolved-tenant': tenantId } })
}

test('Commission MCP review choices use paired query parameters and distinct cache keys', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch; refreshAccount(null); resetAll() })
  refreshAccount({ userId: 'commission-owner', tenantId })
  const urls: string[] = []
  globalThis.fetch = async (input) => { urls.push(String(input)); return json(review()) }

  await getCommissionMcpReview(commissionId)
  await getCommissionMcpReview(commissionId, selection)
  assert.equal(urls[0], `/api/v1/commissions/${commissionId}/mcp-permission`)
  assert.equal(urls[1], `/api/v1/commissions/${commissionId}/mcp-permission?providerId=provider%20a&modelId=model%2Fb`)
  assert.notEqual(keys.commissionMcpPermission(commissionId), keys.commissionMcpPermission(commissionId, selection))
  assert.equal(paths.commissionMcpPermission(commissionId), `/commissions/${commissionId}/mcp-permission`)
})

test('Commission MCP decision carries its exact request key and only publishes an addressed acknowledgement', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch; refreshAccount(null); resetAll() })
  refreshAccount({ userId: 'commission-owner', tenantId })
  const request: CommissionMcpDecisionRequest = { requestId: 'commission-decision-key', action: 'revoke', expectedRevision: 2 }
  const receipt: CommissionMcpDecisionResponse = { commissionId, requestId: request.requestId, decisionId: 'decision-one', review: review() }
  let sentBody = ''
  let sentKey = ''
  globalThis.fetch = async (_input, init) => {
    sentBody = String(init?.body)
    sentKey = new Headers(init?.headers).get('Idempotency-Key') ?? ''
    return json(receipt)
  }
  const result = await decideCommissionMcp(commissionId, request)
  assert.equal(sentBody, JSON.stringify(request))
  assert.equal(sentKey, request.requestId)
  assert.equal(result.decisionId, 'decision-one')
})
