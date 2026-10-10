import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import type { ScheduledTask } from '../contract/cowork.ts'
import type { RoutineMcpApprovalIntent } from '../contract/routineMcp.ts'
import type { McpConnectionView } from '../contract/mcpConnections.ts'
import {
  ROUTINE_MCP_MAX_DECISIONS_PER_ROUTINE,
  RoutineMcpRegistry,
  parseRoutineMcpRegistryState,
  validateRoutineMcpRegistryJoins,
  type RoutineMcpDecisionRequest,
  type RoutineMcpRegistryState,
} from './routineMcpRegistry.ts'
import { RoutineMcpPolicyError } from './routineMcpPolicy.ts'
import { mcpToolSchemaHash } from './mcpToolAdmission.ts'
import { createRoutineMcpRun, reserveRoutineMcpCall } from './routineMcpState.ts'

const tenantId = 'tenant-a'
const routineId = 'routine-a'
const connectionId = 'mcp-connection-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const now = 1_800_000_000_000
const reviewHash = 'a'.repeat(64)
const tool = { name: 'search', inputSchema: { type: 'object', properties: {}, additionalProperties: true } }
const schemaHash = mcpToolSchemaHash(tool)

function connection(): McpConnectionView {
  return {
    id: connectionId, label: 'Reviewed MCP', status: 'connected', revision: 7,
    authentication: 'none', protocolVersion: '2026-07-28', inspectedAt: now,
    tools: [tool], execution: 'approval-required', executableTools: ['search'],
  }
}

const connectionReader = (id: string, owner: string) => id === connectionId && owner === tenantId ? connection() : undefined

function approval(overrides: Partial<RoutineMcpApprovalIntent> = {}): RoutineMcpApprovalIntent {
  return {
    expectedRevision: 0, expectedDefinitionRevision: 4, reviewHash,
    expiresAt: now + 60_000, maxCallsPerRun: 3,
    tools: [{ connectionId, connectionRevision: 7, toolName: 'search', schemaHash, fixedArguments: {} }],
    ...overrides,
  }
}

function approveRequest(requestId: string, intent = approval()): RoutineMcpDecisionRequest {
  return { requestId, action: 'approve', approval: intent }
}

function decide(registry: RoutineMcpRegistry, request: RoutineMcpDecisionRequest, overrides: { definitionRevision?: number; reviewHash?: string } = {}) {
  return registry.decide({ tenantId, routineId }, request, {
    definitionRevision: overrides.definitionRevision ?? 4,
    reviewHash: overrides.reviewHash ?? reviewHash,
    now,
    connection: connectionReader,
  })
}

function task(runIds: Array<{ id: string; definitionRevision: number }>, owner = tenantId): ScheduledTask {
  return {
    id: routineId, tenantId: owner, revision: 4, name: 'Routine', cadence: 'daily', next: 'tomorrow', enabled: true,
    lastStatus: 'ok', subtitle: '', trigger: '', prompt: '', steps: [], delivery: { tool: { id: 'x', label: 'x', tone: 'connector' }, target: '' },
    runs: runIds.map(({ id, definitionRevision }) => ({
      id, status: 'running', duration: '—', reachedStep: 0, summary: '', at: now,
      execution: { definitionRevision, trigger: '', prompt: '', steps: [], delivery: { tool: { id: 'x', label: 'x', tone: 'connector' }, target: '' }, agentId: 'agent-a', providerId: 'provider-a' },
    })), model: '',
  } as ScheduledTask
}

function catchesCode(fn: () => unknown, code: RoutineMcpPolicyError['code']): void {
  assert.throws(fn, (error: unknown) => error instanceof RoutineMcpPolicyError && error.code === code)
}

