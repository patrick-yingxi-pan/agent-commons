import assert from 'node:assert/strict'
import test from 'node:test'
import type { RoutineMcpApprovalIntent } from '../contract/routineMcp.ts'
import type { McpBoundToolCall } from '../contract/mcpExecution.ts'
import type { McpConnectionView } from '../contract/mcpConnections.ts'
import {
  RoutineMcpRegistry, parseRoutineMcpRegistryState, type RoutineMcpDecisionRequest,
} from './routineMcpRegistry.ts'
import { RoutineMcpPolicyError } from './routineMcpPolicy.ts'
import { mcpToolSchemaHash } from './mcpToolAdmission.ts'
import { interruptRoutineMcpRun, parseRoutineMcpRun, publicRoutineMcpReceipt, reserveRoutineMcpCall, settleRoutineMcpCall } from './routineMcpState.ts'

const tenantId = 'tenant-local-routine'
const routineId = 'routine-local-routine'
const ownerUserId = 'person-local-owner'
const managerUserId = 'person-routine-manager'
const httpId = `mcp-connection-${'a'.repeat(32)}`
const localId = `mcp-connection-${'b'.repeat(32)}`
const now = 1_800_000_000_000
const reviewHash = 'a'.repeat(64)
const httpTool = { name: 'search', inputSchema: { type: 'object', properties: {}, additionalProperties: true } }
const localTool = { name: 'write_local', inputSchema: { type: 'object', properties: {}, additionalProperties: true } }
const httpSchemaHash = mcpToolSchemaHash(httpTool)
const localSchemaHash = mcpToolSchemaHash(localTool)

function httpConnection(authentication: 'none' | 'device-oauth' = 'none'): McpConnectionView {
  return {
    id: httpId, label: 'Reviewed HTTP tool', status: 'connected', revision: 7,
    authentication, protocolVersion: '2026-07-28', inspectedAt: now,
    tools: [httpTool], execution: 'approval-required', executableTools: ['search'],
  }
}

function localConnection(): McpConnectionView {
  return {
    id: localId, label: 'Reviewed local tool', status: 'connected', revision: 3,
    transport: 'stdio', protocolVersion: '2026-07-28', inspectedAt: now,
    tools: [localTool], execution: 'approval-required', executableTools: ['write_local'],
  }
}

function permission(connectionId: string, connectionRevision: number, toolName: string, schemaHash: string) {
  return { connectionId, connectionRevision, toolName, schemaHash, fixedArguments: {} }
}

function intent(overrides: Record<string, unknown> = {}): RoutineMcpApprovalIntent {
  return {
    expectedRevision: 0, expectedDefinitionRevision: 4, reviewHash,
    expiresAt: now + 60_000, maxCallsPerRun: 3,
    tools: [permission(localId, 3, 'write_local', localSchemaHash)],
    localPrograms: true,
    ...overrides,
  } as RoutineMcpApprovalIntent
}

function request(requestId: string, approval: RoutineMcpApprovalIntent): RoutineMcpDecisionRequest {
  return { requestId, action: 'approve', approval }
}

function decide(
  registry: RoutineMcpRegistry,
  decision: RoutineMcpDecisionRequest,
  overrides: { actorUserId?: string; allowLocalPrograms?: boolean; connection?: (id: string, tenant: string, actor?: string) => McpConnectionView | undefined } = {},
) {
  const actor = overrides.actorUserId ?? ownerUserId
  const connection = overrides.connection ?? ((id: string, tenant: string, person?: string) =>
    tenant === tenantId && person === ownerUserId
      ? id === localId ? localConnection() : id === httpId ? httpConnection('device-oauth') : undefined
      : undefined)
  return registry.decide({ tenantId, routineId }, decision, {
    definitionRevision: 4, reviewHash, now, connection, actorUserId: actor,
    allowLocalPrograms: overrides.allowLocalPrograms,
  })
}

function catchesCode(fn: () => unknown, code: RoutineMcpPolicyError['code']): void {
  assert.throws(fn, (error: unknown) => error instanceof RoutineMcpPolicyError && error.code === code)
}

function localCall(): McpBoundToolCall {
  return { connectionId: localId, connectionRevision: 3, toolName: 'write_local', schemaHash: localSchemaHash, arguments: {} }
}

