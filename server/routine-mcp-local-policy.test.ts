import assert from 'node:assert/strict'
import test from 'node:test'
import type { McpConnectionView, McpStdioConnectionView } from '../contract/mcpConnections.ts'
import type { McpBoundToolCall, McpJsonValue } from '../contract/mcpExecution.ts'
import { ROUTINE_MCP_MAX_TOOLS, type RoutineMcpApprovalIntent, type RoutineMcpToolPermission } from '../contract/routineMcp.ts'
import { mcpToolSchemaHash } from './mcpToolAdmission.ts'
import {
  approveRoutineMcpPolicy, parseRoutineMcpLocalAuthority, parseRoutineMcpPolicy, revokeRoutineMcpPolicy,
  routineMcpCallPermitted, routineMcpPermissionOwner, RoutineMcpPolicyError,
  type RoutineMcpConnectionReader, type StoredRoutineMcpPolicy,
} from './routineMcpPolicy.ts'

const scope = { tenantId: 'tenant-local', routineId: 'routine-local' }
const ownerUserId = 'person-owner'
const now = 1_800_000_000_000
const reviewHash = 'c'.repeat(64)
const localId = 'mcp-connection-' + 'a'.repeat(32)
const oauthId = 'mcp-connection-' + 'b'.repeat(32)
const httpId = 'mcp-connection-' + 'c'.repeat(32)
const secondLocalId = 'mcp-connection-' + 'd'.repeat(32)
const tool = { name: 'write', inputSchema: { type: 'object', properties: {}, additionalProperties: true } }

function permission(connectionId = localId, fixedArguments: Record<string, McpJsonValue> = {}): RoutineMcpToolPermission {
  return { connectionId, connectionRevision: 7, toolName: tool.name, schemaHash: mcpToolSchemaHash(tool), fixedArguments }
}

function local(overrides: Partial<McpStdioConnectionView> = {}): McpStdioConnectionView {
  return { id: localId, label: 'Local program', transport: 'stdio', status: 'connected', revision: 7,
    inspectedAt: now, protocolVersion: '2026-07-28', tools: [tool], execution: 'approval-required', executableTools: [tool.name], ...overrides }
}

function http(id = httpId, authentication: 'none' | 'device-bearer' | 'device-oauth' = 'none'): McpConnectionView {
  const { transport: _transport, ...common } = local()
  return { ...common, id, transport: 'http', authentication }
}

/** This stands in for the store's exact live membership/person wall, not merely a public connection view. */
function reader(views: McpConnectionView[] = [local()], person = ownerUserId): RoutineMcpConnectionReader {
  return (id, tenant, actor) => tenant === scope.tenantId && actor === person ? views.find(view => view.id === id) : undefined
}

function intent(overrides: Partial<RoutineMcpApprovalIntent> = {}): RoutineMcpApprovalIntent {
  return { expectedRevision: 0, expectedDefinitionRevision: 4, reviewHash, expiresAt: now + 60_000,
    maxCallsPerRun: 3, tools: [permission()], localPrograms: true, ...overrides }
}

function approve(input = intent(), current?: StoredRoutineMcpPolicy, lookup = reader(), actor = ownerUserId): StoredRoutineMcpPolicy {
  return approveRoutineMcpPolicy(scope, current, 4, input, now, lookup, actor, true)
}

function call(connectionId = localId, arguments_: Record<string, McpJsonValue> = {}): McpBoundToolCall {
  const { fixedArguments: _fixedArguments, ...anchor } = permission(connectionId)
  return { ...anchor, arguments: arguments_ }
}

function errorCode(fn: () => unknown, code: RoutineMcpPolicyError['code']): void {
  assert.throws(fn, (error: unknown) => error instanceof RoutineMcpPolicyError && error.code === code)
}