test('registry snapshot, replace, and strict parsing detach and reject malformed joins/shapes', () => {
  const registry = new RoutineMcpRegistry()
  const created = decide(registry, approveRequest('approval-1'))
  const snapshot = registry.snapshot()
  assert.equal(snapshot.policies[0]?.policy.revision, 1)
  snapshot.policies[0]!.policy.approval!.tools[0]!.toolName = 'mutated'
  assert.equal(registry.policy(tenantId, routineId)?.policy.approval?.tools[0]?.toolName, 'search')

  assert.deepEqual(parseRoutineMcpRegistryState(registry.snapshot()), registry.snapshot())
  for (const malformed of [
    { ...registry.snapshot(), extra: true },
    { ...registry.snapshot(), policies: [registry.snapshot().policies[0], registry.snapshot().policies[0]] },
    { ...registry.snapshot(), decisions: [{ ...registry.snapshot().decisions[0], requestId: 'raw-secret-key' }] },
  ]) assert.throws(() => parseRoutineMcpRegistryState(malformed), RoutineMcpPolicyError)

  const changed = structuredClone(registry.snapshot()) as RoutineMcpRegistryState
  changed.decisions[0]!.policyRevision = 2
  assert.throws(() => registry.replace(changed), RoutineMcpPolicyError)
  assert.equal(created.replayed, false)
})

test('a current approval requires its exact approve decision; emergency suspension remains valid', () => {
  const registry = new RoutineMcpRegistry()
  decide(registry, approveRequest('approval-proof'))
  const approved = registry.snapshot()
  assert.equal(parseRoutineMcpRegistryState(approved).policies[0]?.policy.approval?.reviewHash, reviewHash)

  const missingReceipt = structuredClone(approved)
  missingReceipt.decisions = []
  assert.throws(() => parseRoutineMcpRegistryState(missingReceipt), RoutineMcpPolicyError)
  assert.equal(validateRoutineMcpRegistryJoins(missingReceipt, [task([])], tenantId), false)

  const mismatchedReceipt = structuredClone(approved)
  mismatchedReceipt.decisions[0]!.action = 'revoke'
  assert.throws(() => parseRoutineMcpRegistryState(mismatchedReceipt), RoutineMcpPolicyError)

  registry.suspend(tenantId, routineId)
  const suspended = registry.snapshot()
  assert.equal(suspended.policies[0]?.policy.approval, null)
  assert.equal(suspended.policies[0]?.policy.revision, 2)
  assert.equal(suspended.decisions[0]?.policyRevision, 1,
    'emergency suspension advances policy revision without minting an owner decision')
  assert.deepEqual(parseRoutineMcpRegistryState(suspended), suspended)
})

test('decision replay is exact, precedes live gates, returns current truth, and never revives revoked approval', () => {
  const registry = new RoutineMcpRegistry()
  const original = approveRequest('owner-key')
  const first = decide(registry, original)
  assert.equal(first.policy.revision, 1)
  const replay = registry.decide({ tenantId, routineId }, original, {
    definitionRevision: 999, reviewHash: 'b'.repeat(64), now: now + 999_999,
    connection: () => undefined,
  })
  assert.equal(replay.replayed, true)
  assert.deepEqual(replay.policy, registry.policy(tenantId, routineId)?.policy)

  catchesCode(() => decide(registry, approveRequest('owner-key', approval({ maxCallsPerRun: 1 }))), 'stale')
  const revoked = decide(registry, { requestId: 'revoke-key', action: 'revoke', expectedRevision: 1 })
  assert.equal(revoked.policy.approval, null)
  assert.equal(registry.decide({ tenantId, routineId }, original, {
    definitionRevision: 999, reviewHash: 'b'.repeat(64), now: now + 999_999, connection: () => undefined,
  }).policy.revision, 2)

  const reapproval = decide(registry, approveRequest('approval-2', approval({ expectedRevision: 2 })))
  assert.equal(reapproval.policy.revision, 3)
  catchesCode(() => decide(registry, approveRequest('stale-hash', approval()), { reviewHash: 'b'.repeat(64) }), 'stale')
})

