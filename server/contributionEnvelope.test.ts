import assert from 'node:assert/strict'
import test from 'node:test'
import type { McpConnectionView, McpDiscoveredTool } from '../contract/mcpConnections.ts'
import type { ProposeEnvelopeRequest } from '../contract/contributions.ts'
import { MCP_SCHEMA_ADMISSION_VERSION, mcpToolSchemaHash } from './mcpToolAdmission.ts'
import { MCP_MODERN_VERSION } from './mcpProtocol.ts'
import type { PrivateMcpConnection } from './mcpConnections.ts'
import {
  currentContributionMcpLine,
  envelopeProposalLinesMatch,
  normalizedEnvelopeProposalLines,
  prepareContributionMcpLines,
  type NormalizedEnvelopeProposalLine,
  type StoredContributionEnvelopeLine,
} from './contributionEnvelope.ts'

const tool: McpDiscoveredTool = {
  name: 'write-item',
  description: 'Write one project item',
  inputSchema: {
    type: 'object', properties: { item: { type: 'string', minLength: 1 } },
    required: ['item'], additionalProperties: false,
  },
}
const connectionId = 'mcp-connection-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const schemaHash = mcpToolSchemaHash(tool)
function row(): PrivateMcpConnection {
  return {
    tenantId: 'tenant-a', id: connectionId, label: 'Project Writer', endpoint: 'https://mcp.example.test',
    authentication: 'none', revision: 8, connected: true,
    inspection: { protocolVersion: MCP_MODERN_VERSION, cleanup: 'not-needed', inspectedAt: 1, tools: [structuredClone(tool)],
      schemaAdmission: { version: MCP_SCHEMA_ADMISSION_VERSION, hashes: [schemaHash] } },
  }
}

const ownerUserId = 'person-private-owner'
function oauthRow(): PrivateMcpConnection {
  return { ...row(), authentication: 'device-oauth', ownerUserId,
    credentialReference: `MCP_DESKTOP_${'A'.repeat(32)}` }
}

function stdioRow(): PrivateMcpConnection {
  return { transport: 'stdio', tenantId: 'tenant-a', id: connectionId, label: 'Local writer', ownerUserId,
    revision: 8, connected: true, grantReference: `MCP_STDIO_${'A'.repeat(32)}`,
    inspection: { protocolVersion: MCP_MODERN_VERSION, cleanup: 'released', inspectedAt: 1, tools: [structuredClone(tool)],
      schemaAdmission: { version: MCP_SCHEMA_ADMISSION_VERSION, hashes: [schemaHash] } } }
}

function store(initial = row()) {
  let current = initial
  const value = {
    privateMcpConnection: (id: string, tenantId: string) => id === current.id && tenantId === current.tenantId ? structuredClone(current) : undefined,
    mcpConnection: (id: string, tenantId: string): McpConnectionView | undefined => id === current.id && tenantId === current.tenantId
      ? { id: current.id, label: current.label, status: current.connected ? 'connected' : 'disconnected', revision: current.revision,
        ...(current.transport === 'stdio' ? { transport: 'stdio' as const } : { authentication: current.authentication }),
        protocolVersion: current.inspection?.protocolVersion ?? null, inspectedAt: 1,
        tools: structuredClone(current.inspection?.tools ?? []), execution: current.connected ? 'approval-required' : 'unavailable',
        executableTools: current.connected ? [tool.name] : [] }
      : undefined,
    replace(next: PrivateMcpConnection) { current = structuredClone(next) },
  }
  return value
}

function line(overrides: Record<string, unknown> = {}) {
  return {
    type: 'mcp.mutate', target: tool.name, harness: 'explicit-call', cardinality: 1, note: 'write one item',
    mcp: { connectionId, connectionRevision: 8, toolName: tool.name, arguments: { item: 'A' } },
    ...overrides,
  } as ProposeEnvelopeRequest['lines'][number]
}

function normalize(one: ProposeEnvelopeRequest['lines'][number] = line()): NormalizedEnvelopeProposalLine[] {
  const result = normalizedEnvelopeProposalLines({ lines: [one] })
  assert.ok(result)
  return result
}