test('local Routine permission needs independent literal-true host and reviewed intent opt-ins', () => {
  const approved = approve()
  assert.deepEqual(approved.localAuthority, { ownerUserId, connectionIds: [localId] })
  assert.equal(approved.policy.approval?.localPrograms, true)
  assert.equal(routineMcpPermissionOwner(approved), ownerUserId)
  assert.equal(routineMcpPermissionOwner(undefined), undefined)
  errorCode(() => approveRoutineMcpPolicy(scope, undefined, 4, intent(), now, reader(), ownerUserId), 'unavailable')
  const { localPrograms: _localPrograms, ...noOptIn } = intent()
  errorCode(() => approve(noOptIn), 'unavailable')
  for (const hostValue of [false, 1, 'true', {}, null]) {
    errorCode(() => approveRoutineMcpPolicy(scope, undefined, 4, intent(), now, reader(), ownerUserId, hostValue as boolean), 'unavailable')
    assert.equal(routineMcpCallPermitted(approved, approved, 4, call(), now, reader(), reviewHash, hostValue as boolean), false)
  }
  assert.equal(routineMcpCallPermitted(approved, approved, 4, call(), now, reader(), reviewHash), false,
    'even valid parsed stored permission remains default-denied at the call boundary')
  assert.equal(routineMcpCallPermitted(approved, approved, 4, call(), now, reader(), reviewHash, true), true)
})

test('local approval and authority are detached and stamped only from actual actor-bound selections', () => {
  const selected = intent({ tools: [permission(secondLocalId), permission(localId, { scope: { path: ['reviewed', null] } })] })
  const reads: unknown[] = []
  const lookup = reader([local(), local({ id: secondLocalId })])
  const approved = approve(selected, undefined, (id, tenant, actor) => {
    reads.push([id, tenant, actor])
    return lookup(id, tenant, actor)
  })
  assert.deepEqual(reads, [[secondLocalId, scope.tenantId, ownerUserId], [localId, scope.tenantId, ownerUserId]])
  assert.deepEqual(approved.localAuthority, { ownerUserId, connectionIds: [localId, secondLocalId] })
  assert.equal(Object.hasOwn(approved.policy, 'localAuthority'), false)
  assert.equal(Object.hasOwn(approved, 'oauthAuthority'), false)
  assert.equal(Object.hasOwn(approved.policy.approval!.tools[0], 'transport'), false)
  selected.tools[1].fixedArguments.scope = 'changed'
  assert.deepEqual(approved.policy.approval!.tools[1].fixedArguments, { scope: { path: ['reviewed', null] } })
  const parsed = parseRoutineMcpPolicy(approved)
  approved.localAuthority!.connectionIds.pop()
  approved.policy.approval!.tools[1].fixedArguments.scope = 'changed again'
  assert.deepEqual(parsed.localAuthority!.connectionIds, [localId, secondLocalId])
  assert.deepEqual(parsed.policy.approval!.tools[1].fixedArguments, { scope: { path: ['reviewed', null] } })
  const standalone = { ownerUserId, connectionIds: [localId] }
  const copied = parseRoutineMcpLocalAuthority(standalone)
  standalone.connectionIds[0] = secondLocalId
  assert.deepEqual(copied.connectionIds, [localId])
})

test('local intent remains closed and cannot smuggle transport, provenance, or false/null consent', () => {
  for (const localPrograms of [false, null, undefined, 1, 'true']) {
    errorCode(() => approve({ ...intent(), localPrograms } as unknown as RoutineMcpApprovalIntent), 'invalid')
    const approved = approve()
    assert.throws(() => parseRoutineMcpPolicy({ ...approved, policy: { ...approved.policy,
      approval: { ...approved.policy.approval, localPrograms } } }), RoutineMcpPolicyError)
  }
  for (const extra of [
    { ownerUserId }, { localAuthority: { ownerUserId, connectionIds: [localId] } },
    { allowLocalPrograms: true }, { transport: 'stdio' },
    { tools: [{ ...permission(), transport: 'stdio' }] },
  ]) errorCode(() => approve({ ...intent(), ...extra } as RoutineMcpApprovalIntent), 'invalid')
  errorCode(() => approve(intent({ tools: [permission(httpId)] }), undefined, reader([http()])), 'invalid')
  errorCode(() => approve(intent({ tools: [permission(oauthId)] }), undefined, reader([http(oauthId, 'device-oauth')])), 'invalid')
  let getterCalls = 0
  const hostile = intent()
  Object.defineProperty(hostile, 'localPrograms', { enumerable: true, get() { getterCalls += 1; return true } })
  errorCode(() => approve(hostile), 'invalid')
  assert.equal(getterCalls, 0)
})

