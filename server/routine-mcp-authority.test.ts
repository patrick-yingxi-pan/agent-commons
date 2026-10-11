import assert from 'node:assert/strict'
import test from 'node:test'
import { parseMcpConnectionState, type McpConnectionState } from './mcpConnections.ts'
import { validateRoutineMcpAuthorities } from './routineMcpAuthority.ts'
import { parseRoutineMcpPolicy, type StoredRoutineMcpOAuthAuthority } from './routineMcpPolicy.ts'
import { parseRoutineMcpRegistryState, type StoredRoutineMcpDecision } from './routineMcpRegistry.ts'
import { createRoutineMcpRun } from './routineMcpState.ts'

const tenantId = 'tenant-a'
const scope = { tenantId, routineId: 'routine-a' }
const connectionId = `mcp-connection-${'a'.repeat(32)}`
const secondId = `mcp-connection-${'b'.repeat(32)}`
const first = { ownerUserId: 'person-a', connectionIds: [connectionId] }
const second = { ownerUserId: 'person-b', connectionIds: [secondId] }
let sequence = 0

function permission(at = scope, revision = 1, authority: StoredRoutineMcpOAuthAuthority | undefined = first, approved = true) {
  return parseRoutineMcpPolicy({ ...at, policy: { version: 1, revision, approval: approved ? {
    definitionRevision: 1, reviewHash: 'c'.repeat(64), approvedAt: 1000, expiresAt: 2000, maxCallsPerRun: 1,
    tools: [{ connectionId: authority?.connectionIds[0] ?? connectionId, connectionRevision: 1,
      toolName: 'write', schemaHash: 'd'.repeat(64), fixedArguments: {} }],
  } : null }, ...(authority ? { oauthAuthority: authority } : {}) })
}

function decision(at = scope, policyRevision = 1, action: 'approve' | 'revoke' = 'approve',
  authority: StoredRoutineMcpOAuthAuthority | undefined = first): StoredRoutineMcpDecision {
  return { ...at, decisionId: `routine-mcp-decision-${(++sequence).toString(16).padStart(64, '0')}`,
    requestHash: 'e'.repeat(64), policyRevision, action,
    ...(authority ? { oauthAuthority: authority, actorUserId: action === 'approve' ? authority.ownerUserId : 'manager' } : {}) }
}

function sources() {
  return parseMcpConnectionState({ connections: [], retired: [
    { tenantId, id: connectionId, ownerUserId: first.ownerUserId },
    { tenantId, id: secondId, ownerUserId: second.ownerUserId },
  ] })
}

test('unsorted history selects the nearest strictly prior approval, never a future or same-revision approval', () => {
  const state = parseRoutineMcpRegistryState({ policies: [permission(scope, 3, second)], runs: [], decisions: [
    decision(scope, 3, 'approve', second), decision(scope, 2, 'revoke', first),
    decision(scope, 2, 'approve', second), decision(scope, 1, 'approve', first),
  ] })
  assert.equal(validateRoutineMcpAuthorities(state, sources()), true)
  state.decisions[1]!.oauthAuthority = second
  assert.equal(validateRoutineMcpAuthorities(parseRoutineMcpRegistryState(state), sources()), false,
    'same-revision approval cannot explain the preceding revocation')
})

test('historical equal-revision approvals preserve the original first-entry tie and do not reorder inputs', () => {
  const state = parseRoutineMcpRegistryState({ policies: [permission(scope, 5, first, false)], runs: [], decisions: [
    decision(scope, 4, 'revoke', first), decision(scope, 3, 'approve', first),
    decision(scope, 1, 'approve', second), decision(scope, 3, 'approve', second),
    decision(scope, 2, 'revoke', second),
  ] })
  const before = structuredClone(state)
  assert.equal(validateRoutineMcpAuthorities(state, sources()), true,
    'admitted historical duplicate revisions retain the stable sort’s first-entry semantics')
  assert.deepEqual(state, before)
  ;[state.decisions[1], state.decisions[3]] = [state.decisions[3]!, state.decisions[1]!]
  assert.equal(validateRoutineMcpAuthorities(parseRoutineMcpRegistryState(state), sources()), false)
})

