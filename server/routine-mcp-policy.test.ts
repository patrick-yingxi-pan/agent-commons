import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ROUTINE_MCP_MAX_CALLS, ROUTINE_MCP_MAX_LIFETIME_MS, ROUTINE_MCP_MAX_TOOLS,
  type RoutineMcpApprovalIntent, type RoutineMcpToolPermission,
} from '../contract/routineMcp.ts'
import type { McpBoundToolCall } from '../contract/mcpExecution.ts'
import type { McpConnectionView } from '../contract/mcpConnections.ts'
import {
  approveRoutineMcpPolicy, parseRoutineMcpOAuthAuthority, parseRoutineMcpPolicy, revokeRoutineMcpPolicy,
  routineMcpCallPermitted, RoutineMcpPolicyError, type StoredRoutineMcpPolicy,
} from './routineMcpPolicy.ts'
import { mcpToolSchemaHash } from './mcpToolAdmission.ts'

const tenantId = 'tenant-a'
const routineId = 'routine-a'
const connectionId = 'mcp-connection-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const now = 1_800_000_000_000
const reviewHash = 'c'.repeat(64)
const tool = { name: 'search', inputSchema: { type: 'object', properties: {}, additionalProperties: true } }
const schemaHash = mcpToolSchemaHash(tool)
const scope = { tenantId, routineId }

function permission(fixedArguments: Record<string, never | string | number | boolean | null | object> = {}, toolName = tool.name): RoutineMcpToolPermission {
  const definition = toolName === tool.name ? tool : { ...tool, name: toolName }
  return { connectionId, connectionRevision: 7, toolName, schemaHash: mcpToolSchemaHash(definition), fixedArguments: fixedArguments as RoutineMcpToolPermission['fixedArguments'] }
}

function connection(overrides: Partial<McpConnectionView> = {}): McpConnectionView {
  return {
    id: connectionId, label: 'Reviewed MCP', status: 'connected', revision: 7,
    authentication: 'none', protocolVersion: '2026-07-28', inspectedAt: now,
    tools: [tool], execution: 'approval-required', executableTools: ['search'], ...overrides,
  }
}

function reader(row: McpConnectionView = connection()) {
  return (id: string, owner: string) => id === row.id && owner === tenantId ? row : undefined
}

function intent(overrides: Partial<RoutineMcpApprovalIntent> = {}): RoutineMcpApprovalIntent {
  return {
    expectedRevision: 0, expectedDefinitionRevision: 4, reviewHash, expiresAt: now + 60_000,
    maxCallsPerRun: 3, tools: [permission()], ...overrides,
  }
}

function approve(input: RoutineMcpApprovalIntent = intent(), current?: StoredRoutineMcpPolicy, conn = reader()): StoredRoutineMcpPolicy {
  return approveRoutineMcpPolicy(scope, current, 4, input, now, conn)
}

function call(arguments_: Record<string, never | string | number | boolean | null | object> = {}): McpBoundToolCall {
  return { connectionId, connectionRevision: 7, toolName: 'search', schemaHash, arguments: arguments_ as McpBoundToolCall['arguments'] }
}

function errorCode(fn: () => unknown, code: RoutineMcpPolicyError['code']): void {
  assert.throws(fn, (error: unknown) => error instanceof RoutineMcpPolicyError && error.code === code)
}

