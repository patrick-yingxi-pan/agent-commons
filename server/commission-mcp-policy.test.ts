import assert from 'node:assert/strict'
import test from 'node:test'
import {
  COMMISSION_MCP_MAX_LIFETIME_MS, COMMISSION_MCP_MAX_TOOLS, COMMISSION_MCP_MAX_WORK_ITEMS,
  type CommissionMcpApprovalIntent,
} from '../contract/commissionMcp.ts'
import type { McpBoundToolCall, McpToolPermission } from '../contract/mcpExecution.ts'
import type { McpConnectionView } from '../contract/mcpConnections.ts'
import {
  approveCommissionMcpPolicy, commissionMcpCallPermitted, CommissionMcpPolicyError,
  parseCommissionMcpPolicy, revokeCommissionMcpPolicy, type CommissionMcpScope, type StoredCommissionMcpPolicy,
} from './commissionMcpPolicy.ts'
import { mcpToolSchemaHash } from './mcpToolAdmission.ts'
import { approveRoutineMcpPolicy } from './routineMcpPolicy.ts'
import type { RoutineMcpApprovalIntent } from '../contract/routineMcp.ts'

const tenantId = 'tenant-owner'
const ownerUserId = 'person-owner'
const projectId = 'project-shared'
const commissionId = 'commission-exact'
const agentId = 'agent-exact'
const connectionId = 'mcp-connection-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const now = 1_800_000_000_000
const reviewHash = 'c'.repeat(64)
const tool = { name: 'search', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, additionalProperties: true } }
const schemaHash = mcpToolSchemaHash(tool)
const scope: CommissionMcpScope = { tenantId, ownerUserId, projectId, commissionId, agentId }

function permission(fixedArguments: Record<string, unknown> = {}, toolName = tool.name, schema = tool) {
  return { connectionId, connectionRevision: 7, toolName, schemaHash: mcpToolSchemaHash(schema), fixedArguments } as McpToolPermission
}

function connection(overrides: Partial<McpConnectionView> = {}): McpConnectionView {
  return {
    id: connectionId, label: 'Reviewed peer', status: 'connected', revision: 7,
    authentication: 'none', protocolVersion: '2026-07-28', inspectedAt: now,
    tools: [tool], execution: 'approval-required', executableTools: ['search'], ...overrides,
  }
}

function reader(row: McpConnectionView = connection()) {
  return (id: string, tenant: string, person: string) =>
    id === row.id && tenant === tenantId && person === ownerUserId ? row : undefined
}

function intent(overrides: Partial<CommissionMcpApprovalIntent> = {}): CommissionMcpApprovalIntent {
  return {
    expectedRevision: 0, expectedConfigurationRevision: 4, reviewHash,
    execution: { agentId, providerId: 'provider-owned', modelId: 'model-owned' },
    expiresAt: now + 60_000, maxWorkItems: 3, tools: [permission()], ...overrides,
  }
}

function approve(input = intent(), current?: StoredCommissionMcpPolicy, conn = reader(), live = { configurationRevision: 4, reviewHash }) {
  return approveCommissionMcpPolicy(scope, current, live, input, now, conn)
}

function call(arguments_: Record<string, unknown> = {}): McpBoundToolCall {
  return { connectionId, connectionRevision: 7, toolName: 'search', schemaHash, arguments: arguments_ as McpBoundToolCall['arguments'] }
}

function errorCode(fn: () => unknown, code: CommissionMcpPolicyError['code']): void {
  assert.throws(fn, (error: unknown) => error instanceof CommissionMcpPolicyError && error.code === code)
}