test('local program approval is explicit, host-gated, actor-bound, and replay cannot cross people', () => {
  const registry = new RoutineMcpRegistry()
  const approval = intent()

  catchesCode(() => decide(registry, request('local-denied-by-default', approval), { allowLocalPrograms: false }), 'unavailable')
  assert.equal(registry.policy(tenantId, routineId), undefined, 'a refused local review must not create policy or history')
  const implicitLocal = { ...approval } as unknown as Record<string, unknown>
  delete implicitLocal.localPrograms
  catchesCode(() => decide(registry, request('local-no-intent', implicitLocal as unknown as RoutineMcpApprovalIntent), {
    allowLocalPrograms: true,
  }), 'unavailable')
  assert.equal(registry.policy(tenantId, routineId), undefined,
    'trusted host capability cannot substitute for explicit localPrograms intent')

  const original = request('local-owner-approval', approval)
  let readerActor: string | undefined
  const accepted = decide(registry, original, {
    allowLocalPrograms: true,
    connection: (id, tenant, actor) => {
      readerActor = actor
      return tenant === tenantId && actor === ownerUserId && id === localId ? localConnection() : undefined
    },
  })
  assert.equal(readerActor, ownerUserId, 'approval resolves the inspected local connection in the approving person context')
  assert.equal(accepted.replayed, false)
  assert.equal(accepted.policy.approval?.localPrograms, true)
  const stored = registry.policy(tenantId, routineId)!
  assert.deepEqual(stored.localAuthority, { ownerUserId, connectionIds: [localId] })
  assert.equal(stored.oauthAuthority, undefined)

  catchesCode(() => decide(registry, original, { actorUserId: 'another-person', allowLocalPrograms: true }), 'denied')
  assert.equal(registry.snapshot().decisions.length, 1, 'foreign replay cannot append or alter a decision')

  const revoked = decide(registry, { requestId: 'manager-revokes-local', action: 'revoke', expectedRevision: 1 }, {
    actorUserId: managerUserId, allowLocalPrograms: true,
  })
  assert.equal(revoked.policy.approval, null)
  const history = registry.snapshot().decisions
  assert.equal(history.length, 2)
  assert.deepEqual(history[0]?.localAuthority, { ownerUserId, connectionIds: [localId] })
  assert.deepEqual(history[1]?.localAuthority, { ownerUserId, connectionIds: [localId] },
    'manager revocation records the retained grant provenance without claiming to own it')
  assert.equal(history[1]?.actorUserId, managerUserId)
  assert.equal(history[1]?.action, 'revoke')
})

test('mixed OAuth and local approval freezes sorted disjoint person-owned groups through replace and revoke', () => {
  const registry = new RoutineMcpRegistry()
  const both = intent({
    tools: [
      permission(localId, 3, 'write_local', localSchemaHash),
      permission(httpId, 7, 'search', httpSchemaHash),
    ],
  })
  decide(registry, request('mixed-approval-one', both), { allowLocalPrograms: true })
  const first = registry.policy(tenantId, routineId)!
  assert.deepEqual(first.localAuthority, { ownerUserId, connectionIds: [localId] })
  assert.deepEqual(first.oauthAuthority, { ownerUserId, connectionIds: [httpId] })

  const replacement = intent({
    expectedRevision: 1,
    maxCallsPerRun: 2,
    tools: [
      permission(httpId, 7, 'search', httpSchemaHash),
      permission(localId, 3, 'write_local', localSchemaHash),
    ],
  })
  decide(registry, request('mixed-approval-two', replacement), { allowLocalPrograms: true })
  const current = registry.policy(tenantId, routineId)!
  assert.equal(current.policy.revision, 2)
  assert.deepEqual(current.localAuthority, first.localAuthority)
  assert.deepEqual(current.oauthAuthority, first.oauthAuthority)

  decide(registry, { requestId: 'mixed-manager-revoke', action: 'revoke', expectedRevision: 2 }, {
    actorUserId: managerUserId, allowLocalPrograms: true,
  })
  const revoked = registry.policy(tenantId, routineId)!
  assert.equal(revoked.policy.approval, null)
  assert.deepEqual(revoked.localAuthority, first.localAuthority)
  assert.deepEqual(revoked.oauthAuthority, first.oauthAuthority)

  const history = registry.snapshot().decisions
  assert.equal(history.length, 3)
  assert.deepEqual(history.map(row => row.policyRevision), [1, 2, 3])
  assert.deepEqual(history.map(row => row.localAuthority?.connectionIds), [[localId], [localId], [localId]])
  assert.deepEqual(history.map(row => row.oauthAuthority?.connectionIds), [[httpId], [httpId], [httpId]])
  assert.deepEqual(parseRoutineMcpRegistryState(registry.snapshot()), registry.snapshot())
})