test('policy parsing accepts only the closed JSON record shape and returns detached state', () => {
  const raw = {
    tenantId, routineId,
    policy: { version: 1, revision: 1, approval: {
      definitionRevision: 4, reviewHash, approvedAt: now, expiresAt: now + 10_000, maxCallsPerRun: 1,
      tools: [permission({ query: 'otters' })],
    } },
  }
  const parsed = parseRoutineMcpPolicy(raw)
  raw.policy.approval.tools[0].fixedArguments.query = 'changed'
  assert.deepEqual(parsed.policy.approval?.tools[0].fixedArguments, { query: 'otters' })

  for (const malformed of [
    { ...raw, extra: true },
    { ...raw, policy: { ...raw.policy, extra: true } },
    { ...raw, policy: { ...raw.policy, approval: { ...raw.policy.approval, extra: true } } },
    { ...raw, policy: { ...raw.policy, approval: { ...raw.policy.approval, reviewHash: 'C'.repeat(64) } } },
    { ...raw, policy: { ...raw.policy, approval: { ...raw.policy.approval, tools: [{ ...raw.policy.approval.tools[0], extra: true }] } } },
    { ...raw, tenantId: ' tenant-a' },
    { ...raw, policy: { ...raw.policy, revision: 0 } },
    { ...raw, policy: { ...raw.policy, revision: 1.5 } },
  ]) assert.throws(() => parseRoutineMcpPolicy(malformed), RoutineMcpPolicyError)

  let getterCalls = 0
  const accessor = { tenantId, routineId, policy: { version: 1, revision: 1, approval: null } }
  Object.defineProperty(accessor, 'routineId', { enumerable: true, get() { getterCalls += 1; return routineId } })
  assert.throws(() => parseRoutineMcpPolicy(accessor), RoutineMcpPolicyError)
  assert.equal(getterCalls, 0, 'accessors are rejected without invocation')
  for (const value of [undefined, 1n, Number.NaN, new Date(), Symbol('x')]) {
    assert.throws(() => parseRoutineMcpPolicy(value), RoutineMcpPolicyError)
  }
  const circular: Record<string, unknown> = { tenantId, routineId }
  circular.loop = circular
  assert.throws(() => parseRoutineMcpPolicy(circular), RoutineMcpPolicyError)
})

test('approval has strict tool, call-count, and lifetime bounds', () => {
  assert.equal(ROUTINE_MCP_MAX_TOOLS, 16)
  assert.equal(ROUTINE_MCP_MAX_CALLS, 20)
  assert.equal(ROUTINE_MCP_MAX_LIFETIME_MS, 30 * 24 * 60 * 60 * 1000)
  const manyTools = Array.from({ length: ROUTINE_MCP_MAX_TOOLS }, (_, i) => permission({ [`arg${i}`]: i }, `search_${i}`))
  const manyConnection = connection({ tools: manyTools.map((entry) => ({ ...tool, name: entry.toolName })), executableTools: manyTools.map((entry) => entry.toolName) })
  const manyReader = (id: string, owner: string) => id === connectionId && owner === tenantId ? manyConnection : undefined
  assert.equal(approve(intent({ tools: manyTools }), undefined, manyReader).policy.approval?.tools.length, 16)
  for (const bad of [
    intent({ tools: Array.from({ length: 17 }, (_, i) => permission({ [`arg${i}`]: i }, `search_${i}`)) }),
    intent({ maxCallsPerRun: 0 }), intent({ maxCallsPerRun: 21 }),
    intent({ expiresAt: now }), intent({ expiresAt: now + ROUTINE_MCP_MAX_LIFETIME_MS + 1 }),
    intent({ tools: [permission(), permission()] }),
    intent({ reviewHash: 'invalid' }),
    intent({ tools: [permission({ tooLarge: 'x'.repeat(50_000) })] }),
  ]) errorCode(() => approve(bad), 'invalid')
  assert.equal(approve(intent({ maxCallsPerRun: 20, expiresAt: now + ROUTINE_MCP_MAX_LIFETIME_MS })).policy.approval?.maxCallsPerRun, 20)
})

test('approval binds tenant, routine, policy revision, and exact definition revision', () => {
  const first = approve()
  assert.equal(first.tenantId, tenantId)
  assert.equal(first.routineId, routineId)
  assert.equal(first.policy.revision, 1)
  const replacement = approve(intent({ expectedRevision: 1 }), first)
  assert.equal(replacement.policy.revision, 2)

  errorCode(() => approve(intent({ expectedRevision: 1 })), 'stale')
  errorCode(() => approve(intent({ expectedDefinitionRevision: 5 })), 'stale')
  errorCode(() => approve(intent(), { ...first, tenantId: 'tenant-b' }), 'stale')
  errorCode(() => approve(intent(), { ...first, routineId: 'routine-b' }), 'stale')
  errorCode(() => approveRoutineMcpPolicy(scope, first, 5, intent({ expectedRevision: 1, expectedDefinitionRevision: 4 }), now, reader()), 'stale')
  errorCode(() => revokeRoutineMcpPolicy(first, 0), 'stale')
  assert.equal(revokeRoutineMcpPolicy(first, 1).policy.revision, 2)
})