test('fresh approval is strictly scoped, detached, and invokes the exact owner connection reader', () => {
  const reads: unknown[][] = []
  const fixed = { filter: { region: 'north', flags: [true, null] }, query: 'otters' }
  const approved = approve(intent({ tools: [permission(fixed)] }), undefined, (id, tenant, person) => {
    reads.push([id, tenant, person])
    return connection()
  })
  fixed.filter.region = 'changed'
  assert.deepEqual(approved, {
    ...scope,
    policy: { version: 1, revision: 1, approval: {
      configurationRevision: 4, reviewHash,
      execution: { agentId, providerId: 'provider-owned', modelId: 'model-owned' },
      approvedAt: now, expiresAt: now + 60_000, maxWorkItems: 3,
      tools: [permission({ filter: { region: 'north', flags: [true, null] }, query: 'otters' })],
    } },
  })
  assert.deepEqual(reads, [[connectionId, tenantId, ownerUserId]])
})

test('present state is closed, detached and rejects accessors without invoking getters or reflecting secrets', () => {
  const base = approve()
  const detached = parseCommissionMcpPolicy(base)
  assert.notEqual(detached.policy, base.policy)
  assert.deepEqual(detached, base)

  let getterCalls = 0
  const bad = { ...scope, policy: { version: 1, revision: 1, approval: null } }
  Object.defineProperty(bad, 'projectId', { enumerable: true, get() { getterCalls += 1; throw new Error('secret-value') } })
  assert.throws(() => parseCommissionMcpPolicy(bad), (error: unknown) => {
    assert.ok(error instanceof CommissionMcpPolicyError)
    assert.doesNotMatch(error.message, /secret-value/)
    return true
  })
  assert.equal(getterCalls, 0)

  const hostileIntent = { ...intent() }
  Object.defineProperty(hostileIntent, 'tools', { enumerable: true, get() { getterCalls += 1; throw new Error('secret-value') } })
  assert.throws(() => approveCommissionMcpPolicy(scope, undefined,
    { configurationRevision: 4, reviewHash }, hostileIntent as unknown as CommissionMcpApprovalIntent, now, reader()), (error: unknown) => {
    assert.ok(error instanceof CommissionMcpPolicyError)
    assert.doesNotMatch(error.message, /secret-value/)
    return true
  })
  assert.equal(getterCalls, 0)

  for (const malformed of [
    undefined, null, 1, new Date(), { ...base, standing: true },
    { ...base, policy: { ...base.policy, routineId: 'routine-a' } },
    { ...base, scope: { ...scope, secret: 'secret-value' } },
  ]) assert.throws(() => parseCommissionMcpPolicy(malformed), CommissionMcpPolicyError)
})

test('legacy standing fields and Routine-scoped grants cannot become Commission permissions', () => {
  const legacy = { ...scope, standing: true }
  assert.throws(() => parseCommissionMcpPolicy(legacy), CommissionMcpPolicyError)
  const routineScope = { tenantId, routineId: 'routine-a' }
  const routineIntent: RoutineMcpApprovalIntent = {
    expectedRevision: 0, expectedDefinitionRevision: 4, reviewHash, expiresAt: now + 60_000,
    maxCallsPerRun: 1, tools: [permission()],
  }
  const routinePolicy = approveRoutineMcpPolicy(routineScope, undefined, 4, routineIntent, now,
    (id, tenant) => id === connectionId && tenant === tenantId ? connection() : undefined)
  assert.throws(() => parseCommissionMcpPolicy(routinePolicy), CommissionMcpPolicyError)
  assert.throws(() => approveCommissionMcpPolicy(
    { ...scope, standing: true } as CommissionMcpScope, undefined,
    { configurationRevision: 4, reviewHash }, intent(), now, reader(),
  ), CommissionMcpPolicyError)
})