test('local stamps are closed, nonempty, canonical, bounded, and exactly paired with approved intent', () => {
  const approved = approve()
  const valid = { ownerUserId, connectionIds: [localId] }
  for (const malformed of [
    undefined, null, {}, { ...valid, extra: true },
    ...['', ' ', '\u007f', 'é', 'x'.repeat(201), null].map(ownerUserId => ({ ...valid, ownerUserId })),
    { ...valid, connectionIds: [] }, { ...valid, connectionIds: [localId, localId] },
    { ...valid, connectionIds: [secondLocalId, localId] }, { ...valid, connectionIds: ['mcp-connection-nope'] },
    { ...valid, connectionIds: ['mcp-connection-' + 'A'.repeat(32)] },
    { ...valid, connectionIds: Array.from({ length: 17 }, (_, i) => 'mcp-connection-' + i.toString(16).padStart(32, '0')) },
  ]) {
    assert.throws(() => parseRoutineMcpLocalAuthority(malformed), RoutineMcpPolicyError)
    assert.throws(() => parseRoutineMcpPolicy({ ...approved, localAuthority: malformed }), RoutineMcpPolicyError)
  }
  assert.throws(() => parseRoutineMcpPolicy({ ...approved, localAuthority: { ...valid, connectionIds: [secondLocalId] } }), RoutineMcpPolicyError)
  const { localAuthority: _localAuthority, ...withoutStamp } = approved
  assert.throws(() => parseRoutineMcpPolicy(withoutStamp), RoutineMcpPolicyError)
  const { localPrograms: _localPrograms, ...withoutIntent } = approved.policy.approval!
  assert.throws(() => parseRoutineMcpPolicy({ ...approved, policy: { ...approved.policy, approval: withoutIntent } }), RoutineMcpPolicyError)
  assert.deepEqual(parseRoutineMcpLocalAuthority({ ...valid, ownerUserId: ' person-owner ' }), { ...valid, ownerUserId: ' person-owner ' },
    'person identity is exact; it is not silently trimmed')
  let getterCalls = 0
  Object.defineProperty(valid, 'connectionIds', { enumerable: true, get() { getterCalls += 1; return [localId] } })
  assert.throws(() => parseRoutineMcpLocalAuthority(valid), RoutineMcpPolicyError)
  assert.equal(getterCalls, 0)
})

test('actor-bound local authority refuses missing or foreign people and requires the exact inspected stdio view', () => {
  const approved = approve()
  errorCode(() => approveRoutineMcpPolicy(scope, undefined, 4, intent(), now, () => local(), undefined, true), 'denied')
  errorCode(() => approve(intent(), undefined, reader(), 'person-peer'), 'unavailable')
  assert.equal(routineMcpCallPermitted(approved, approved, 4, call(), now, reader([local()], 'person-peer'), reviewHash, true), false)
  const foreign = { ...approved, localAuthority: { ...approved.localAuthority!, ownerUserId: 'person-peer' } }
  assert.equal(routineMcpCallPermitted(approved, foreign, 4, call(), now, reader(), reviewHash, true), false)
  assert.equal(routineMcpCallPermitted(foreign, foreign, 4, call(), now, reader(), reviewHash, true), false)
  const invalidViews: McpConnectionView[] = [
    local({ revision: 8 }), local({ id: secondLocalId }), local({ status: 'disconnected' }), local({ inspectedAt: null }),
    local({ execution: 'unavailable' }), local({ executableTools: [] }), local({ tools: [tool, tool] }),
    local({ tools: [{ ...tool, inputSchema: { type: 'object', properties: { newField: { type: 'string' } } } }] }),
    local({ tools: [{ ...tool, outputSchema: { type: 'object' } }] }),
    { ...local(), authentication: 'none' } as unknown as McpConnectionView,
    { ...local(), authentication: undefined } as unknown as McpConnectionView,
  ]
  for (const view of invalidViews) {
    errorCode(() => approve(intent(), undefined, () => view), 'unavailable')
    assert.equal(routineMcpCallPermitted(approved, approved, 4, call(), now, () => view, reviewHash, true), false)
  }
})