test('approval requires the exact live tenant connection, revision, schema, status, and admitted tool', () => {
  const unavailable = [
    reader(connection({ revision: 8 })),
    reader(connection({ status: 'disconnected' })),
    reader(connection({ execution: 'unavailable' })),
    reader(connection({ executableTools: [] })),
    reader(connection({ tools: [{ ...tool, inputSchema: { type: 'object', properties: { q: { type: 'string' } } } }] })),
    (id: string, owner: string) => id === connectionId && owner === 'tenant-b' ? connection() : undefined,
    reader(connection({ tools: [tool, tool] })),
  ]
  for (const lookup of unavailable) errorCode(() => approve(intent(), undefined, lookup), 'unavailable')
})

test('call permission uses a half-open expiry interval and current exact bindings', () => {
  const stored = approve()
  const fixed = approve(intent({ expiresAt: now + 2_000 }))
  const frozen = structuredClone(fixed)
  const allowed = (timestamp: number, candidate = call(), liveHash = reviewHash) => routineMcpCallPermitted(frozen, fixed, 4, candidate, timestamp, reader(), liveHash)
  assert.equal(allowed(now), true, 'approvedAt is included')
  assert.equal(allowed(now + 1_999), true)
  assert.equal(allowed(now + 2_000), false, 'expiresAt is excluded')
  assert.equal(allowed(now - 1), false)
  assert.equal(allowed(now, call(), 'd'.repeat(64)), false, 'changed live context/output/audience invalidates approval')
  assert.equal(allowed(now, call(), 'not-a-hash'), false)
  assert.equal(routineMcpCallPermitted(frozen, fixed, 5, call(), now, reader(), reviewHash), false)
  assert.equal(routineMcpCallPermitted(frozen, fixed, 4, call({ q: 'x' }), now, reader(connection({ revision: 8 })), reviewHash), false)
  assert.equal(routineMcpCallPermitted(frozen, fixed, 4, call(), now, reader(connection({ status: 'disconnected' })), reviewHash), false)
  assert.equal(routineMcpCallPermitted(frozen, fixed, 4, { ...call(), schemaHash: 'b'.repeat(64) }, now, reader(), reviewHash), false)
  assert.ok(stored.policy.approval)
})

test('fixed top-level arguments compare nested JSON exactly, while object key order is irrelevant', () => {
  const fixed = approve(intent({ tools: [permission({ filter: { region: 'north', flags: [true, null, { level: 2 }] }, query: 'otters', nothing: null })] }))
  const frozen = structuredClone(fixed)
  const allowed = (arguments_: Record<string, never | string | number | boolean | null | object>) =>
    routineMcpCallPermitted(frozen, fixed, 4, call(arguments_), now, reader(), reviewHash)
  assert.equal(allowed({ query: 'otters', filter: { flags: [true, null, { level: 2 }], region: 'north' }, nothing: null, extra: 9 }), true)
  assert.equal(allowed({ query: 'otters', filter: { flags: [true, { level: 2 }, null], region: 'north' }, nothing: null }), false)
  assert.equal(allowed({ query: 'otters', filter: { flags: [true, null, { level: 3 }], region: 'north' }, nothing: null }), false)
  assert.equal(allowed({ query: 'otters', filter: { flags: [true, null, { level: 2 }], region: 'south' }, nothing: null }), false)
  assert.equal(allowed({ query: 'otters', filter: { flags: [true, null, { level: 2 }], region: 'north' } }), false)
})

test('prototype-like argument keys remain inert JSON keys and null is exact', () => {
  const fixedArgs = Object.create(null) as Record<string, never | string | number | boolean | null | object>
  Object.defineProperty(fixedArgs, '__proto__', { value: { constructor: null }, enumerable: true, writable: true, configurable: true })
  fixedArgs.constructor = null
  const fixed = approve(intent({ tools: [permission(fixedArgs)] }))
  const frozen = structuredClone(fixed)
  const same = Object.create(null) as Record<string, never | string | number | boolean | null | object>
  Object.defineProperty(same, '__proto__', { value: { constructor: null }, enumerable: true, writable: true, configurable: true })
  same.constructor = null
  assert.equal(routineMcpCallPermitted(frozen, fixed, 4, call(same), now, reader(), reviewHash), true)
  const changed = Object.create(null) as Record<string, never | string | number | boolean | null | object>
  Object.defineProperty(changed, '__proto__', { value: { constructor: 'null' }, enumerable: true, writable: true, configurable: true })
  changed.constructor = null
  assert.equal(routineMcpCallPermitted(frozen, fixed, 4, call(changed), now, reader(), reviewHash), false)
})