test('approval binds the exact Agent and scope plus expected policy/configuration revisions', () => {
  assert.throws(() => approveCommissionMcpPolicy(scope, undefined,
    { configurationRevision: 4, reviewHash }, intent({ execution: { ...intent().execution, agentId: 'other-agent' } }), now, reader()),
  CommissionMcpPolicyError)

  const first = approve()
  assert.equal(first.policy.revision, 1)
  const replacement = approve(intent({ expectedRevision: 1 }), first)
  assert.equal(replacement.policy.revision, 2)
  errorCode(() => approve(intent({ expectedRevision: 1 })), 'stale')
  errorCode(() => approve(intent({ expectedConfigurationRevision: 3 })), 'stale')
  errorCode(() => approve(intent({ reviewHash: 'd'.repeat(64) }), first), 'stale')
  errorCode(() => approve(intent(), { ...first, projectId: 'other-project' }), 'stale')
  errorCode(() => approve(intent(), first, reader(), { configurationRevision: 5, reviewHash }), 'stale')
})

test('approval bounds lifetime, work count, tool count, and duplicate tool identities', () => {
  assert.equal(COMMISSION_MCP_MAX_TOOLS, 16)
  assert.equal(COMMISSION_MCP_MAX_WORK_ITEMS, 100)
  assert.equal(COMMISSION_MCP_MAX_LIFETIME_MS, 30 * 24 * 60 * 60 * 1000)
  assert.ok(approve(intent({ maxWorkItems: 100, expiresAt: now + COMMISSION_MCP_MAX_LIFETIME_MS })).policy.approval)
  for (const bad of [
    intent({ maxWorkItems: 0 }), intent({ maxWorkItems: 101 }),
    intent({ expiresAt: now }), intent({ expiresAt: now + COMMISSION_MCP_MAX_LIFETIME_MS + 1 }),
    intent({ tools: [] }),
    intent({ tools: Array.from({ length: 17 }, (_, index) => {
      const candidate = { ...tool, name: `search_${index}` }
      return permission({}, candidate.name, candidate)
    }) }),
    intent({ tools: [permission(), permission()] }),
  ]) errorCode(() => approve(bad), 'invalid')
})

test('approval requires one exact connected HTTP tool, schema, revision, auth mode, and owner reader', () => {
  const changedSchema = { ...tool, inputSchema: { type: 'object', properties: { q: { type: 'number' } } } }
  const invalidViews: McpConnectionView[] = [
    connection({ revision: 8 }),
    connection({ status: 'disconnected' }),
    connection({ execution: 'unavailable' }),
    connection({ executableTools: [] }),
    connection({ tools: [changedSchema] }),
    connection({ tools: [tool, tool] }),
    { ...connection(), transport: 'stdio', authentication: undefined } as unknown as McpConnectionView,
    { ...connection(), authentication: 'unsupported' } as unknown as McpConnectionView,
  ]
  for (const view of invalidViews) errorCode(() => approve(intent(), undefined, reader(view)), 'unavailable')
  errorCode(() => approve(intent(), undefined, (id, tenant, person) => id === connectionId && tenant === tenantId && person === ownerUserId ? undefined : connection()), 'unavailable')
})

test('call permission is a frozen/live exact intersection with half-open expiry', () => {
  const current = approve(intent({ expiresAt: now + 2_000 }))
  const frozen = structuredClone(current)
  const allowed = (timestamp: number, candidate = call(), live = current, review = { configurationRevision: 4, reviewHash }) =>
    commissionMcpCallPermitted(frozen, live, review, candidate, timestamp, reader())
  assert.equal(allowed(now), true)
  assert.equal(allowed(now + 1_999), true)
  assert.equal(allowed(now + 2_000), false)
  assert.equal(allowed(now - 1), false)
  assert.equal(allowed(now, call(), current, { configurationRevision: 5, reviewHash }), false)
  assert.equal(allowed(now, call(), current, { configurationRevision: 4, reviewHash: 'd'.repeat(64) }), false)
  assert.equal(allowed(now, { ...call(), connectionRevision: 8 }), false)
  assert.equal(allowed(now, { ...call(), schemaHash: 'e'.repeat(64) }), false)
  assert.equal(allowed(now, { ...call(), toolName: 'other' }), false)
  assert.equal(commissionMcpCallPermitted(frozen, undefined, { configurationRevision: 4, reviewHash }, call(), now, reader()), false)
  assert.equal(commissionMcpCallPermitted(frozen, revokeCommissionMcpPolicy(current, 1),
    { configurationRevision: 4, reviewHash }, call(), now, reader()), false)
})