test('queued old permission remains frozen across reapproval; queue collisions are exact', () => {
  const registry = new RoutineMcpRegistry()
  decide(registry, approveRequest('approval-1'))
  const oldPermission = registry.policy(tenantId, routineId)!
  const queued = registry.queue(oldPermission, 'run-a')
  assert.equal(registry.queue(oldPermission, 'run-a').permissionHash, queued.permissionHash)

  decide(registry, { requestId: 'revoke', action: 'revoke', expectedRevision: 1 })
  decide(registry, approveRequest('approval-2', approval({ expectedRevision: 2 })))
  const newPermission = registry.policy(tenantId, routineId)!
  catchesCode(() => registry.queue(oldPermission, 'run-b'), 'stale')
  catchesCode(() => registry.queue(newPermission, 'run-a'), 'stale')
  assert.equal(registry.run(tenantId, routineId, 'run-a')?.permission.policy.revision, 1)
  assert.equal(registry.policy(tenantId, routineId)?.policy.revision, 3)
})

test('pending work prevents routine deletion; settled or absent work can be pruned', () => {
  const registry = new RoutineMcpRegistry()
  decide(registry, approveRequest('approval-1'))
  const permission = registry.policy(tenantId, routineId)!
  const queued = registry.queue(permission, 'run-a')
  const reserved = reserveRoutineMcpCall(queued, {
    key: 'call-key',
    call: { connectionId, connectionRevision: 7, toolName: 'search', schemaHash, arguments: {} },
    live: permission, definitionRevision: 4, reviewHash, now: now + 1, connection: connectionReader,
  })
  registry.setRun(reserved.run)
  catchesCode(() => registry.removeRoutine(tenantId, routineId), 'denied')
  catchesCode(() => registry.setRun(queued), 'stale')
  registry.retainRuns(tenantId, routineId, new Set())
  registry.removeRoutine(tenantId, routineId)
  assert.equal(registry.policy(tenantId, routineId), undefined)
  assert.equal(registry.snapshot().decisions.length, 0)
})

test('registry join validation rejects orphan, foreign-owner, legacy-run, and mismatched execution revisions', () => {
  const registry = new RoutineMcpRegistry()
  decide(registry, approveRequest('approval-1'))
  registry.queue(registry.policy(tenantId, routineId)!, 'run-a')
  const state = registry.snapshot()
  assert.equal(validateRoutineMcpRegistryJoins(state, [task([{ id: 'run-a', definitionRevision: 4 }])], 'default'), true)
  assert.equal(validateRoutineMcpRegistryJoins(state, [], 'default'), false)
  assert.equal(validateRoutineMcpRegistryJoins(state, [task([{ id: 'run-a', definitionRevision: 4 }], 'tenant-b')], 'default'), false)
  assert.equal(validateRoutineMcpRegistryJoins(state, [task([{ id: 'other-run', definitionRevision: 4 }])], 'default'), false)
  assert.equal(validateRoutineMcpRegistryJoins(state, [task([{ id: 'run-a', definitionRevision: 5 }])], 'default'), false)

  assert.equal(validateRoutineMcpRegistryJoins(state, [task([
    { id: 'run-a', definitionRevision: 4 }, { id: 'run-a', definitionRevision: 5 },
  ])], 'default'), false, 'a private ledger must join exactly one ScheduledRun, not the first duplicate id')

  const legacy = task([{ id: 'run-a', definitionRevision: 4 }])
  delete (legacy.runs[0] as { execution?: unknown }).execution
  assert.equal(validateRoutineMcpRegistryJoins(state, [legacy], 'default'), false)

  const interruptedState = structuredClone(state)
  interruptedState.runs[0]!.phase = 'interrupted'
  assert.equal(validateRoutineMcpRegistryJoins(interruptedState, [task([{ id: 'run-a', definitionRevision: 4 }])], 'default'), false)

  const current = registry.policy(tenantId, routineId)!
  const changedAtSameRevision = structuredClone(current)
  changedAtSameRevision.policy.approval!.reviewHash = 'b'.repeat(64)
  const counterfeit = createRoutineMcpRun(changedAtSameRevision, 'run-a')
  const sameRevisionState = { ...state, runs: [counterfeit] }
  assert.equal(validateRoutineMcpRegistryJoins(sameRevisionState, [task([{ id: 'run-a', definitionRevision: 4 }])], 'default'), false)
  const unstamped = task([{ id: 'run-a', definitionRevision: 4 }])
  delete unstamped.tenantId
  assert.equal(validateRoutineMcpRegistryJoins(state, [unstamped]), true,
    'without a default tenant, only the unresolved tenant comparison is deferred')
  assert.equal(validateRoutineMcpRegistryJoins(state, [unstamped], 'tenant-a'), true)
  assert.equal(validateRoutineMcpRegistryJoins(state, [unstamped], 'tenant-b'), false)
  assert.equal(validateRoutineMcpRegistryJoins(state, [unstamped, structuredClone(unstamped)]), false,
    'an unresolved task id must still uniquely identify one actual Routine')
})