test('exact tenant/routine scopes and connection tenants never alias through delimiter or identical connection IDs', () => {
  const scopes = [{ tenantId: 'a|b', routineId: 'c' }, { tenantId: 'a', routineId: 'b|c' },
    { tenantId: 'a', routineId: 'other' }]
  const authority = scopes.map((_row, index) => ({ ownerUserId: `person-${index}`, connectionIds: [index === 2 ? secondId : connectionId] }))
  const state = parseRoutineMcpRegistryState({
    policies: scopes.map((at, index) => permission(at, 2, authority[index], false)), runs: [],
    decisions: scopes.flatMap((at, index) => [decision(at, 2, 'revoke', authority[index]), decision(at, 1, 'approve', authority[index])]),
  })
  const connections = parseMcpConnectionState({ connections: [], retired: scopes.map((at, index) => ({
    tenantId: at.tenantId, id: authority[index]!.connectionIds[0], ownerUserId: authority[index]!.ownerUserId,
  })) })
  assert.equal(validateRoutineMcpAuthorities(state, connections), true)
  connections.retired[0]!.ownerUserId = authority[1]!.ownerUserId
  assert.equal(validateRoutineMcpAuthorities(state, parseMcpConnectionState(connections)), false)
})

test('live and retired OAuth sources require exact ownership; selected OAuth IDs cannot be omitted from the stamp', () => {
  const approved = permission()
  const state = parseRoutineMcpRegistryState({ policies: [approved], runs: [createRoutineMcpRun(approved, 'run-a')], decisions: [decision()] })
  const live = parseMcpConnectionState({ connections: [{ tenantId, id: connectionId, ownerUserId: first.ownerUserId,
    label: 'Private OAuth', endpoint: 'https://mcp.example/mcp', authentication: 'device-oauth', revision: 1, connected: false }], retired: [] })
  assert.equal(validateRoutineMcpAuthorities(state, live), true)
  assert.equal(validateRoutineMcpAuthorities(state, sources()), true)
  assert.equal(validateRoutineMcpAuthorities(state, parseMcpConnectionState(undefined)), false)
  const wrongOwner = sources()
  wrongOwner.retired[0]!.ownerUserId = second.ownerUserId
  assert.equal(validateRoutineMcpAuthorities(state, parseMcpConnectionState(wrongOwner)), false)
  const incomplete = permission()
  incomplete.policy.approval!.tools.push({ ...incomplete.policy.approval!.tools[0]!, connectionId: secondId })
  const mixed = sources()
  mixed.retired[1]!.ownerUserId = first.ownerUserId
  assert.equal(validateRoutineMcpAuthorities(parseRoutineMcpRegistryState({ policies: [incomplete], runs: [], decisions: [decision()] }), mixed), false)
  assert.throws(() => parseMcpConnectionState({ ...live, retired: [sources().retired[0]] }),
    'leaf admission forbids overlapping live/retired identities before indexing')
})

test('persisted Routine authority cannot select current or retired stdio identities', () => {
  const approved = permission()
  const state = parseRoutineMcpRegistryState({ policies: [approved], runs: [], decisions: [decision()] })
  const local = parseMcpConnectionState({ connections: [{ transport: 'stdio', tenantId, id: connectionId,
    ownerUserId: first.ownerUserId, label: 'Local writer', revision: 1, connected: true,
    grantReference: `MCP_STDIO_${'A'.repeat(32)}`,
    inspection: { protocolVersion: '2026-07-28', cleanup: 'released', inspectedAt: 1, tools: [] } }], retired: [] })
  assert.equal(validateRoutineMcpAuthorities(state, local), false)
  const retired = parseMcpConnectionState({ connections: [], retired: [{ tenantId, id: connectionId,
    ownerUserId: first.ownerUserId, transport: 'stdio' }] })
  assert.equal(validateRoutineMcpAuthorities(state, retired), false)
  assert.throws(() => parseMcpConnectionState({ connections: [], retired: [{ tenantId, id: connectionId, transport: 'stdio' }] }))
})

