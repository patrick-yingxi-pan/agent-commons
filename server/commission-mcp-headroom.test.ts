import assert from 'node:assert/strict'
import test from 'node:test'
import type { CommissionMcpApprovalIntent, CommissionMcpWork } from '../contract/commissionMcp.ts'
import type { CommissionMcpDecisionRequest } from '../contract/commissionMcpApi.ts'
import type { McpToolPermission } from '../contract/mcpExecution.ts'
import type { McpConnectionView } from '../contract/mcpConnections.ts'
import { CommissionMcpRegistry, commissionMcpRegistryCapacity, type CommissionMcpRegistryContext } from './commissionMcpRegistry.ts'
import { CommissionMcpPolicyError, type CommissionMcpScope } from './commissionMcpPolicy.ts'
import { mcpToolSchemaHash } from './mcpToolAdmission.ts'

const now = 1_800_000_000_000
const reviewHash = 'c'.repeat(64)
const connectionId = 'mcp-connection-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const definition = { name: 'search', inputSchema: { type: 'object', properties: {}, additionalProperties: true } }
const schemaHash = mcpToolSchemaHash(definition)
const tool: McpToolPermission = { connectionId, connectionRevision: 7, toolName: 'search', schemaHash, fixedArguments: {} }
const scope: CommissionMcpScope = { tenantId: 'tenant-a', ownerUserId: 'person-a', projectId: 'project-a', commissionId: 'commission-a', agentId: 'agent-a' }
const connection = (): McpConnectionView => ({ id: connectionId, label: 'Peer', status: 'connected', revision: 7,
  authentication: 'none', protocolVersion: '2026-07-28', inspectedAt: now, tools: [definition], execution: 'approval-required', executableTools: ['search'] })
const context: CommissionMcpRegistryContext = { configurationRevision: 4, reviewHash, now,
  connection: (id, tenant, owner) => id === connectionId && tenant === scope.tenantId && owner === scope.ownerUserId ? connection() : undefined }
const intent: CommissionMcpApprovalIntent = { expectedRevision: 0, expectedConfigurationRevision: 4, reviewHash,
  execution: { agentId: scope.agentId, providerId: 'provider-a', modelId: 'model-a' },
  expiresAt: now + 60_000, maxWorkItems: 3, tools: [tool] }
const work = (itemId: string): CommissionMcpWork => ({ itemId, subGoal: 'Search', type: 'mcp.mutate', target: 'search', note: '' })

test('capacity reserves active claim growth plus revocation, decision receipt, and retirement headroom', () => {
  const registry = new CommissionMcpRegistry()
  const empty = commissionMcpRegistryCapacity(registry.snapshot())
  assert.equal(empty.bytes, 55) // {"policies":[],"claims":[],"retired":[],"decisions":[]}
  assert.equal(empty.reservedBytes, 0)

  const grant = registry.approve(scope, intent, context)
  const approved = commissionMcpRegistryCapacity(registry.snapshot())
  assert.equal(approved.reservedBytes, 262_144 + 8_192 + 8_192)

  registry.reserve({ permission: grant, work: work('headroom-item'), tool,
    review: { configurationRevision: 4, reviewHash }, now, connection: context.connection })
  const active = commissionMcpRegistryCapacity(registry.snapshot())
  assert.ok(active.reservedBytes > approved.reservedBytes)
  assert.ok(active.reservedNodes > approved.reservedNodes)

  registry.closePreparation('project-a', 'headroom-item', 'failed', now + 1)
  const closed = commissionMcpRegistryCapacity(registry.snapshot())
  assert.equal(closed.reservedBytes, approved.reservedBytes)
  assert.ok(closed.bytes > active.bytes)

  registry.revoke(scope, grant.policy.revision)
  const revoked = commissionMcpRegistryCapacity(registry.snapshot())
  assert.ok(revoked.reservedBytes < closed.reservedBytes)
  registry.retireCommission(scope.commissionId, now + 2)
  const retired = commissionMcpRegistryCapacity(registry.snapshot())
  assert.ok(retired.reservedBytes < revoked.reservedBytes)
})

