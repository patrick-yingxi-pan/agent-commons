import assert from 'node:assert/strict'
import test from 'node:test'
import type { CommissionMcpApprovalIntent, CommissionMcpWork } from '../contract/commissionMcp.ts'
import type { McpBoundToolCall, McpToolPermission, McpToolResult } from '../contract/mcpExecution.ts'
import type { McpConnectionView } from '../contract/mcpConnections.ts'
import {
  beginCommissionMcpEffect, closeCommissionMcpPreparation, commissionMcpClaimId, interruptCommissionMcpClaim,
  parseCommissionMcpClaim, reserveCommissionMcpClaim, settleCommissionMcpEffect,
  type StoredCommissionMcpClaim,
} from './commissionMcpClaim.ts'
import { approveCommissionMcpPolicy, CommissionMcpPolicyError, revokeCommissionMcpPolicy,
  type CommissionMcpScope, type StoredCommissionMcpPolicy } from './commissionMcpPolicy.ts'
import { mcpToolSchemaHash } from './mcpToolAdmission.ts'

const tenantId = 'tenant-owner'
const ownerUserId = 'person-owner'
const projectId = 'project-shared'
const now = 1_800_000_000_000
const reviewHash = 'c'.repeat(64)
const connectionId = 'mcp-connection-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const toolDefinition = { name: 'search', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, additionalProperties: true } }
const schemaHash = mcpToolSchemaHash(toolDefinition)
const scope: CommissionMcpScope = { tenantId, ownerUserId, projectId, commissionId: 'commission-a', agentId: 'agent-a' }
const result: McpToolResult = { resultType: 'complete', content: [{ type: 'text', text: 'found' }], isError: false }

function permission(name = 'search'): McpToolPermission {
  return { connectionId, connectionRevision: 7, toolName: name, schemaHash, fixedArguments: {} }
}

function connection(): McpConnectionView {
  return { id: connectionId, label: 'Reviewed peer', status: 'connected', revision: 7, authentication: 'none',
    protocolVersion: '2026-07-28', inspectedAt: now, tools: [toolDefinition], execution: 'approval-required', executableTools: ['search'] }
}

function reader(counter?: { reads: number[] }, expectedOwner = ownerUserId) {
  return (id: string, tenant: string, owner: string) => {
    counter?.reads.push(1)
    return id === connectionId && tenant === tenantId && owner === expectedOwner ? connection() : undefined
  }
}

function grant(commission = 'commission-a', owner = ownerUserId, project = projectId, selected = permission()): StoredCommissionMcpPolicy {
  const currentScope = { ...scope, commissionId: commission, ownerUserId: owner, projectId: project }
  const intent: CommissionMcpApprovalIntent = { expectedRevision: 0, expectedConfigurationRevision: 4, reviewHash,
    execution: { agentId: 'agent-a', providerId: 'provider-a', modelId: 'model-a' }, expiresAt: now + 60_000,
    maxWorkItems: 3, tools: [selected] }
  return approveCommissionMcpPolicy(currentScope, undefined, { configurationRevision: 4, reviewHash }, intent, now, reader(undefined, owner))
}

function work(itemId = 'work-item-a', target = 'search'): CommissionMcpWork {
  return { itemId, subGoal: 'Search the reviewed source', type: 'mcp.mutate', target, note: '' }
}

function call(arguments_: Record<string, unknown> = { query: 'otters' }): McpBoundToolCall {
  return { connectionId, connectionRevision: 7, toolName: 'search', schemaHash, arguments: arguments_ as McpBoundToolCall['arguments'] }
}

function reserve(current: StoredCommissionMcpClaim | undefined, overrides: Partial<Parameters<typeof reserveCommissionMcpClaim>[1]> = {}) {
  const frozen = grant()
  return reserveCommissionMcpClaim(current, { permission: frozen, work: work(), tool: permission(), live: frozen,
    review: { configurationRevision: 4, reviewHash }, now, connection: reader(), ...overrides })
}

function begin(claim: StoredCommissionMcpClaim, overrides: Partial<Parameters<typeof beginCommissionMcpEffect>[1]> = {}) {
  return beginCommissionMcpEffect(claim, { call: call(), live: claim.permission,
    review: { configurationRevision: 4, reviewHash }, now: now + 1, connection: reader(), ...overrides })
}

function errorCode(fn: () => unknown, code: CommissionMcpPolicyError['code'] = 'invalid'): void {
  assert.throws(fn, (error: unknown) => error instanceof CommissionMcpPolicyError && error.code === code)
}