test('decision history has a bounded per-routine ceiling and legacy absence is empty', () => {
  assert.deepEqual(parseRoutineMcpRegistryState({ policies: [], runs: [], decisions: [] }), { policies: [], runs: [], decisions: [] })
  assert.equal(ROUTINE_MCP_MAX_DECISIONS_PER_ROUTINE, 256)
  const registry = new RoutineMcpRegistry()
  decide(registry, approveRequest('approval-1'))
  for (let index = 1; index < ROUTINE_MCP_MAX_DECISIONS_PER_ROUTINE; index += 1) {
    const current = registry.policy(tenantId, routineId)!
    if (index % 2 === 1) decide(registry, { requestId: `revoke-${index}`, action: 'revoke', expectedRevision: current.policy.revision })
    else decide(registry, approveRequest(`approve-${index}`, approval({ expectedRevision: current.policy.revision })))
  }
  assert.equal(registry.snapshot().decisions.length, 256)
  const revision = registry.policy(tenantId, routineId)!.policy.revision
  catchesCode(() => decide(registry, { requestId: 'capacity', action: 'revoke', expectedRevision: revision }), 'limit')
})

test('decision cap reserves its final slot for revocation and exact replay remains available at capacity', () => {
  const registry = new RoutineMcpRegistry()
  const firstApproval = approveRequest('approval-1')
  decide(registry, firstApproval)
  for (let index = 1; index < ROUTINE_MCP_MAX_DECISIONS_PER_ROUTINE - 1; index += 1) {
    const current = registry.policy(tenantId, routineId)!
    if (index % 2 === 1) {
      decide(registry, { requestId: `revoke-${index}`, action: 'revoke', expectedRevision: current.policy.revision })
    } else {
      decide(registry, approveRequest(`approval-${index}`, approval({ expectedRevision: current.policy.revision })))
    }
  }
  assert.equal(registry.snapshot().decisions.length, 255)
  assert.ok(registry.policy(tenantId, routineId)?.policy.approval)
  const before = registry.policy(tenantId, routineId)!
  catchesCode(() => decide(registry, approveRequest('capacity-approval', approval({ expectedRevision: before.policy.revision }))), 'limit')
  assert.equal(registry.decide({ tenantId, routineId }, firstApproval, {
    definitionRevision: 999, reviewHash: 'b'.repeat(64), now: now + 999_999, connection: () => undefined,
  }).replayed, true)
  const fullApprovedHistory = structuredClone(registry.snapshot())
  const syntheticRequestId = 'synthetic-cap-entry'
  const syntheticIdHash = createHash('sha256').update(JSON.stringify([tenantId, routineId, syntheticRequestId])).digest('hex')
  fullApprovedHistory.decisions.push({
    decisionId: `routine-mcp-decision-${syntheticIdHash}`, tenantId, routineId,
    requestHash: 'c'.repeat(64), policyRevision: before.policy.revision, action: 'revoke',
  })
  assert.throws(() => parseRoutineMcpRegistryState(fullApprovedHistory), RoutineMcpPolicyError,
    'a full history cannot retain a current grant without room to revoke it')
  const revoked = decide(registry, { requestId: 'last-revoke', action: 'revoke', expectedRevision: before.policy.revision })
  assert.equal(revoked.policy.approval, null)
  assert.equal(registry.snapshot().decisions.length, 256)
  assert.deepEqual(parseRoutineMcpRegistryState(registry.snapshot()), registry.snapshot())
})