test('mixed HTTP, OAuth and local permissions preserve separate transport stamps for the same person', () => {
  const lookup = reader([local(), http(oauthId, 'device-oauth'), http()])
  const approved = approve(intent({ tools: [permission(httpId), permission(localId), permission(oauthId)] }), undefined, lookup)
  assert.deepEqual(approved.localAuthority, { ownerUserId, connectionIds: [localId] })
  assert.deepEqual(approved.oauthAuthority, { ownerUserId, connectionIds: [oauthId] })
  assert.equal(routineMcpPermissionOwner(approved), ownerUserId)
  for (const id of [localId, oauthId, httpId]) {
    assert.equal(routineMcpCallPermitted(approved, approved, 4, call(id), now, lookup, reviewHash, true), true)
  }
  for (const id of [oauthId, httpId]) {
    assert.equal(routineMcpCallPermitted(approved, approved, 4, call(id), now, lookup, reviewHash), true,
      'the default local refusal does not change existing HTTP/OAuth permission')
  }
  assert.throws(() => parseRoutineMcpPolicy({ ...approved,
    oauthAuthority: { ownerUserId: 'person-peer', connectionIds: [oauthId] } }), RoutineMcpPolicyError)
  assert.throws(() => parseRoutineMcpPolicy({ ...approved,
    oauthAuthority: { ownerUserId, connectionIds: [localId] } }), RoutineMcpPolicyError)
  const swapped = { ...approved, localAuthority: { ownerUserId, connectionIds: [oauthId] },
    oauthAuthority: { ownerUserId, connectionIds: [localId] } }
  for (const id of [localId, oauthId]) {
    assert.equal(routineMcpCallPermitted(swapped, swapped, 4, call(id), now, lookup, reviewHash, true), false)
  }
  for (const authentication of ['none', 'device-bearer', 'device-oauth'] as const) {
    assert.equal(routineMcpCallPermitted(approved, approved, 4, call(), now, reader([http(localId, authentication)]), reviewHash, true), false,
      'a local stamp never authorizes an HTTP connection')
  }
  const { localPrograms: _localPrograms, ...httpIntent } = intent({ tools: [permission(httpId)] })
  const legacy = approve(httpIntent, undefined, lookup)
  assert.equal(routineMcpPermissionOwner(legacy), undefined)
  assert.equal(routineMcpCallPermitted(legacy, legacy, 4, call(httpId), now, () => local({ id: httpId }), reviewHash, true), false,
    'host opt-in cannot promote legacy HTTP permission to local authority')
})

