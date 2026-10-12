import assert from 'node:assert/strict'
import test from 'node:test'
import type { RoutineMcpApprovalIntent } from '../contract/routineMcp.ts'
import type { McpConnectionView } from '../contract/mcpConnections.ts'
import { parseMcpConnectionState, type McpConnectionState } from './mcpConnections.ts'
import { validateRoutineMcpAuthorities } from './routineMcpAuthority.ts'
import {
  parseRoutineMcpPolicy, RoutineMcpPolicyError,
} from './routineMcpPolicy.ts'
import {
  RoutineMcpRegistry, parseRoutineMcpRegistryState,
  type RoutineMcpDecisionRequest, type RoutineMcpRegistryState,
} from './routineMcpRegistry.ts'
import { mcpToolSchemaHash } from './mcpToolAdmission.ts'

const tenantId = 'tenant-local-authority'
const routineId = 'routine-local-authority'
const ownerUserId = 'person-local-owner'
const otherUserId = 'person-other-owner'
const httpId = `mcp-connection-${'c'.repeat(32)}`
const localId = `mcp-connection-${'d'.repeat(32)}`
const now = 1_800_000_000_000
const reviewHash = 'b'.repeat(64)
const httpTool = { name: 'search', inputSchema: { type: 'object', properties: {}, additionalProperties: true } }
const localTool = { name: 'read_file', inputSchema: { type: 'object', properties: {}, additionalProperties: true } }
const httpSchemaHash = mcpToolSchemaHash(httpTool)
const localSchemaHash = mcpToolSchemaHash(localTool)

function permission(connectionId: string, connectionRevision: number, toolName: string, schemaHash: string) {
  return { connectionId, connectionRevision, toolName, schemaHash, fixedArguments: {} }
}

function httpConnection(): McpConnectionView {
  return {
    id: httpId, label: 'OAuth source', status: 'connected', revision: 2,
    authentication: 'device-oauth', protocolVersion: '2026-07-28', inspectedAt: now,
    tools: [httpTool], execution: 'approval-required', executableTools: ['search'],
  }
}

function localConnection(): McpConnectionView {
  return {
    id: localId, label: 'Local source', status: 'connected', revision: 5,
    transport: 'stdio', protocolVersion: '2026-07-28', inspectedAt: now,
    tools: [localTool], execution: 'approval-required', executableTools: ['read_file'],
  }
}

function sourceState(owner = ownerUserId): McpConnectionState {
  return parseMcpConnectionState({
    connections: [
      { tenantId, id: httpId, ownerUserId, label: 'OAuth source', endpoint: 'https://mcp.example/mcp',
        authentication: 'device-oauth', revision: 2, connected: false },
      { transport: 'stdio', tenantId, id: localId, ownerUserId: owner, label: 'Local source', revision: 5,
        connected: true, grantReference: `MCP_STDIO_${'D'.repeat(32)}`,
        inspection: { protocolVersion: '2026-07-28', cleanup: 'released', inspectedAt: now, tools: [localTool] } },
    ], retired: [],
  })
}

function localIntent(overrides: Record<string, unknown> = {}): RoutineMcpApprovalIntent {
  return {
    expectedRevision: 0, expectedDefinitionRevision: 4, reviewHash, expiresAt: now + 60_000, maxCallsPerRun: 2,
    tools: [permission(localId, 5, 'read_file', localSchemaHash)], localPrograms: true,
    ...overrides,
  } as RoutineMcpApprovalIntent
}

function mixedIntent(): RoutineMcpApprovalIntent {
  return localIntent({
    tools: [permission(localId, 5, 'read_file', localSchemaHash), permission(httpId, 2, 'search', httpSchemaHash)],
  })
}

function approveLocal(intent: RoutineMcpApprovalIntent = mixedIntent()): RoutineMcpRegistryState {
  const registry = new RoutineMcpRegistry()
  const request: RoutineMcpDecisionRequest = { requestId: 'local-authority-review', action: 'approve', approval: intent }
  const connection = (id: string, tenant: string, actor?: string) => tenant === tenantId && actor === ownerUserId
    ? id === localId ? localConnection() : id === httpId ? httpConnection() : undefined
    : undefined
  registry.decide({ tenantId, routineId }, request, {
    definitionRevision: 4, reviewHash, now, connection, actorUserId: ownerUserId, allowLocalPrograms: true,
  })
  return registry.snapshot()
}

