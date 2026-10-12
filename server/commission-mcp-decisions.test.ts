import assert from 'node:assert/strict'
import test from 'node:test'
import type { CommissionMcpApprovalIntent } from '../contract/commissionMcp.ts'
import type { CommissionMcpDecisionRequest } from '../contract/commissionMcpApi.ts'
import type { McpConnectionView } from '../contract/mcpConnections.ts'
import {
  COMMISSION_MCP_MAX_DECISIONS_PER_COMMISSION,
  CommissionMcpRegistry,
  parseCommissionMcpRegistryState,
  type CommissionMcpRegistryContext,
} from './commissionMcpRegistry.ts'
import { CommissionMcpPolicyError, type CommissionMcpScope } from './commissionMcpPolicy.ts'
import { mcpToolSchemaHash } from './mcpToolAdmission.ts'

const now = 1_800_000_000_000
const reviewHash = 'c'.repeat(64)
const connectionId = 'mcp-connection-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const toolDefinition = { name: 'search', inputSchema: { type: 'object', properties: {}, additionalProperties: true } }
const schemaHash = mcpToolSchemaHash(toolDefinition)
const tool = { connectionId, connectionRevision: 7, toolName: 'search', schemaHash, fixedArguments: {} }

function scope(overrides: Partial<CommissionMcpScope> = {}): CommissionMcpScope {
  return { tenantId: 'tenant-a', ownerUserId: 'person-a', projectId: 'project-a', commissionId: 'commission-a', agentId: 'agent-a', ...overrides }
}

function connection(): McpConnectionView {
  return { id: connectionId, label: 'Reviewed peer', status: 'connected', revision: 7, authentication: 'none',
    protocolVersion: '2026-07-28', inspectedAt: now, tools: [toolDefinition], execution: 'approval-required', executableTools: ['search'] }
}

function context(overrides: Partial<CommissionMcpRegistryContext> = {}): CommissionMcpRegistryContext {
  return { configurationRevision: 4, reviewHash, now, connection: (id, tenant, owner) =>
    id === connectionId && !!tenant && !!owner ? connection() : undefined, ...overrides }
}

function intent(expectedRevision = 0): CommissionMcpApprovalIntent {
  return { expectedRevision, expectedConfigurationRevision: 4, reviewHash,
    execution: { agentId: 'agent-a', providerId: 'provider-a', modelId: 'model-a' },
    expiresAt: now + 60_000, maxWorkItems: 3, tools: [tool] }
}

function approveRequest(requestId: string, approval = intent()): CommissionMcpDecisionRequest {
  return { requestId, action: 'approve', approval }
}

function approve(registry: CommissionMcpRegistry, currentScope = scope()) {
  const current = registry.policy(currentScope)
  return registry.approve(currentScope, intent(current?.policy.revision ?? 0), context())
}

function decide(registry: CommissionMcpRegistry, currentScope: CommissionMcpScope, request: CommissionMcpDecisionRequest,
  current = context()) {
  return registry.decide(currentScope, request, current)
}

function errorCode(fn: () => unknown, code: CommissionMcpPolicyError['code']): void {
  assert.throws(fn, (error: unknown) => error instanceof CommissionMcpPolicyError && error.code === code)
}

test('keyed approval decisions append exact receipts without exposing request keys', () => {
  const registry = new CommissionMcpRegistry()
  const request = approveRequest('opaque-owner-key')
  const result = decide(registry, scope(), request)
  assert.deepEqual(result, { decisionId: result.decisionId, replayed: false, policyRevision: 1 })
  assert.match(result.decisionId, /^commission-mcp-decision-[a-f0-9]{64}$/)
  const snapshot = registry.snapshot()
  assert.equal(snapshot.policies.length, 1)
  assert.equal(snapshot.decisions?.length, 1)
  assert.equal(snapshot.decisions?.[0]?.policyRevision, 1)
  assert.equal(snapshot.decisions?.[0]?.action, 'approve')
  assert.equal(JSON.stringify(snapshot).includes('opaque-owner-key'), false)
  assert.deepEqual(parseCommissionMcpRegistryState(snapshot), snapshot)

  snapshot.decisions![0]!.action = 'revoke'
  assert.equal(registry.snapshot().decisions?.[0]?.action, 'approve')
})

test('same request key is independent per person, while changed intent conflicts without mutation', () => {
  const registry = new CommissionMcpRegistry()
  const key = 'shared-local-key'
  const firstScope = scope()
  const secondScope = scope({ ownerUserId: 'person-b' })
  const first = decide(registry, firstScope, approveRequest(key))
  const second = decide(registry, secondScope, approveRequest(key))
  assert.notEqual(first.decisionId, second.decisionId)
  assert.equal(first.policyRevision, 1)
  assert.equal(second.policyRevision, 1)

  const before = registry.snapshot()
  errorCode(() => decide(registry, firstScope, approveRequest(key, { ...intent(), maxWorkItems: 1 })), 'stale')
  assert.deepEqual(registry.snapshot(), before)
})

test('exact replay precedes live review gates and survives replacement and retirement', () => {
  const registry = new CommissionMcpRegistry()
  const original = approveRequest('durable-key')
  const first = decide(registry, scope(), original)
  registry.revoke(scope(), 1)
  registry.approve(scope(), intent(2), context({ now: now + 1 }))

  const unavailable = context({ configurationRevision: 999, reviewHash: 'd'.repeat(64), now: now + 99_999,
    connection: () => undefined })
  const replacementReplay = decide(registry, scope(), original, unavailable)
  assert.deepEqual(replacementReplay, { ...first, replayed: true })
  assert.equal(replacementReplay.policyRevision, 1)

  registry.retireCommission('commission-a', now + 2)
  const retiredReplay = decide(registry, scope(), original, unavailable)
  assert.deepEqual(retiredReplay, { ...first, replayed: true })
  errorCode(() => decide(registry, scope(), approveRequest('new-after-retirement')), 'unavailable')
})