test('legacy envelope defaults and trims remain stable while explicit-call requires a closed selection', () => {
  const legacy = normalizedEnvelopeProposalLines({ lines: [{ type: 'connector.write', target: '  email  ', note: ' scope ' }] })
  assert.deepEqual(legacy, [{ type: 'connector.write', target: 'email', cardinality: 1, harness: 'draft-escrow', note: 'scope' }])
  assert.equal(normalizedEnvelopeProposalLines({ lines: [line({ harness: 'draft-escrow' })] }), undefined)
  assert.equal(normalizedEnvelopeProposalLines({ lines: [line({ mcp: undefined })] }), undefined)
  assert.equal(normalizedEnvelopeProposalLines({ lines: [line({ type: 'mcp.query' })] }), undefined)
  assert.equal(normalizedEnvelopeProposalLines({ lines: [line({ target: 'another-tool' })] }), undefined)
  assert.ok(normalizedEnvelopeProposalLines({ lines: [line({ cardinality: 2 })] }),
    'cardinality limits the number of individually confirmed calls')
  assert.equal(normalizedEnvelopeProposalLines({ lines: [line({ mcp: { ...line().mcp, schemaHash } })] }), undefined,
    'the selection is exact and the server, not the caller, derives schemaHash')
  assert.equal(normalizedEnvelopeProposalLines({ lines: [line({ target: ` ${tool.name} ` })] }), undefined,
    'MCP targets are exact tool names, not trimmed aliases')
  assert.equal(normalizedEnvelopeProposalLines({ lines: [line({ mcp: { ...line().mcp, arguments: { item: 'x'.repeat(49_200) } } })] }), undefined)
})

test('same-key line matching uses canonical argument JSON and includes the exact MCP intent', () => {
  const first = normalize(line({ mcp: { connectionId, connectionRevision: 8, toolName: tool.name, arguments: { item: 'A', flags: { b: true, a: 1 } } } }))
  const reordered = normalize(line({ mcp: { connectionId, connectionRevision: 8, toolName: tool.name, arguments: { flags: { a: 1, b: true }, item: 'A' } } }))
  const changed = normalize(line({ mcp: { connectionId, connectionRevision: 8, toolName: tool.name, arguments: { item: 'B', flags: { a: 1, b: true } } } }))
  assert.equal(envelopeProposalLinesMatch(first, reordered), true)
  assert.equal(envelopeProposalLinesMatch(first, changed), false)
  assert.equal(envelopeProposalLinesMatch(first, normalize(line({ mcp: { ...line().mcp, connectionRevision: 9 } }))), false)
})

test('preparation validates current owned admission and returns separate public preview/private call', async () => {
  const source = store()
  const lines = normalize()
  const prepared = await prepareContributionMcpLines(source, 'tenant-a', lines)
  assert.ok(prepared)
  assert.deepEqual(prepared[0].mcp, { connectionLabel: 'Project Writer', toolName: tool.name, arguments: { item: 'A' } })
  assert.deepEqual(prepared[0].mcpAuthority, { tenantId: 'tenant-a', call: {
    connectionId, connectionRevision: 8, toolName: tool.name, schemaHash, arguments: { item: 'A' },
  } })
  assert.equal(JSON.stringify(prepared[0].mcp).includes(connectionId), false)
  assert.equal(currentContributionMcpLine(source, 'tenant-a', { ...prepared[0], id: 'line-1', used: 0 }), true)
  const legacy = await prepareContributionMcpLines(source, 'tenant-a', normalize({ type: 'connector.write', target: '  email  ' }))
  assert.deepEqual(legacy, [{ type: 'connector.write', target: 'email', cardinality: 1, harness: 'draft-escrow', note: '' }])
  assert.equal(await prepareContributionMcpLines(source, 'tenant-b', lines), undefined)
})