test('legacy absence remains compatible, but a known foreign OAuth identity cannot masquerade as an orphan legacy source', () => {
  const approved = permission(scope, 3, undefined)
  // Explicitly remove the defaulted fixture authority to construct legacy data.
  delete approved.oauthAuthority
  const legacyDecision = decision(scope, 3)
  delete legacyDecision.oauthAuthority
  delete legacyDecision.actorUserId
  const historical = structuredClone(approved)
  historical.policy.revision = 1
  const state = parseRoutineMcpRegistryState({ policies: [approved], runs: [createRoutineMcpRun(historical, 'legacy-run')], decisions: [legacyDecision] })
  assert.equal(validateRoutineMcpAuthorities(state, parseMcpConnectionState(undefined)), true,
    'legacy frozen permission without a historical decision keeps its existing admission')
  const foreign = parseMcpConnectionState({ connections: [], retired: [{ tenantId: 'foreign', id: connectionId, ownerUserId: first.ownerUserId }] })
  assert.equal(validateRoutineMcpAuthorities(state, foreign), false)
  foreign.retired.push({ tenantId, id: connectionId })
  assert.equal(validateRoutineMcpAuthorities(state, parseMcpConnectionState(foreign)), true,
    'an exact legacy identity wins over another tenant’s same-ID OAuth discriminator')
  const duplicate = decision(scope, 1)
  delete duplicate.oauthAuthority
  delete duplicate.actorUserId
  state.decisions.push(duplicate, { ...duplicate, decisionId: `routine-mcp-decision-${'f'.repeat(64)}` })
  assert.equal(validateRoutineMcpAuthorities(parseRoutineMcpRegistryState(state), parseMcpConnectionState(undefined)), false,
    'exact-revision indexing must retain approval multiplicity, not silently pick one')
})

test('null policies retain all latest decision authority and allow automatic suspension without a new decision', () => {
  const state = parseRoutineMcpRegistryState({ policies: [permission(scope, 3, first, false)], runs: [],
    decisions: [decision(scope, 2, 'revoke', first), decision(scope, 1, 'approve', first)] })
  assert.equal(validateRoutineMcpAuthorities(state, sources()), true)
  assert.equal(validateRoutineMcpAuthorities(parseRoutineMcpRegistryState({ ...state, decisions: [] }), sources()), false)
  state.decisions.push(decision(scope, 2, 'approve', second))
  assert.equal(validateRoutineMcpAuthorities(parseRoutineMcpRegistryState(state), sources()), false,
    'all decisions at the latest revision must match retained authority')
})

function measuredHistory(scopeCount: number, identityCount = 1) {
  const policies = []
  const decisions = []
  const runs = []
  for (let index = 0; index < scopeCount; index++) {
    const at = { tenantId, routineId: `routine-${index}` }
    policies.push(permission(at, 8, first, false))
    runs.push(createRoutineMcpRun(permission(at), `run-${index}`))
    for (let revision = 1; revision <= 8; revision++) decisions.push(decision(at, revision, revision % 2 ? 'approve' : 'revoke'))
  }
  // Count property reads only after actual bounded leaf/registry admission.
  // The cost lock is deterministic and does not assert machine-dependent time.
  const state = parseRoutineMcpRegistryState({ policies, runs, decisions })
  const connections: McpConnectionState = parseMcpConnectionState({ connections: [], retired: [
    ...Array.from({ length: identityCount - 1 }, (_unused, index) => ({ tenantId,
      id: `mcp-connection-${index.toString(16).padStart(32, '0')}` })),
    { tenantId, id: connectionId, ownerUserId: first.ownerUserId },
  ] })
  let decisionReads = 0
  let connectionReads = 0
  for (const row of state.decisions) for (const key of ['tenantId', 'routineId'] as const) {
    const value = row[key]
    Object.defineProperty(row, key, { enumerable: true, get() { decisionReads++; return value } })
  }
  for (const row of connections.retired) {
    const id = row.id
    Object.defineProperty(row, 'id', { enumerable: true, get() { connectionReads++; return id } })
  }
  assert.equal(validateRoutineMcpAuthorities(state, connections), true)
  return { decisionReads, connectionReads, decisions: state.decisions.length, scopes: scopeCount, identities: identityCount }
}

test('decision join work scales with scoped history, not all unrelated routines', (t) => {
  const small = measuredHistory(8)
  const large = measuredHistory(64)
  t.diagnostic(`decision identity reads: ${small.decisionReads} for ${small.decisions} decisions; ${large.decisionReads} for ${large.decisions} decisions`)
  assert.ok(large.decisionReads <= 16 * large.decisions + 32 * large.scopes,
    `global history was rescanned: ${large.decisionReads} identity reads for ${large.decisions} decisions`)
  assert.ok(large.decisionReads <= small.decisionReads * 10,
    `8x more independent routines amplified decision reads from ${small.decisionReads} to ${large.decisionReads}`)
})

test('connection joins index live and retired identities once instead of searching per historical stamp', (t) => {
  const measured = measuredHistory(16, 256)
  t.diagnostic(`connection ID reads: ${measured.connectionReads} for ${measured.identities} identities and ${measured.decisions} decisions`)
  assert.ok(measured.connectionReads <= 4 * measured.identities + 4 * measured.decisions,
    `connection history was rescanned: ${measured.connectionReads} ID reads for ${measured.identities} identities`)
})
