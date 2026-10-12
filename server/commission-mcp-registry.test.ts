import assert from 'node:assert/strict'
import test from 'node:test'
import type { CommissionMcpApprovalIntent, CommissionMcpWork } from '../contract/commissionMcp.ts'
import type { McpBoundToolCall, McpToolPermission } from '../contract/mcpExecution.ts'
import type { McpConnectionView } from '../contract/mcpConnections.ts'
import {
  CommissionMcpRegistry, emptyCommissionMcpRegistry,
  parseCommissionMcpRegistryState, type CommissionMcpRegistryContext,
} from './commissionMcpRegistry.ts'
import { CommissionMcpPolicyError, type CommissionMcpScope } from './commissionMcpPolicy.ts'
import { mcpToolSchemaHash } from './mcpToolAdmission.ts'

const now = 1_800_000_000_000
const reviewHash = 'c'.repeat(64)
const connectionId = 'mcp-connection-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const toolDefinition = { name: 'search', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, additionalProperties: true } }
const schemaHash = mcpToolSchemaHash(toolDefinition)
const tool: McpToolPermission = { connectionId, connectionRevision: 7, toolName: 'search', schemaHash, fixedArguments: {} }

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

function intent(expectedRevision = 0, maxWorkItems = 3, agentId = 'agent-a'): CommissionMcpApprovalIntent {
  return { expectedRevision, expectedConfigurationRevision: 4, reviewHash,
    execution: { agentId, providerId: 'provider-a', modelId: 'model-a' },
    expiresAt: now + 60_000, maxWorkItems, tools: [tool] }
}

function approve(registry: CommissionMcpRegistry, currentScope = scope(), maxWorkItems = 3) {
  const current = registry.policy(currentScope)
  return registry.approve(currentScope, intent(current?.policy.revision ?? 0, maxWorkItems, currentScope.agentId), context())
}

function work(itemId: string, target = 'search'): CommissionMcpWork {
  return { itemId, subGoal: 'Search the reviewed source', type: 'mcp.mutate', target, note: '' }
}

function call(arguments_: Record<string, unknown> = {}): McpBoundToolCall {
  return { connectionId, connectionRevision: 7, toolName: 'search', schemaHash, arguments: arguments_ as McpBoundToolCall['arguments'] }
}

function reserve(registry: CommissionMcpRegistry, permission = registry.policy(scope())!, itemId = 'item-a', timestamp = now) {
  return registry.reserve({ permission, work: work(itemId), tool, review: { configurationRevision: 4, reviewHash },
    now: timestamp, connection: context().connection })
}

function errorCode(fn: () => unknown, code: CommissionMcpPolicyError['code']): void {
  assert.throws(fn, (error: unknown) => error instanceof CommissionMcpPolicyError && error.code === code)
}

test('policy history is append-only and claims join the exact historical grant', () => {
  const registry = new CommissionMcpRegistry()
  const first = approve(registry)
  const claim = reserve(registry).claim
  const revoked = registry.revoke(scope(), first.policy.revision)
  const second = approve(registry)
  assert.equal(revoked.policy.revision, 2)
  assert.equal(revoked.policy.approval, null)
  assert.equal(second.policy.revision, 3)
  assert.equal(registry.claim('project-a', 'item-a')?.permission.policy.revision, 1)
  assert.equal(claim.permission.policy.revision, 1)
  assert.deepEqual(registry.snapshot().policies.map(row => [row.policy.revision, row.policy.approval !== null]), [[1, true], [2, false], [3, true]])
  assert.deepEqual(parseCommissionMcpRegistryState(registry.snapshot()), registry.snapshot())
})