test('empty fixedArguments explicitly fixes nothing, but still requires the exact reviewed tool', () => {
  const fixed = approve()
  assert.equal(routineMcpCallPermitted(fixed, fixed, 4, call({ arbitrary: ['values', null] }), now, reader(), reviewHash), true)
  assert.equal(routineMcpCallPermitted(fixed, fixed, 4, { ...call(), toolName: 'other' }, now, reader(), reviewHash), false)
})

test('revisioned revocation and reapproval cannot rescue a frozen approval', () => {
  const frozen = approve()
  const revoked = revokeRoutineMcpPolicy(frozen, 1)
  assert.equal(revoked.policy.revision, 2)
  assert.equal(revoked.policy.approval, null)
  assert.equal(routineMcpCallPermitted(frozen, revoked, 4, call(), now, reader(), reviewHash), false)
  const reapproved = approve(intent({ expectedRevision: 2 }), revoked)
  assert.equal(reapproved.policy.revision, 3)
  assert.ok(reapproved.policy.approval)
  assert.equal(routineMcpCallPermitted(frozen, reapproved, 4, call(), now, reader(), reviewHash), false)
})

test('OAuth approval stamps only selected OAuth connections using the authenticated actor reader', () => {
  const ownerUserId = 'person-owner'
  const secondId = 'mcp-connection-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  const legacyId = 'mcp-connection-cccccccccccccccccccccccccccccccc'
  const reads: unknown[] = []
  const lookup = (id: string, tenant: string, actor?: string) => {
    reads.push([id, tenant, actor])
    if (tenant !== tenantId || actor !== ownerUserId) return undefined
    return connection({ id, authentication: id === legacyId ? 'device-bearer' : 'device-oauth' })
  }
  const approved = approveRoutineMcpPolicy(scope, undefined, 4, intent({ tools: [
    { ...permission(), connectionId: secondId }, { ...permission(), connectionId: legacyId }, permission(),
  ] }), now, lookup, ownerUserId)
  assert.deepEqual(approved.oauthAuthority, { ownerUserId, connectionIds: [connectionId, secondId] })
  assert.equal(reads.length, 3)
  assert.ok(reads.every((read) => (read as string[])[2] === ownerUserId))
  assert.equal(Object.hasOwn(approved.policy, 'oauthAuthority'), false)
  const revoked = revokeRoutineMcpPolicy(approved, 1)
  assert.equal(revoked.policy.approval, null)
  assert.deepEqual(revoked.oauthAuthority, approved.oauthAuthority, 'revocation retains private provenance')
  assert.deepEqual(revokeRoutineMcpPolicy(revoked, 2), revoked)
  assert.equal(Object.hasOwn(approveRoutineMcpPolicy(scope, revoked, 4, intent({ expectedRevision: 2 }), now, reader(), ownerUserId), 'oauthAuthority'), false,
    'a legacy replacement does not inherit the old person grant')

  const permissiveOAuthReader = reader(connection({ authentication: 'device-oauth' }))
  for (const actor of [undefined, '', ' ', '\nowner', 'é', 'x'.repeat(201)]) {
    assert.throws(() => approveRoutineMcpPolicy(scope, undefined, 4, intent(), now, permissiveOAuthReader, actor), RoutineMcpPolicyError)
  }
  assert.throws(() => approveRoutineMcpPolicy(scope, undefined, 4, intent(), now, lookup, 'person-peer'), /unavailable/)
  assert.equal(Object.hasOwn(approveRoutineMcpPolicy(scope, undefined, 4, intent(), now, reader(), ownerUserId), 'oauthAuthority'), false)
})