test('fixed nested arguments compare exactly and prototype-like keys remain inert', () => {
  const nested = approve(intent({ tools: [permission({
    query: 'otters', filter: { region: 'north', flags: [true, null, { level: 2 }] },
  })] }))
  const matches = (args: Record<string, unknown>) => commissionMcpCallPermitted(nested, nested,
    { configurationRevision: 4, reviewHash }, call(args), now, reader())
  assert.equal(matches({ filter: { flags: [true, null, { level: 2 }], region: 'north' }, query: 'otters', extra: 4 }), true)
  assert.equal(matches({ filter: { flags: [true, { level: 2 }, null], region: 'north' }, query: 'otters' }), false)
  assert.equal(matches({ filter: { flags: [true, null, { level: 3 }], region: 'north' }, query: 'otters' }), false)
  assert.equal(matches({ filter: { flags: [true, null, { level: 2 }], region: 'north' } }), false)

  const fixed = Object.create(null) as Record<string, unknown>
  Object.defineProperty(fixed, '__proto__', { value: { constructor: null }, enumerable: true, writable: true, configurable: true })
  fixed.constructor = null
  const policy = approve(intent({ tools: [permission(fixed)] }))
  const same = Object.create(null) as Record<string, unknown>
  Object.defineProperty(same, '__proto__', { value: { constructor: null }, enumerable: true, writable: true, configurable: true })
  same.constructor = null
  const canCall = (args: Record<string, unknown>) => commissionMcpCallPermitted(policy, policy,
    { configurationRevision: 4, reviewHash }, call(args), now, reader())
  assert.equal(canCall(same), true)
  const changed = Object.create(null) as Record<string, unknown>
  Object.defineProperty(changed, '__proto__', { value: { constructor: 'null' }, enumerable: true, writable: true, configurable: true })
  changed.constructor = null
  assert.equal(canCall(changed), false)
})

test('revocation and replacement invalidate frozen grants without automatic renewal', () => {
  const frozen = approve()
  const revoked = revokeCommissionMcpPolicy(frozen, 1)
  assert.equal(revoked.policy.revision, 2)
  assert.equal(revoked.policy.approval, null)
  assert.equal(commissionMcpCallPermitted(frozen, revoked, { configurationRevision: 4, reviewHash }, call(), now, reader()), false)
  errorCode(() => revokeCommissionMcpPolicy(frozen, 0), 'stale')
  const reapproved = approve(intent({ expectedRevision: 2 }), revoked)
  assert.equal(reapproved.policy.revision, 3)
  assert.equal(commissionMcpCallPermitted(frozen, reapproved, { configurationRevision: 4, reviewHash }, call(), now, reader()), false)
  const changedConfig = approve(intent({ expectedRevision: 1, expectedConfigurationRevision: 5, reviewHash: 'd'.repeat(64) }), frozen,
    reader(), { configurationRevision: 5, reviewHash: 'd'.repeat(64) })
  assert.equal(commissionMcpCallPermitted(frozen, changedConfig, { configurationRevision: 5, reviewHash: 'd'.repeat(64) }, call(), now, reader()), false)
})

test('policy revision overflow refuses approval and revocation', () => {
  const maxRevision = Number.MAX_SAFE_INTEGER
  const current = parseCommissionMcpPolicy({
    ...scope, policy: { version: 1, revision: maxRevision, approval: null },
  })
  errorCode(() => approve(intent({ expectedRevision: maxRevision }), current), 'limit')
  const active = parseCommissionMcpPolicy({ ...approve(), policy: { ...approve().policy, revision: maxRevision } })
  errorCode(() => revokeCommissionMcpPolicy(active, maxRevision), 'limit')
})