test('queued local calls refuse by default, require explicit host admission, and retain derived stdio receipts', () => {
  const registry = new RoutineMcpRegistry()
  decide(registry, request('local-run-approval', intent()), { allowLocalPrograms: true })
  const permission = registry.policy(tenantId, routineId)!
  const queued = registry.queue(permission, 'local-run-1')
  const call = localCall()
  const base = {
    key: 'local-call-1', call, live: permission, definitionRevision: 4, reviewHash, now: now + 1,
    connection: (id: string, tenant: string, person?: string) =>
      tenant === tenantId && person === ownerUserId && id === localId ? localConnection() : undefined,
  }

  catchesCode(() => reserveRoutineMcpCall(queued, base), 'denied')
  const reserved = reserveRoutineMcpCall(queued, { ...base, allowLocalPrograms: true })
  assert.equal(reserved.created, true)
  assert.equal(reserved.receipt.status, 'pending')
  assert.equal(reserved.receipt.transport, 'stdio')
  assert.equal(publicRoutineMcpReceipt(reserved.receipt).transport, 'stdio')

  const replay = reserveRoutineMcpCall(reserved.run, { ...base, allowLocalPrograms: true })
  assert.equal(replay.created, false)
  assert.deepEqual(replay.receipt, reserved.receipt)

  registry.queue(permission, 'local-run-1')
  registry.setRun(reserved.run)
  const removed = structuredClone(reserved.run)
  removed.calls = []
  catchesCode(() => registry.setRun(removed), 'stale')

  const forged = structuredClone(reserved.run) as unknown as { calls: Array<Record<string, unknown>> }
  forged.calls[0]!.transport = 'http'
  assert.throws(() => parseRoutineMcpRun(forged), RoutineMcpPolicyError,
    'the receipt transport is derived from the frozen local authority and cannot be changed')
})

test('local startup failures stop further calls and preserve local provenance through interruption', () => {
  const registry = new RoutineMcpRegistry()
  decide(registry, request('local-startup-failure', intent()), { allowLocalPrograms: true })
  const permission = registry.policy(tenantId, routineId)!
  const queued = registry.queue(permission, 'local-startup-run')
  const options = {
    key: 'startup-attempt', call: localCall(), live: permission, definitionRevision: 4, reviewHash, now: now + 1,
    allowLocalPrograms: true,
    connection: (id: string, tenant: string, person?: string) =>
      tenant === tenantId && person === ownerUserId && id === localId ? localConnection() : undefined,
  }
  const reserved = reserveRoutineMcpCall(queued, options)
  registry.setRun(reserved.run)
  const failed = settleRoutineMcpCall(reserved.run, reserved.receipt.id,
    { status: 'failed', summary: 'No tool result; startup may have had effects.' }, now + 2)
  registry.setRun(failed)
  assert.equal(failed.calls[0].transport, 'stdio')
  assert.equal(failed.calls[0].result, undefined)
  catchesCode(() => reserveRoutineMcpCall(failed, { ...options, key: 'unsafe-second-attempt' }), 'denied')
  const interrupted = interruptRoutineMcpRun(failed, now + 3)
  assert.deepEqual(interrupted.calls, failed.calls, 'known failures are not relabeled or stripped during recovery')
  registry.setRun(interrupted)
  assert.deepEqual(parseRoutineMcpRegistryState(registry.snapshot()), registry.snapshot())
})

test('legacy HTTP Routine reservations remain allowed without local opt-in or transport stamps', () => {
  const registry = new RoutineMcpRegistry()
  const httpIntent = intent({
    localPrograms: undefined,
    tools: [permission(httpId, 7, 'search', httpSchemaHash)],
  })
  delete (httpIntent as unknown as Record<string, unknown>).localPrograms
  decide(registry, request('legacy-http-approval', httpIntent), {
    connection: (id, tenant) => tenant === tenantId && id === httpId ? httpConnection('none') : undefined,
  })
  const policy = registry.policy(tenantId, routineId)!
  const queued = registry.queue(policy, 'http-run-1')
  const reserved = reserveRoutineMcpCall(queued, {
    key: 'http-call-1',
    call: { connectionId: httpId, connectionRevision: 7, toolName: 'search', schemaHash: httpSchemaHash, arguments: {} },
    live: policy, definitionRevision: 4, reviewHash, now: now + 1,
    connection: (id, tenant) => tenant === tenantId && id === httpId ? httpConnection('none') : undefined,
  })
  assert.equal(reserved.created, true)
  assert.equal(Object.hasOwn(reserved.receipt, 'transport'), false)
  assert.equal(parseRoutineMcpRun(reserved.run).calls[0]?.transport, undefined)

  const forged = structuredClone(reserved.run) as unknown as { calls: Array<Record<string, unknown>> }
  forged.calls[0]!.transport = 'stdio'
  assert.throws(() => parseRoutineMcpRun(forged), RoutineMcpPolicyError,
    'an HTTP receipt cannot claim local transport provenance')
})