test('claim identity is global to Project and work item across Commission, owner, and approval replacement', () => {
  const first = reserve(undefined).claim
  const replacement = grant('commission-b', 'person-other')
  const second = reserveCommissionMcpClaim(undefined, { permission: replacement, work: work(), tool: permission(), live: replacement,
    review: { configurationRevision: 4, reviewHash }, now,
    connection: reader(undefined, 'person-other') }).claim
  assert.equal(first.id, second.id)
  assert.equal(first.id, commissionMcpClaimId(projectId, 'work-item-a'))
  assert.notEqual(first.id, commissionMcpClaimId('project-other', 'work-item-a'))
  assert.notEqual(first.id, commissionMcpClaimId(projectId, 'work-item-b'))
})

test('exact claim replay is receipt-only after revocation and changed intent conflicts', () => {
  const first = reserve(undefined).claim
  const revoked = revokeCommissionMcpPolicy(first.permission, first.permission.policy.revision)
  const reads = { reads: [] as number[] }
  const replay = reserveCommissionMcpClaim(first, { permission: first.permission, work: first.work, tool: first.tool,
    live: revoked, review: { configurationRevision: 999, reviewHash: 'd'.repeat(64) }, now: now + 99_999,
    connection: reader(reads) })
  assert.equal(replay.created, false)
  assert.deepEqual(replay.claim, first)
  assert.equal(reads.reads.length, 0)
  errorCode(() => reserve(first, { work: { ...first.work, note: 'changed' } }), 'stale')
  errorCode(() => reserve(first, { permission: revoked }), 'stale')
  errorCode(() => reserve(first, { tool: { ...first.tool, schemaHash: 'd'.repeat(64) } }), 'stale')
})

test('fresh preparation requires the approved selected tool, target, live grant, review, and half-open time window', () => {
  const selected = { ...permission(), fixedArguments: { query: 'otters' } }
  const frozen = grant('commission-a', ownerUserId, projectId, selected)
  const malformed = [permission('other'), { ...permission(), fixedArguments: { query: 'changed' } }]
  for (const tool of malformed) {
    errorCode(() => reserve(undefined, { tool }), 'denied')
  }
  errorCode(() => reserve(undefined, { work: work('work-item-a', 'other') }), 'denied')
  errorCode(() => reserve(undefined, { live: undefined }), 'denied')
  errorCode(() => reserve(undefined, { now: now + 60_000 }), 'denied')
  const exact = reserveCommissionMcpClaim(undefined, { permission: frozen, work: work(), tool: selected, live: frozen,
    review: { configurationRevision: 4, reviewHash }, now, connection: reader() })
  assert.equal(exact.created, true)
  errorCode(() => begin(exact.claim, { call: call({ query: 'different' }) }), 'stale')
})

test('claim intent hash treats nested JSON object key order as semantically irrelevant', () => {
  const selected = { ...permission(), fixedArguments: { filter: { first: 1, second: 2 } } }
  const frozen = grant('commission-a', ownerUserId, projectId, selected)
  const claim = reserve(undefined, { permission: frozen, live: frozen, tool: selected }).claim
  const reordered = structuredClone(claim)
  if (reordered.phase === 'preparing') {
    reordered.permission.policy.approval!.tools[0].fixedArguments.filter = { second: 2, first: 1 }
    reordered.tool.fixedArguments.filter = { second: 2, first: 1 }
  }
  assert.deepEqual(parseCommissionMcpClaim(reordered), claim)
})