test('terminal effect results replace active growth liability without dropping receipt bytes', () => {
  const registry = new CommissionMcpRegistry()
  const grant = registry.approve(scope, intent, context)
  registry.reserve({ permission: grant, work: work('effect-headroom-item'), tool,
    review: { configurationRevision: 4, reviewHash }, now, connection: context.connection })
  registry.beginEffect('project-a', 'effect-headroom-item', {
    connectionId, connectionRevision: 7, toolName: 'search', schemaHash, arguments: {},
  }, { ...context, now: now + 1 })
  const pending = commissionMcpRegistryCapacity(registry.snapshot())
  const pendingClaim = registry.snapshot().claims[0]
  const pendingClaimNodes = countNodes(pendingClaim)
  const pendingClaimBytes = Buffer.byteLength(JSON.stringify(pendingClaim), 'utf8')
  const terminal = registry.settleEffect('project-a', 'effect-headroom-item', {
    status: 'done', summary: 'complete', result: { resultType: 'complete', content: [{ type: 'text', text: 'receipt' }], isError: false },
  }, now + 2)
  assert.equal(terminal.phase, 'effect')
  const settled = commissionMcpRegistryCapacity(registry.snapshot())
  assert.ok(settled.bytes > pending.bytes)
  assert.equal(settled.reservedBytes, pending.reservedBytes - Math.max(0, 1_572_864 - pendingClaimBytes))
  assert.equal(settled.reservedNodes, pending.reservedNodes - Math.max(0, 150_000 - pendingClaimNodes))
})

test('admission stops before settlement, revoke, recovery, or retirement capacity is consumed', () => {
  const registry = new CommissionMcpRegistry()
  const firstGrant = registry.approve(scope, intent, context)
  const secondScope: CommissionMcpScope = { ...scope, commissionId: 'commission-pending', agentId: 'agent-pending' }
  const secondIntent = approvalIntent(secondScope)
  const secondGrant = registry.approve(secondScope, secondIntent, context)
  const fixed = { review: { configurationRevision: 4, reviewHash }, now, connection: context.connection }
  registry.reserve({ permission: firstGrant, work: work('near-limit-effect'), tool, ...fixed })
  registry.reserve({ permission: secondGrant, work: work('near-limit-pending'), tool, ...fixed })

  const scopes: CommissionMcpScope[] = [scope, secondScope]
  let refused = false
  for (let index = 0; index < 300; index += 1) {
    const candidate = { ...scope, commissionId: `commission-capacity-${index}`, agentId: `agent-capacity-${index}` }
    const before = registry.snapshot()
    try {
      registry.approve(candidate, approvalIntent(candidate), context)
      scopes.push(candidate)
    } catch (error) {
      assert.ok(error instanceof CommissionMcpPolicyError)
      assert.equal(error.code, 'limit')
      assert.deepEqual(registry.snapshot(), before, 'a refused approval must leave the registry unchanged')
      refused = true
      break
    }
  }
  assert.equal(refused, true, 'conservative capacity must refuse an approval within the bounded loop')
  const beforeTerminal = commissionMcpRegistryCapacity(registry.snapshot())
  assert.ok(beforeTerminal.availableBytes >= 0)
  assert.ok(beforeTerminal.availableNodes >= 0)
  assert.ok(beforeTerminal.availableNodes < 20_032, 'the next approval would exceed its policy, receipt, and retirement node reserve')

  const result = { resultType: 'complete' as const, content: [{ type: 'text' as const, text: 'r'.repeat(128_000) }], isError: false }
  registry.beginEffect('project-a', 'near-limit-effect', {
    connectionId, connectionRevision: 7, toolName: 'search', schemaHash, arguments: {},
  }, { ...context, now: now + 1 })
  const settled = registry.settleEffect('project-a', 'near-limit-effect', {
    status: 'done', summary: 'complete', result,
  }, now + 2)
  assert.equal(settled.phase, 'effect')
  if (settled.phase === 'effect') {
    assert.equal(settled.attempt.status, 'done')
    assert.equal(settled.attempt.result?.content[0]?.text.length, 128_000)
  }

  const revoke: CommissionMcpDecisionRequest = { requestId: 'near-capacity-revoke', action: 'revoke', expectedRevision: 1 }
  assert.equal(registry.decide(scope, revoke, { ...context, now: now + 3 }).policyRevision, 2)
  assert.equal(registry.recover(now + 4), true, 'the second pending claim must still be recoverable')
  const recovered = registry.claim('project-a', 'near-limit-pending')
  assert.equal(recovered?.phase, 'closed')
  if (recovered?.phase === 'closed') assert.equal(recovered.status, 'uncertain')
  assert.equal(registry.recover(now + 5), false)

  for (const commissionId of [...new Set(scopes.map(row => row.commissionId))]) {
    assert.equal(registry.retireCommission(commissionId, now + 6), true, `retire ${commissionId} near capacity`)
  }
})

function countNodes(value: unknown): number {
  let count = 0
  const pending = [value]
  while (pending.length) {
    const current = pending.pop()
    count += 1
    if (current !== null && typeof current === 'object') {
      for (const child of Array.isArray(current) ? current : Object.values(current)) pending.push(child)
    }
  }
  return count
}

function approvalIntent(current: CommissionMcpScope): CommissionMcpApprovalIntent {
  return { ...intent, execution: { ...intent.execution, agentId: current.agentId } }
}