test('revocation retains strict stamps, and their combined unique connection bound survives absent approval', () => {
  const ids = Array.from({ length: ROUTINE_MCP_MAX_TOOLS }, (_, i) => 'mcp-connection-' + i.toString(16).padStart(32, '0'))
  const revoked = { tenantId: scope.tenantId, routineId: scope.routineId, policy: { version: 1, revision: 2, approval: null },
    localAuthority: { ownerUserId, connectionIds: ids.slice(0, 8) }, oauthAuthority: { ownerUserId, connectionIds: ids.slice(8) } }
  assert.deepEqual(parseRoutineMcpPolicy(revoked), revoked)
  assert.throws(() => parseRoutineMcpPolicy({ ...revoked, oauthAuthority: { ownerUserId,
    connectionIds: [...ids.slice(8), 'mcp-connection-' + 'f'.repeat(32)] } }), RoutineMcpPolicyError)
  assert.throws(() => parseRoutineMcpPolicy({ ...revoked, oauthAuthority: { ownerUserId, connectionIds: [ids[0]] } }), RoutineMcpPolicyError)
  assert.throws(() => parseRoutineMcpPolicy({ ...revoked, oauthAuthority: { ownerUserId: 'person-peer', connectionIds: ids.slice(8) } }), RoutineMcpPolicyError)
  const approved = approve()
  const withdrawn = revokeRoutineMcpPolicy(approved, 1)
  assert.equal(withdrawn.policy.approval, null)
  assert.deepEqual(withdrawn.localAuthority, approved.localAuthority)
  assert.deepEqual(revokeRoutineMcpPolicy(withdrawn, 2), withdrawn)
  assert.equal(routineMcpCallPermitted(approved, withdrawn, 4, call(), now, reader(), reviewHash, true), false)
  assert.equal(routineMcpCallPermitted(withdrawn, withdrawn, 4, call(), now, reader(), reviewHash, true), false)
})

test('local call validation preserves exact bounds, fixed arguments, frozen identity and no inheritance across replacement', () => {
  const approved = approve(intent({ tools: [permission(localId, { filter: { region: 'north', flags: [true, null] } })] }))
  const exactCall = call(localId, { filter: { flags: [true, null], region: 'north' }, extra: 'allowed' })
  assert.equal(routineMcpCallPermitted(approved, approved, 4, exactCall, now, reader(), reviewHash, true), true)
  for (const candidate of [
    call(), { ...exactCall, connectionRevision: 8 }, { ...exactCall, schemaHash: 'd'.repeat(64) },
    { ...exactCall, toolName: 'other' }, call(localId, { filter: { region: 'south', flags: [true, null] } }),
    call(localId, { filter: { region: 'north', flags: [null, true] } }),
    { ...exactCall, transport: 'stdio' } as McpBoundToolCall,
  ]) assert.equal(routineMcpCallPermitted(approved, approved, 4, candidate, now, reader(), reviewHash, true), false)
  assert.equal(routineMcpCallPermitted(approved, approved, 4, exactCall, now - 1, reader(), reviewHash, true), false)
  assert.equal(routineMcpCallPermitted(approved, approved, 4, exactCall, now + 60_000, reader(), reviewHash, true), false)
  assert.equal(routineMcpCallPermitted(approved, approved, 5, exactCall, now, reader(), reviewHash, true), false)
  assert.equal(routineMcpCallPermitted(approved, approved, 4, exactCall, now, reader(), 'd'.repeat(64), true), false)
  const withdrawn = revokeRoutineMcpPolicy(approved, 1)
  const replacement = approve(intent({ expectedRevision: 2 }), withdrawn)
  assert.equal(routineMcpCallPermitted(approved, replacement, 4, exactCall, now, reader(), reviewHash, true), false)
  const { localPrograms: _localPrograms, ...ordinaryIntent } = intent({ expectedRevision: 3, tools: [permission(httpId)] })
  const ordinary = approve(ordinaryIntent, replacement, reader([http()]))
  assert.equal(Object.hasOwn(ordinary, 'localAuthority'), false)
  assert.equal(Object.hasOwn(ordinary.policy.approval!, 'localPrograms'), false)
  const otherPerson = approve(intent({ expectedRevision: 3 }), replacement, reader([local()], 'person-peer'), 'person-peer')
  assert.deepEqual(otherPerson.localAuthority, { ownerUserId: 'person-peer', connectionIds: [localId] })
  assert.equal(routineMcpCallPermitted(replacement, otherPerson, 4, call(), now, reader(), reviewHash, true), false)
})