test('Project and item identity prevents a second Commission, person, or grant from claiming the same work', () => {
  const registry = new CommissionMcpRegistry()
  const firstScope = scope()
  const firstGrant = approve(registry, firstScope)
  assert.equal(reserve(registry, firstGrant, 'shared-item').created, true)

  const otherScope = scope({ commissionId: 'commission-b', ownerUserId: 'person-b' })
  const otherGrant = approve(registry, otherScope)
  const attempt = () => registry.reserve({ permission: otherGrant, work: work('shared-item'), tool,
    review: { configurationRevision: 4, reviewHash }, now,
    connection: (id, tenant, owner) => id === connectionId && tenant === 'tenant-a' && owner === 'person-b' ? connection() : undefined })
  errorCode(attempt, 'stale')
  errorCode(() => registry.reserve({ permission: firstGrant, work: work('shared-item', 'other-tool'), tool,
    review: { configurationRevision: 4, reviewHash }, now, connection: context().connection }), 'stale')
  assert.equal(registry.snapshot().claims.length, 1)
})

test('failed and uncertain preparations consume a grant slot, and renewal cannot retry old work', () => {
  for (const status of ['failed', 'uncertain'] as const) {
    const registry = new CommissionMcpRegistry()
    const grant = approve(registry, scope(), 1)
    const admitted = reserve(registry, grant, `${status}-item`)
    assert.equal(admitted.created, true)
    registry.closePreparation('project-a', `${status}-item`, status, now + 1)
    errorCode(() => reserve(registry, grant, `${status}-second-item`), 'limit')

    const revoked = registry.revoke(scope(), grant.policy.revision)
    const renewed = registry.approve(scope(), intent(revoked.policy.revision, 1), context({ now: now + 2 }))
    assert.equal(renewed.policy.revision, grant.policy.revision + 2)
    errorCode(() => registry.reserve({ permission: renewed, work: work(`${status}-item`), tool,
      review: { configurationRevision: 4, reviewHash }, now: now + 2, connection: context().connection }), 'stale')
    assert.equal(reserve(registry, renewed, `${status}-new-item`, now + 2).created, true)
  }
})

test('effect failures and recovery retain consumed claims; recovery revokes pending authority', () => {
  const registry = new CommissionMcpRegistry()
  const grant = approve(registry, scope(), 1)
  reserve(registry, grant, 'effect-item')
  const effect = registry.beginEffect('project-a', 'effect-item', call(), context({ now: now + 1 }))
  assert.equal(effect.created, true)
  const failed = registry.settleEffect('project-a', 'effect-item', { status: 'failed', summary: 'refused' }, now + 2)
  assert.equal(failed.phase, 'effect')
  if (failed.phase === 'effect') assert.equal(failed.attempt.status, 'failed')
  errorCode(() => reserve(registry, grant, 'another-item'), 'limit')

  const recovery = new CommissionMcpRegistry()
  const pendingGrant = approve(recovery)
  reserve(recovery, pendingGrant, 'pending-item')
  recovery.beginEffect('project-a', 'pending-item', call(), context({ now: now + 1 }))
  assert.equal(recovery.recover(now + 2), true)
  assert.equal(recovery.recover(now + 3), false)
  const interrupted = recovery.claim('project-a', 'pending-item')!
  assert.equal(interrupted.phase, 'effect')
  if (interrupted.phase === 'effect') assert.equal(interrupted.attempt.status, 'uncertain')
  assert.equal(recovery.policy(scope())?.policy.approval, null)
  errorCode(() => reserve(recovery, pendingGrant, 'fresh-item'), 'denied')
})