test('preparation refuses stale, disconnected, non-admitted, or schema-invalid calls without side effects', async () => {
  const cases: Array<(value: PrivateMcpConnection) => void> = [
    (value) => { value.revision += 1 },
    (value) => { value.connected = false },
    (value) => { value.inspection!.schemaAdmission!.hashes = [] },
    (value) => { value.inspection!.tools[0].inputSchema = { type: 'string' } },
  ]
  for (const mutate of cases) {
    const current = row()
    mutate(current)
    const source = store(current)
    assert.equal(await prepareContributionMcpLines(source, 'tenant-a', normalize()), undefined)
  }
  assert.equal(await prepareContributionMcpLines(store(), 'tenant-a', normalize(line({
    mcp: { connectionId, connectionRevision: 8, toolName: tool.name, arguments: { item: 4 } },
  }))), undefined)
})

test('current private binding recheck rejects owner/revision/schema/admission changes', async () => {
  const source = store()
  const prepared = await prepareContributionMcpLines(source, 'tenant-a', normalize())
  assert.ok(prepared)
  const stored = { ...prepared[0], id: 'line-1', used: 0 } as StoredContributionEnvelopeLine
  assert.equal(currentContributionMcpLine(source, 'tenant-a', { ...stored, mcpAuthority: undefined }), false,
    'an explicit-call line without private authority is never actionable')
  const changed = row()
  changed.inspection!.tools[0].description = 'different catalog fact'
  source.replace(changed)
  assert.equal(currentContributionMcpLine(source, 'tenant-a', stored), true, 'descriptions do not alter schema binding')
  changed.revision += 1
  source.replace(changed)
  assert.equal(currentContributionMcpLine(source, 'tenant-a', stored), false)
  assert.equal(currentContributionMcpLine(source, 'tenant-b', stored), false)
  const schemaChanged = row()
  schemaChanged.inspection!.tools[0].inputSchema = { type: 'object', additionalProperties: true }
  source.replace(schemaChanged)
  assert.equal(currentContributionMcpLine(source, 'tenant-a', stored), false)
  const disconnected = row()
  disconnected.connected = false
  source.replace(disconnected)
  assert.equal(currentContributionMcpLine(source, 'tenant-a', stored), false)
})

test('OAuth preparation forwards the explicit person to both lookups and keeps the owner private', async () => {
  const backing = store(oauthRow())
  const lookups: Array<{ surface: string; actorUserId?: string }> = []
  let member = true
  const source = {
    privateMcpConnection(id: string, tenantId: string, actorUserId?: string) {
      lookups.push({ surface: 'private', actorUserId })
      return member && actorUserId === ownerUserId ? backing.privateMcpConnection(id, tenantId) : undefined
    },
    mcpConnection(id: string, tenantId: string, actorUserId?: string) {
      lookups.push({ surface: 'public', actorUserId })
      return member && actorUserId === ownerUserId ? backing.mcpConnection(id, tenantId) : undefined
    },
  }
  const prepared = await prepareContributionMcpLines(source, 'tenant-a', normalize(), ownerUserId)
  assert.ok(prepared)
  assert.equal(prepared[0].mcpAuthority?.ownerUserId, ownerUserId)
  assert.deepEqual(lookups, [
    { surface: 'private', actorUserId: ownerUserId }, { surface: 'public', actorUserId: ownerUserId },
    { surface: 'private', actorUserId: ownerUserId }, { surface: 'public', actorUserId: ownerUserId },
  ], 'preparation and its post-validation recheck both use the person identity')
  assert.equal(JSON.stringify(prepared[0].mcp).includes(ownerUserId), false)
  const stored = { ...prepared[0], id: 'line-1', used: 0 } as StoredContributionEnvelopeLine
  assert.equal(currentContributionMcpLine(source, 'tenant-a', stored, ownerUserId), true)
  member = false
  assert.equal(currentContributionMcpLine(source, 'tenant-a', stored, ownerUserId), false,
    'loss of live owner membership invalidates an existing binding')
})