test('explicit host approval unavailability rejects fresh approval but not an exact receipt replay', () => {
  const registry = new CommissionMcpRegistry()
  const request = approveRequest('approved-before-budget-change')
  const first = decide(registry, scope(), request, context({ approvalAllowed: true }))
  const unavailable = context({ approvalAllowed: false, configurationRevision: 999,
    reviewHash: 'd'.repeat(64), connection: () => undefined })
  assert.deepEqual(decide(registry, scope(), request, unavailable), { ...first, replayed: true })
  errorCode(() => decide(registry, scope(), approveRequest('fresh-after-budget-change'), unavailable), 'denied')
  assert.equal(registry.snapshot().decisions?.length, 1)
})

test('approval and receipt commit atomically; a refused request changes nothing', () => {
  const registry = new CommissionMcpRegistry()
  const before = registry.snapshot()
  errorCode(() => decide(registry, scope(), approveRequest('bad-review'), context({ reviewHash: 'd'.repeat(64) })), 'stale')
  assert.deepEqual(registry.snapshot(), before)

  decide(registry, scope(), approveRequest('approve'))
  const afterApprove = registry.snapshot()
  errorCode(() => decide(registry, scope(), { requestId: 'bad-revoke', action: 'revoke', expectedRevision: 9 }), 'stale')
  assert.deepEqual(registry.snapshot(), afterApprove)
})

test('revoke decision joins its exact revision and a repeated revoked no-op is receipt-only', () => {
  const registry = new CommissionMcpRegistry()
  decide(registry, scope(), approveRequest('approve'))
  const revoked = decide(registry, scope(), { requestId: 'withdraw', action: 'revoke', expectedRevision: 1 })
  assert.equal(revoked.policyRevision, 2)
  assert.equal(registry.policy(scope())?.policy.approval, null)

  const noop = decide(registry, scope(), { requestId: 'withdraw-again', action: 'revoke', expectedRevision: 2 })
  assert.equal(noop.policyRevision, 2)
  assert.equal(registry.snapshot().policies.length, 2)
  assert.deepEqual(registry.snapshot().decisions?.map(row => [row.policyRevision, row.action]), [[1, 'approve'], [2, 'revoke'], [2, 'revoke']])
  assert.deepEqual(parseCommissionMcpRegistryState(registry.snapshot()), registry.snapshot())
})

test('legacy three-field reads default decisions empty; malformed present decisions and broken joins fail closed', () => {
  assert.deepEqual(parseCommissionMcpRegistryState({ policies: [], claims: [], retired: [] }),
    { policies: [], claims: [], retired: [], decisions: [] })
  assert.deepEqual(new CommissionMcpRegistry({ policies: [], claims: [], retired: [] }).snapshot(),
    { policies: [], claims: [], retired: [], decisions: [] })
  const registry = new CommissionMcpRegistry()
  decide(registry, scope(), approveRequest('proof'))
  const valid = registry.snapshot()
  for (const malformed of [
    { ...valid, decisions: null },
    { ...valid, decisions: [{ ...valid.decisions![0], requestId: 'raw-key' }] },
    { ...valid, decisions: [{ ...valid.decisions![0], policyRevision: 2 }] },
    { ...valid, decisions: [{ ...valid.decisions![0], action: 'revoke' }] },
    { ...valid, decisions: [valid.decisions![0], valid.decisions![0]] },
  ]) assert.throws(() => parseCommissionMcpRegistryState(malformed), CommissionMcpPolicyError)
})

test('decision history reserves its final slot for withdrawal and exact replay remains available at capacity', () => {
  assert.equal(COMMISSION_MCP_MAX_DECISIONS_PER_COMMISSION, 256)
  const registry = new CommissionMcpRegistry()
  approve(registry)
  registry.revoke(scope(), 1)
  const firstNoop: CommissionMcpDecisionRequest = { requestId: 'redundant-revoke-0', action: 'revoke', expectedRevision: 2 }
  for (let index = 0; index < COMMISSION_MCP_MAX_DECISIONS_PER_COMMISSION - 1; index += 1) {
    decide(registry, scope(), index === 0 ? firstNoop :
      { requestId: `redundant-revoke-${index}`, action: 'revoke', expectedRevision: 2 })
  }
  assert.equal(registry.snapshot().decisions?.length, 255)
  approve(registry)
  assert.ok(registry.policy(scope())?.policy.approval)
  const current = registry.policy(scope())!
  errorCode(() => decide(registry, scope(), approveRequest('full-approval', intent(current.policy.revision))), 'limit')
  assert.equal(decide(registry, scope(), firstNoop, context({ configurationRevision: 999,
    reviewHash: 'd'.repeat(64), connection: () => undefined })).replayed, true)

  // Redundant no-op revocations used 255 receipts; the final slot still allows
  // withdrawing this live grant.
  const withdrawal = decide(registry, scope(), { requestId: 'last-withdrawal', action: 'revoke', expectedRevision: current.policy.revision })
  assert.equal(withdrawal.policyRevision, current.policy.revision + 1)
  assert.equal(registry.snapshot().decisions?.length, 256)
  assert.equal(registry.policy(scope())?.policy.approval, null)
  assert.deepEqual(parseCommissionMcpRegistryState(registry.snapshot()), registry.snapshot())
})