function localOnlyState(): RoutineMcpRegistryState {
  return approveLocal(localIntent())
}

function withPolicy(state: RoutineMcpRegistryState, policy: unknown): RoutineMcpRegistryState {
  return { ...structuredClone(state), policies: [{ tenantId, routineId, policy } as never] }
}

test('local Routine authority joins exact live and retired stdio identities and owners', () => {
  const state = localOnlyState()
  const live = sourceState()
  assert.equal(validateRoutineMcpAuthorities(state, live, true), true)
  assert.equal(validateRoutineMcpAuthorities(state, live), false,
    'the trusted validator capability defaults off even for a correctly stamped grant')
  assert.equal(validateRoutineMcpAuthorities(state, live, false), false)
  assert.equal(validateRoutineMcpAuthorities(state, live, 'true' as never), false,
    'truthy non-boolean capability values never activate local authority')

  const retired = parseMcpConnectionState({ connections: [], retired: [
    { tenantId, id: localId, ownerUserId, transport: 'stdio' },
  ] })
  assert.equal(validateRoutineMcpAuthorities(state, retired, true), true,
    'a queued Routine may retain its frozen exact local identity after connection retirement')

  assert.equal(validateRoutineMcpAuthorities(state, parseMcpConnectionState(undefined), true), false,
    'missing connection state cannot erase private local provenance')
  assert.equal(validateRoutineMcpAuthorities(state, parseMcpConnectionState({ connections: [], retired: [
    { tenantId, id: localId, ownerUserId: otherUserId, transport: 'stdio' },
  ] }), true), false, 'foreign owner never joins the frozen grant')

  const wrongTransport = parseMcpConnectionState({ connections: [{ tenantId, id: localId, label: 'HTTP impersonator',
    endpoint: 'https://mcp.example/mcp', authentication: 'none', revision: 5, connected: false }], retired: [] })
  assert.equal(validateRoutineMcpAuthorities(state, wrongTransport, true), false,
    'the same tenant/id on HTTP is not the reviewed local process')

  const retiredWithoutTransport = parseMcpConnectionState({ connections: [], retired: [
    { tenantId, id: localId, ownerUserId },
  ] })
  assert.equal(validateRoutineMcpAuthorities(state, retiredWithoutTransport, true), false,
    'a retired identity without an explicit stdio transport is not sufficient provenance')
})

test('mixed OAuth/local authority keeps one owner, disjoint sorted groups, and both exact live or retired joins', () => {
  const state = approveLocal()
  const policy = state.policies[0]!
  assert.deepEqual(policy.localAuthority, { ownerUserId, connectionIds: [localId] })
  assert.deepEqual(policy.oauthAuthority, { ownerUserId, connectionIds: [httpId] })
  assert.equal(validateRoutineMcpAuthorities(state, sourceState(), true), true)

  const bothRetired = parseMcpConnectionState({ connections: [], retired: [
    { tenantId, id: localId, ownerUserId, transport: 'stdio' },
    { tenantId, id: httpId, ownerUserId },
  ] })
  assert.equal(validateRoutineMcpAuthorities(state, bothRetired, true), true)

  const splitOwner = sourceState()
  splitOwner.connections.find(row => row.id === localId)!.ownerUserId = otherUserId
  assert.equal(validateRoutineMcpAuthorities(state, parseMcpConnectionState(splitOwner), true), false,
    'all selected OAuth and stdio connections in a mixed permission share the approving person')
})