test('OAuth preparation requires an exact valid owner even when a store exposes the connection broadly', async () => {
  for (const actorUserId of [undefined, 'another-person']) {
    assert.equal(await prepareContributionMcpLines(store(oauthRow()), 'tenant-a', normalize(), actorUserId), undefined)
  }
  for (const invalidOwner of [undefined, '', ' ', 'x'.repeat(201), 'owner\u0000private', 'person-é']) {
    const malformed = { ...oauthRow(), ownerUserId: invalidOwner }
    assert.equal(await prepareContributionMcpLines(store(malformed), 'tenant-a', normalize(), invalidOwner), undefined)
  }
  const ownerStampedLegacy = { ...row(), ownerUserId }
  assert.equal(await prepareContributionMcpLines(store(ownerStampedLegacy), 'tenant-a', normalize(), ownerUserId), undefined)
})

test('stdio connections are refused before Contribution preparation and rechecks, despite an exact person-owned grant', async () => {
  const local = store(stdioRow())
  assert.equal(await prepareContributionMcpLines(local, 'tenant-a', normalize(), ownerUserId), undefined)

  const legacy = store()
  const prepared = await prepareContributionMcpLines(legacy, 'tenant-a', normalize())
  assert.ok(prepared)
  const stored = { ...prepared[0], id: 'line-1', used: 0 } as StoredContributionEnvelopeLine
  local.replace(stdioRow())
  assert.equal(currentContributionMcpLine(local, 'tenant-a', stored, ownerUserId), false)
})

test('OAuth rechecks bind the actor and stored owner, and reject owner-stamped legacy lines', async () => {
  const source = store()
  const prepared = await prepareContributionMcpLines(source, 'tenant-a', normalize(), ownerUserId)
  assert.ok(prepared)
  const legacy = { ...prepared[0], id: 'line-1', used: 0 } as StoredContributionEnvelopeLine
  assert.equal(Object.hasOwn(legacy.mcpAuthority!, 'ownerUserId'), false)
  assert.equal(currentContributionMcpLine(source, 'tenant-a', legacy), true)
  assert.equal(currentContributionMcpLine(source, 'tenant-a', legacy, 'another-person'), true)
  const bound = { ...legacy, mcpAuthority: { ...legacy.mcpAuthority!, ownerUserId } }
  assert.equal(currentContributionMcpLine(source, 'tenant-a', bound, ownerUserId), false,
    'a non-OAuth connection cannot carry a person-bound authority stamp')
  assert.equal(currentContributionMcpLine(source, 'tenant-a', {
    ...legacy, mcpAuthority: { ...legacy.mcpAuthority!, ownerUserId: undefined },
  }, ownerUserId), false, 'present undefined is not an absent owner stamp')

  source.replace(oauthRow())
  assert.equal(currentContributionMcpLine(source, 'tenant-a', bound, ownerUserId), true)
  assert.equal(currentContributionMcpLine(source, 'tenant-a', bound), false)
  assert.equal(currentContributionMcpLine(source, 'tenant-a', bound, 'another-person'), false)
  assert.equal(currentContributionMcpLine(source, 'tenant-a', legacy, ownerUserId), false,
    'an old unstamped authority never inherits the current OAuth owner')
  assert.equal(currentContributionMcpLine(source, 'tenant-a', {
    ...bound, mcpAuthority: { ...bound.mcpAuthority, ownerUserId: 'another-person' },
  }, ownerUserId), false)
  source.replace({ ...oauthRow(), ownerUserId: 'another-person' })
  assert.equal(currentContributionMcpLine(source, 'tenant-a', bound, 'another-person'), false,
    'a connection owner change cannot transfer an existing envelope authority')
})

test('OAuth preparation refuses owner authority lost while schema validation waits', async () => {
  const backing = store(oauthRow())
  let privateReads = 0
  const source = {
    privateMcpConnection(id: string, tenantId: string, actorUserId?: string) {
      privateReads += 1
      if (privateReads > 1) return undefined
      return actorUserId === ownerUserId ? backing.privateMcpConnection(id, tenantId) : undefined
    },
    mcpConnection(id: string, tenantId: string, actorUserId?: string) {
      return actorUserId === ownerUserId ? backing.mcpConnection(id, tenantId) : undefined
    },
  }
  assert.equal(await prepareContributionMcpLines(source, 'tenant-a', normalize(), ownerUserId), undefined)
  assert.equal(privateReads, 2, 'the initially available owner binding must be rechecked after worker validation')
})