test('active capacity enforces process, tenant, and tenant-Agent limits', () => {
  const byScope = new CommissionMcpRegistry()
  const first = scope()
  const firstGrant = approve(byScope, first)
  reserve(byScope, firstGrant, 'agent-first')
  const sameAgent = scope({ commissionId: 'commission-a2' })
  const sameAgentGrant = approve(byScope, sameAgent)
  errorCode(() => reserve(byScope, sameAgentGrant, 'agent-second'), 'limit')

  const byTenant = new CommissionMcpRegistry()
  for (const [commissionId, agentId] of [['tenant-c1', 'agent-one'], ['tenant-c2', 'agent-two']] as const) {
    const current = scope({ commissionId, agentId })
    reserve(byTenant, approve(byTenant, current), `${commissionId}-item`)
  }
  const thirdTenantClaim = scope({ commissionId: 'tenant-c3', agentId: 'agent-three' })
  errorCode(() => reserve(byTenant, approve(byTenant, thirdTenantClaim), 'tenant-c3-item'), 'limit')

  const process = new CommissionMcpRegistry()
  const activeScopes = [
    scope({ tenantId: 'tenant-1', ownerUserId: 'person-1', commissionId: 'process-1', agentId: 'agent-1' }),
    scope({ tenantId: 'tenant-1', ownerUserId: 'person-1', commissionId: 'process-2', agentId: 'agent-2' }),
    scope({ tenantId: 'tenant-2', ownerUserId: 'person-2', commissionId: 'process-3', agentId: 'agent-3' }),
    scope({ tenantId: 'tenant-2', ownerUserId: 'person-2', commissionId: 'process-4', agentId: 'agent-4' }),
  ]
  activeScopes.forEach((current, index) => reserve(process, approve(process, current), `process-item-${index}`))
  const fifth = scope({ tenantId: 'tenant-3', ownerUserId: 'person-3', commissionId: 'process-5', agentId: 'agent-5' })
  errorCode(() => reserve(process, approve(process, fifth), 'process-item-5'), 'limit')
})

test('retirement preserves claims, revokes authority, and never restores it', () => {
  const registry = new CommissionMcpRegistry()
  const grant = approve(registry)
  const admitted = reserve(registry, grant, 'retired-item')
  assert.equal(registry.retireCommission('commission-a', now + 1), true)
  assert.equal(registry.retireCommission('commission-a', now + 2), false)
  const state = registry.snapshot()
  assert.equal(state.claims.length, 1)
  assert.equal(state.claims[0].id, admitted.claim.id)
  assert.equal(state.claims[0].phase, 'closed')
  assert.equal(registry.policy(scope())?.policy.approval, null)
  assert.equal(state.retired[0].commissionId, 'commission-a')
  errorCode(() => approve(registry), 'unavailable')
  errorCode(() => reserve(registry, grant, 'new-item'), 'denied')
  assert.equal(registry.claim('project-a', 'retired-item')?.id, admitted.claim.id)
})

test('present malformed histories and invalid exact joins are rejected', () => {
  const registry = new CommissionMcpRegistry()
  const grant = approve(registry)
  reserve(registry, grant, 'history-item')
  registry.revoke(scope(), grant.policy.revision)
  approve(registry)
  const valid = registry.snapshot()
  const mutations = [
    { ...valid, policies: valid.policies.filter(row => row.policy.revision !== 1) },
    { ...valid, policies: valid.policies.filter(row => row.policy.revision !== 2) },
    { ...valid, policies: [...valid.policies, valid.policies[0]] },
    { ...valid, claims: [...valid.claims, valid.claims[0]] },
    { ...valid, claims: [{ ...valid.claims[0], permission: { ...grant, policy: { ...grant.policy, revision: 2 } } }] },
    null,
    { policies: [], claims: [] },
    { ...valid, extra: true },
  ]
  for (const malformed of mutations) errorCode(() => parseCommissionMcpRegistryState(malformed), 'invalid')
  assert.deepEqual(emptyCommissionMcpRegistry(), { policies: [], claims: [], retired: [] })
})

test('policy, claim, and snapshot reads are detached from registry state', () => {
  const registry = new CommissionMcpRegistry()
  const grant = approve(registry)
  reserve(registry, grant, 'detached-item')
  const policyRead = registry.policy(scope())!
  const claimRead = registry.claim('project-a', 'detached-item')!
  const snapshot = registry.snapshot()
  policyRead.policy.approval!.tools[0].fixedArguments.query = 'mutated'
  claimRead.work.note = 'mutated'
  snapshot.policies.length = 0
  snapshot.claims[0].work.note = 'also mutated'
  assert.equal(registry.policy(scope())!.policy.approval!.tools[0].fixedArguments.query, undefined)
  assert.equal(registry.claim('project-a', 'detached-item')!.work.note, '')
  assert.equal(registry.snapshot().policies.length, 1)
  assert.equal(registry.snapshot().claims[0].work.note, '')
})