test('policy and registry joins reject missing, inconsistent, overlapping, or oversized local provenance', () => {
  const state = approveLocal()
  const stored = state.policies[0]!

  const omittedLocalStamp = structuredClone(stored)
  delete omittedLocalStamp.localAuthority
  assert.throws(() => parseRoutineMcpPolicy(omittedLocalStamp), RoutineMcpPolicyError,
    'an approval that opts into local programs cannot omit its local owner stamp')

  const missingDecisionStamp = structuredClone(state)
  delete missingDecisionStamp.decisions[0]!.localAuthority
  assert.throws(() => parseRoutineMcpRegistryState(missingDecisionStamp), RoutineMcpPolicyError,
    'the approving decision must retain the exact local authority provenance')

  const differentDecisionStamp = structuredClone(state)
  differentDecisionStamp.decisions[0]!.localAuthority!.connectionIds = [httpId]
  assert.throws(() => parseRoutineMcpRegistryState(differentDecisionStamp), RoutineMcpPolicyError,
    'approval and decision authority must agree exactly')

  const wrongLocalOwner = structuredClone(stored)
  wrongLocalOwner.localAuthority!.ownerUserId = otherUserId
  assert.throws(() => parseRoutineMcpPolicy(wrongLocalOwner), RoutineMcpPolicyError,
    'mixed HTTP/local authorities cannot name different people')

  const overlapping = structuredClone(stored)
  overlapping.localAuthority!.connectionIds = [httpId]
  assert.throws(() => parseRoutineMcpPolicy(overlapping), RoutineMcpPolicyError,
    'one identity cannot be classified as both OAuth and local')

  const tooMany = structuredClone(stored)
  const oauthIds = Array.from({ length: 16 }, (_, index) => `mcp-connection-${index.toString(16).padStart(32, '0')}`)
  tooMany.oauthAuthority = { ownerUserId, connectionIds: oauthIds }
  tooMany.localAuthority = { ownerUserId, connectionIds: [localId] }
  tooMany.policy.approval!.tools = [
    permission(localId, 5, 'read_file', localSchemaHash),
    ...oauthIds.map((id, index) => permission(id, 1, `tool_${index}`, 'e'.repeat(64))),
  ]
  assert.throws(() => parseRoutineMcpPolicy(tooMany), RoutineMcpPolicyError,
    'combined OAuth and stdio identities stay within the shared tool/authority ceiling')

  const omittedLegacyStamp = structuredClone(stored)
  omittedLegacyStamp.policy.approval!.localPrograms = undefined
  delete omittedLegacyStamp.policy.approval!.localPrograms
  assert.equal(validateRoutineMcpAuthorities(withPolicy(state, omittedLegacyStamp.policy), sourceState(), true), false,
    'an old-format approval cannot select a known stdio identity without explicit localPrograms consent')
})

test('preexisting HTTP and OAuth Routine authority semantics remain unchanged', () => {
  const legacyPolicy = parseRoutineMcpPolicy({
    tenantId, routineId,
    oauthAuthority: { ownerUserId, connectionIds: [httpId] },
    policy: { version: 1, revision: 1, approval: {
      definitionRevision: 4, reviewHash, approvedAt: now, expiresAt: now + 60_000, maxCallsPerRun: 1,
      tools: [permission(httpId, 2, 'search', httpSchemaHash)],
    } },
  })
  const legacyDecision = {
    decisionId: `routine-mcp-decision-${'f'.repeat(64)}`, tenantId, routineId,
    requestHash: '9'.repeat(64), policyRevision: 1, action: 'approve',
    oauthAuthority: { ownerUserId, connectionIds: [httpId] }, actorUserId: ownerUserId,
  }
  const state = parseRoutineMcpRegistryState({ policies: [legacyPolicy], runs: [], decisions: [legacyDecision] })
  const httpOnly = parseMcpConnectionState({ connections: [{ tenantId, id: httpId, ownerUserId,
    label: 'OAuth source', endpoint: 'https://mcp.example/mcp', authentication: 'device-oauth', revision: 2, connected: false }], retired: [] })
  assert.equal(validateRoutineMcpAuthorities(state, httpOnly), true)
  assert.equal(state.policies[0]?.localAuthority, undefined)
  assert.equal(state.policies[0]?.policy.approval?.localPrograms, undefined)

  const mutatedDecision = structuredClone(state)
  mutatedDecision.decisions[0]!.localAuthority = { ownerUserId, connectionIds: [localId] }
  assert.throws(() => parseRoutineMcpRegistryState(mutatedDecision), RoutineMcpPolicyError,
    'legacy OAuth decisions cannot gain an unreviewed local authority stamp')
})