test('claim retains a result accepted by the attempt parser at the composed component bounds', () => {
  const payload = 'x'.repeat(49_000)
  const otherPayload = 'x'.repeat(13_800)
  const definitions = Array.from({ length: 16 }, (_, index) => ({ name: `bulk-${index}`,
    inputSchema: { type: 'object', properties: { payload: { type: 'string' } }, additionalProperties: true } }))
  const selected: McpToolPermission = { connectionId, connectionRevision: 7, toolName: definitions[0].name,
    schemaHash: mcpToolSchemaHash(definitions[0]), fixedArguments: { payload } }
  const permissions = definitions.map(definition => ({ connectionId, connectionRevision: 7, toolName: definition.name,
    schemaHash: mcpToolSchemaHash(definition), fixedArguments: { payload: definition.name === definitions[0].name ? payload : otherPayload } }))
  assert.ok(Buffer.byteLength(JSON.stringify(permissions)) <= 262_144)
  const view: McpConnectionView = { id: connectionId, label: 'Reviewed peer', status: 'connected', revision: 7, authentication: 'none',
    protocolVersion: '2026-07-28', inspectedAt: now, tools: definitions, execution: 'approval-required',
    executableTools: definitions.map(definition => definition.name) }
  const largeGrant = approveCommissionMcpPolicy(scope, undefined, { configurationRevision: 4, reviewHash }, {
    expectedRevision: 0, expectedConfigurationRevision: 4, reviewHash,
    execution: { agentId: 'agent-a', providerId: 'provider-a', modelId: 'model-a' }, expiresAt: now + 60_000,
    maxWorkItems: 3, tools: permissions,
  }, now, (id, tenant, owner) => id === connectionId && tenant === tenantId && owner === ownerUserId ? view : undefined)
  const largeWork = work('large-result-item', selected.toolName)
  const preparing = reserveCommissionMcpClaim(undefined, { permission: largeGrant, work: largeWork, tool: selected,
    live: largeGrant, review: { configurationRevision: 4, reviewHash }, now, connection: () => view }).claim
  const largeCall: McpBoundToolCall = { connectionId, connectionRevision: 7, toolName: selected.toolName,
    schemaHash: selected.schemaHash, arguments: { payload } }
  const effect = beginCommissionMcpEffect(preparing, { call: largeCall, live: largeGrant,
    review: { configurationRevision: 4, reviewHash }, now: now + 1, connection: () => view }).claim
  const largeResult: McpToolResult = { resultType: 'complete', content: [{ type: 'text', text: 'r'.repeat(260_000) }], isError: false }
  const settled = settleCommissionMcpEffect(effect, { status: 'done', summary: '', result: largeResult }, now + 2)
  assert.equal(settled.phase, 'effect')
  if (settled.phase === 'effect') {
    assert.equal(settled.attempt.status, 'done')
    assert.equal(settled.attempt.result?.content[0].type, 'text')
  }
  const oversized = settleCommissionMcpEffect(effect, { status: 'done', summary: '',
    result: { ...largeResult, content: [{ type: 'text', text: 'r'.repeat(263_000) }] } }, now + 3)
  assert.equal(oversized.phase, 'effect')
  if (oversized.phase === 'effect') assert.equal(oversized.attempt.status, 'uncertain')
})

test('nested effect must join the exact claim permission, work, selected tool, and fixed arguments', () => {
  const effect = begin(reserve(undefined).claim).claim
  assert.equal(effect.phase, 'effect')
  assert.deepEqual(parseCommissionMcpClaim(effect), effect)
  const tamperedCall = structuredClone(effect)
  if (tamperedCall.phase === 'effect') tamperedCall.attempt.call.arguments.query = 'tampered'
  errorCode(() => parseCommissionMcpClaim(tamperedCall))
  const mismatchedTool = structuredClone(effect)
  mismatchedTool.tool = { ...mismatchedTool.tool, fixedArguments: { query: 'different' } }
  errorCode(() => parseCommissionMcpClaim(mismatchedTool))
  const mismatchedWork = structuredClone(effect)
  mismatchedWork.work.note = 'tampered'
  errorCode(() => parseCommissionMcpClaim(mismatchedWork))
})

test('effect replay and restart recovery are exact and do not recheck revoked live authority', () => {
  const preparing = reserve(undefined).claim
  const effect = begin(preparing).claim
  const recovered = parseCommissionMcpClaim(JSON.parse(JSON.stringify(effect)))
  assert.deepEqual(recovered, effect)
  const revoked = revokeCommissionMcpPolicy(effect.permission, effect.permission.policy.revision)
  const reads = { reads: [] as number[] }
  const replay = beginCommissionMcpEffect(recovered, { call: effect.phase === 'effect' ? effect.attempt.call : call(), live: revoked,
    review: { configurationRevision: 999, reviewHash: 'd'.repeat(64) }, now: now + 99_999, connection: reader(reads) })
  assert.equal(replay.created, false)
  assert.deepEqual(replay.claim, effect)
  assert.equal(reads.reads.length, 0)
  errorCode(() => begin(recovered, { call: call({ query: 'changed' }) }), 'stale')
})

test('settlement and interruption preserve terminal receipts; preparation closure cannot start an effect', () => {
  const preparing = reserve(undefined).claim
  const uncertainPreparation = closeCommissionMcpPreparation(preparing, 'uncertain', now + 2)
  errorCode(() => begin(uncertainPreparation), 'stale')
  assert.deepEqual(interruptCommissionMcpClaim(uncertainPreparation, now + 5), uncertainPreparation)

  const effect = begin(preparing).claim
  const settled = settleCommissionMcpEffect(effect, { status: 'done', summary: 'private', result }, now + 3)
  assert.equal(settled.phase, 'effect')
  if (settled.phase === 'effect') assert.equal(settled.attempt.status, 'done')
  assert.deepEqual(interruptCommissionMcpClaim(settled, now + 4), settled)
  const replay = begin(settled)
  assert.equal(replay.created, false)
  assert.deepEqual(replay.claim, settled)
  errorCode(() => settleCommissionMcpEffect(settled, { status: 'failed' }, now + 5))
  assert.throws(() => parseCommissionMcpClaim({ ...preparing, extra: true }), CommissionMcpPolicyError)
})