test('private OAuth policy authority is closed, bounded, canonical, detached, and tied to selected IDs', () => {
  const base = approve()
  const authority = { ownerUserId: 'person-owner', connectionIds: [connectionId] }
  const stamped = parseRoutineMcpPolicy({ ...base, oauthAuthority: authority })
  authority.connectionIds.push('mcp-connection-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')
  assert.deepEqual(stamped.oauthAuthority?.connectionIds, [connectionId])
  const valid = { ownerUserId: 'person-owner', connectionIds: [connectionId] }
  for (const oauthAuthority of [
    undefined, null, {}, { ...valid, extra: true },
    ...['', ' ', '\u007f', 'é', 'x'.repeat(201), null].map(ownerUserId => ({ ...valid, ownerUserId })),
    { ...valid, connectionIds: [] }, { ...valid, connectionIds: [connectionId, connectionId] },
    { ...valid, connectionIds: ['mcp-connection-nope'] }, { ...valid, connectionIds: ['mcp-connection-' + 'A'.repeat(32)] },
    { ...valid, connectionIds: ['mcp-connection-' + 'b'.repeat(32), connectionId] },
    { ...valid, connectionIds: ['mcp-connection-' + 'b'.repeat(32)] },
    { ...valid, connectionIds: Array.from({ length: 17 }, (_, i) => 'mcp-connection-' + i.toString(16).padStart(32, '0')) },
  ]) assert.throws(() => parseRoutineMcpPolicy({ ...base, oauthAuthority }), RoutineMcpPolicyError)
  assert.equal(parseRoutineMcpPolicy({ ...base, oauthAuthority: { ...valid, ownerUserId: 'x'.repeat(200) } }).oauthAuthority?.ownerUserId.length, 200)
  assert.deepEqual(parseRoutineMcpPolicy({ ...stamped, policy: { ...stamped.policy, approval: null } }).oauthAuthority, stamped.oauthAuthority)
})

test('OAuth call checks require exact frozen owner and authentication binding without borrowing a legacy grant', () => {
  const ownerUserId = 'person-owner'
  const oauth = connection({ authentication: 'device-oauth' })
  const reads: unknown[] = []
  let available = true
  const lookup = (id: string, tenant: string, actor?: string) => {
    reads.push([id, tenant, actor])
    return available && actor === ownerUserId && tenant === tenantId && id === connectionId ? oauth : undefined
  }
  const permission = approveRoutineMcpPolicy(scope, undefined, 4, intent(), now, lookup, ownerUserId)
  reads.length = 0
  assert.equal(routineMcpCallPermitted(permission, permission, 4, call(), now, lookup, reviewHash), true)
  assert.deepEqual(reads, [[connectionId, tenantId, ownerUserId]])
  available = false
  assert.equal(routineMcpCallPermitted(permission, permission, 4, call(), now, lookup, reviewHash), false, 'membership or connection loss fails closed')
  assert.equal(routineMcpCallPermitted(permission, permission, 4, call(), now, reader(), reviewHash), false, 'an OAuth stamp cannot bind a legacy connection')
  const legacy = approve()
  assert.equal(routineMcpCallPermitted(legacy, legacy, 4, call(), now, reader(oauth), reviewHash), false, 'a permissive reader cannot turn legacy permission into OAuth consent')
  const otherOwner = { ...permission, oauthAuthority: { ...permission.oauthAuthority!, ownerUserId: 'person-peer' } }
  available = true
  assert.equal(routineMcpCallPermitted(permission, otherOwner, 4, call(), now, lookup, reviewHash), false)
  assert.equal(routineMcpCallPermitted(otherOwner, otherOwner, 4, call(), now, lookup, reviewHash), false)
})

test('OAuth authority standalone admission allows sixteen exact IDs but rejects noncanonical order without normalizing it', () => {
  const connectionIds = Array.from({ length: 16 }, (_, i) => 'mcp-connection-' + i.toString(16).padStart(32, '0'))
  const value = { ownerUserId: ' person-owner ', connectionIds }
  assert.deepEqual(parseRoutineMcpOAuthAuthority(value), value, 'person identity follows exact connection owner semantics, not trimming')
  assert.throws(() => parseRoutineMcpOAuthAuthority({ ...value, connectionIds: [...connectionIds].reverse() }), RoutineMcpPolicyError)
  assert.throws(() => parseRoutineMcpOAuthAuthority({ ...value, connectionIds: [connectionIds[0], connectionIds[0]] }), RoutineMcpPolicyError)
  assert.throws(() => parseRoutineMcpOAuthAuthority({ ...value, connectionIds: [...connectionIds, 'mcp-connection-' + 'f'.repeat(32)] }), RoutineMcpPolicyError)
  let getterCalls = 0
  Object.defineProperty(value, 'ownerUserId', { enumerable: true, get() { getterCalls += 1; return 'person-owner' } })
  assert.throws(() => parseRoutineMcpOAuthAuthority(value), RoutineMcpPolicyError)
  assert.equal(getterCalls, 0)
})
