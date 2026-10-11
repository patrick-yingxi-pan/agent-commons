/** Private connection authority. No network or persistence side effects live in
 * this registry: the caller persists a transition before acknowledging it, and
 * probes outside the registry against a revision checked again at commit. */
import { createHash } from 'node:crypto'
import { EXTERNAL_MCP_ID_PREFIX, mcpConnectionContext, type McpConnectionView } from '../contract/mcpConnections.ts'
import type { SavedContext } from '../contract/contexts.ts'
import { parseOutboundEndpoint } from './outboundAddress.ts'
import { parseMcpToolsPage } from './mcpCatalog.ts'
import { MCP_SCHEMA_ADMISSION_VERSION, mcpToolSchemaHash, type McpSchemaAdmission } from './mcpToolAdmission.ts'
import { MCP_LEGACY_VERSIONS, MCP_MODERN_VERSION, type McpDiscovery } from './mcpDiscovery.ts'

export const MAX_MCP_CONNECTIONS_PER_TENANT = 64
/** Native stdio synchronization shares one process-wide bounded registry. */
export const MAX_MCP_STDIO_CONNECTIONS = 64
// Creation reserves eventual retirement space. Reaching this bound can refuse
// new setup, but can never prevent disconnecting/removing an existing server.
const MAX_CONNECTION_IDENTITIES = 4096
const credentialPattern = /^MCP_DESKTOP_[A-F0-9]{32}$/
export const MCP_STDIO_REFERENCE_PATTERN = /^MCP_STDIO_[A-F0-9]{32}$/
const idPattern = /^mcp-connection-[a-f0-9]{32}$/
const text = (value: unknown, max = 256): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f\u007f-\u009f\uD800-\uDFFF]/u.test(value)
const ownerUserId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 200 && value.trim().length > 0 && /^[\x20-\x7e]+$/.test(value)
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const revision = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0

export class McpConnectionError extends Error {
  readonly code: 'invalid' | 'missing' | 'conflict' | 'retired' | 'capacity'
  constructor(code: McpConnectionError['code']) {
    super(`MCP connection ${code}.`)
    this.code = code
  }
}
function fail(code: McpConnectionError['code']): never { throw new McpConnectionError(code) }

export function mcpConnectionCreationId(tenantId: string, logicalKey: string, actorUserId?: string): string {
  if (!text(tenantId) || !text(logicalKey)) fail('invalid')
  if (actorUserId !== undefined && !ownerUserId(actorUserId)) fail('invalid')
  const identity = actorUserId === undefined ? [tenantId, logicalKey] : ['device-oauth', actorUserId, tenantId, logicalKey]
  return `${EXTERNAL_MCP_ID_PREFIX}${createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0, 32)}`
}

/** Person-owned stdio identities use a disjoint namespace; existing HTTP IDs
 * remain byte-for-byte stable for legacy request replay. */
export function mcpStdioConnectionCreationId(tenantId: string, logicalKey: string, actorUserId: string): string {
  if (!text(tenantId) || !text(logicalKey) || !ownerUserId(actorUserId)) fail('invalid')
  return `${EXTERNAL_MCP_ID_PREFIX}${createHash('sha256')
    .update(JSON.stringify(['stdio', actorUserId, tenantId, logicalKey])).digest('hex').slice(0, 32)}`
}

/** Network scope is deployment-owned, never accepted from a connection form.
 * DNS and the actual socket are still re-admitted by the transport on each use. */
export function mcpConnectionEndpoint(raw: string, allowLoopback: boolean): { endpoint: string; scope: 'public' | 'loopback' } {
  try { return { endpoint: parseOutboundEndpoint(raw, 'public').href, scope: 'public' } }
  catch {
    if (allowLoopback) {
      try { return { endpoint: parseOutboundEndpoint(raw, 'loopback').href, scope: 'loopback' } }
      catch { /* Fixed error below; no endpoint reflection. */ }
    }
    return fail('invalid')
  }
}

interface PrivateMcpConnectionBase {
  tenantId: string
  id: string
  label: string
  revision: number
  connected: boolean
  inspection?: McpDiscovery & { inspectedAt: number }
  inspectionOperation?: McpInspectionOperation
}
export interface PrivateHttpMcpConnection extends PrivateMcpConnectionBase {
  transport?: 'http'
  ownerUserId?: string
  endpoint: string
  authentication: 'none' | 'device-bearer' | 'device-oauth'
  credentialReference?: string
  grantReference?: never
}
export interface PrivateStdioMcpConnection extends PrivateMcpConnectionBase {
  transport: 'stdio'
  ownerUserId: string
  endpoint?: never
  authentication?: never
  credentialReference?: never
  grantReference?: string
}
export type PrivateMcpConnection = PrivateHttpMcpConnection | PrivateStdioMcpConnection
export interface McpInspectionOperation { id: string; fingerprint: string }
export interface McpConnectionState {
  connections: PrivateMcpConnection[]
  retired: Array<{ tenantId: string; id: string; ownerUserId?: string; transport?: 'stdio' }>
}
export interface McpHttpConnectionSetup {
  transport?: 'http'
  id: string
  label: string
  endpoint: string
  authentication: 'none' | 'device-bearer' | 'device-oauth'
}
export interface McpStdioConnectionSetup {
  transport: 'stdio'
  id: string
  label: string
}
export type McpConnectionSetup = McpHttpConnectionSetup | McpStdioConnectionSetup

function publicView(row: PrivateMcpConnection): McpConnectionView {
  const admitted = row.inspection?.schemaAdmission
  const executableTools = row.connected && admitted?.version === MCP_SCHEMA_ADMISSION_VERSION
    ? row.inspection!.tools.filter(tool => admitted.hashes.includes(mcpToolSchemaHash(tool))).map(tool => tool.name)
    : []
  const status: McpConnectionView['status'] = row.connected ? 'connected' : row.inspection ? 'disconnected' : 'unverified'
  const execution: McpConnectionView['execution'] = executableTools.length ? 'approval-required' : 'unavailable'
  const common = {
    id: row.id, label: row.label, revision: row.revision,
    status,
    protocolVersion: row.inspection?.protocolVersion ?? null,
    inspectedAt: row.inspection?.inspectedAt ?? null,
    tools: structuredClone(row.inspection?.tools ?? []), execution,
    ...(admitted ? { executableTools } : {}),
    inspectionOperationId: row.inspectionOperation?.id ?? null,
  }
  return row.transport === 'stdio'
    ? { ...common, transport: 'stdio' }
    : { ...common, transport: 'http', authentication: row.authentication }
}
function checkedOperation(value: unknown): McpInspectionOperation {
  if (!object(value) || Object.keys(value).length !== 2 || !text(value.id, 128) ||
      !/^[\x20-\x7e]+$/.test(value.id) || typeof value.fingerprint !== 'string' ||
      !/^[a-f0-9]{64}$/.test(value.fingerprint)) fail('invalid')
  return { id: value.id, fingerprint: value.fingerprint }
}
function checkedInspection(value: unknown): PrivateMcpConnection['inspection'] {
  if (!object(value) || !revision(value.inspectedAt) ||
      (value.protocolVersion !== MCP_MODERN_VERSION && !MCP_LEGACY_VERSIONS.some(version => value.protocolVersion === version)) ||
      typeof value.cleanup !== 'string' ||
      !['not-needed', 'released', 'server-managed', 'unconfirmed'].includes(value.cleanup)) fail('invalid')
  const { tools } = parseMcpToolsPage({ tools: value.tools })
  let schemaAdmission: McpSchemaAdmission | undefined
  if (value.schemaAdmission !== undefined) {
    const admission = value.schemaAdmission
    if (!object(admission) || Object.keys(admission).some(key => key !== 'version' && key !== 'hashes') ||
        !Number.isSafeInteger(admission.version) || typeof admission.version !== 'number' || admission.version < 1 ||
        !Array.isArray(admission.hashes) || admission.hashes.length > tools.length ||
        admission.hashes.some(hash => typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) ||
        new Set(admission.hashes).size !== admission.hashes.length) fail('invalid')
    const currentHashes = new Set(tools.map(mcpToolSchemaHash))
    if (admission.hashes.some(hash => !currentHashes.has(hash as string))) fail('invalid')
    schemaAdmission = { version: admission.version, hashes: admission.hashes as string[] }
  }
  // Retain only catalog/protocol facts. Remote instructions and server-supplied
  // identity are unnecessary to this authoritative saved-connection record.
  return { tools, protocolVersion: value.protocolVersion as string,
    cleanup: value.cleanup as McpDiscovery['cleanup'], inspectedAt: value.inspectedAt as number,
    ...(schemaAdmission ? { schemaAdmission } : {}) }
}

/** Strict, detached additive-slice admission. Absence alone means an old empty
 * registry; a present malformed slice must fail startup/restore, not erase it. */
export function parseMcpConnectionState(value: unknown): McpConnectionState {
  if (value === undefined) return { connections: [], retired: [] }
  if (!object(value) || Object.keys(value).some(key => key !== 'connections' && key !== 'retired') ||
      !Array.isArray(value.connections) || !Array.isArray(value.retired) ||
      value.connections.length + value.retired.length > MAX_CONNECTION_IDENTITIES) fail('invalid')
  const seen = new Set<string>()
  const credentialReferences = new Set<string>()
  const grantReferences = new Set<string>()
  const counts = new Map<string, number>()
  let stdioCount = 0
  const claim = (tenantId: unknown, id: unknown) => {
    if (!text(tenantId) || typeof id !== 'string' || !idPattern.test(id)) fail('invalid')
    const key = JSON.stringify([tenantId, id])
    if (seen.has(key)) fail('invalid')
    seen.add(key)
  }
  const connections = value.connections.map((entry): PrivateMcpConnection => {
    if (!object(entry) || Object.keys(entry).some(key => !['transport', 'tenantId', 'ownerUserId', 'id', 'label', 'endpoint', 'authentication', 'credentialReference', 'grantReference', 'revision', 'connected', 'inspection', 'inspectionOperation'].includes(key))) fail('invalid')
    claim(entry.tenantId, entry.id)
    if (!text(entry.label) || !revision(entry.revision) || typeof entry.connected !== 'boolean' ||
        (entry.transport !== undefined && entry.transport !== 'http' && entry.transport !== 'stdio')) fail('invalid')
    const isStdio = entry.transport === 'stdio'
    if (isStdio) {
      if (++stdioCount > MAX_MCP_STDIO_CONNECTIONS) fail('capacity')
      if (Object.hasOwn(entry, 'endpoint') || Object.hasOwn(entry, 'authentication') || Object.hasOwn(entry, 'credentialReference') ||
          !ownerUserId(entry.ownerUserId)) fail('invalid')
    } else {
      if (typeof entry.endpoint !== 'string' || typeof entry.authentication !== 'string' ||
          !['none', 'device-bearer', 'device-oauth'].includes(entry.authentication) || Object.hasOwn(entry, 'grantReference')) fail('invalid')
    }
    const isOAuth = !isStdio && entry.authentication === 'device-oauth'
    if (!isStdio && (isOAuth ? !ownerUserId(entry.ownerUserId) : Object.hasOwn(entry, 'ownerUserId'))) fail('invalid')
    const tenantId = entry.tenantId as string
    const count = (counts.get(tenantId) ?? 0) + 1
    if (count > MAX_MCP_CONNECTIONS_PER_TENANT) fail('capacity')
    counts.set(tenantId, count)
    const endpoint = isStdio ? undefined : mcpConnectionEndpoint(entry.endpoint as string, !isOAuth).endpoint
    if (!isStdio && endpoint !== entry.endpoint) fail('invalid')
    if (entry.inspection !== undefined && (!object(entry.inspection) || Object.keys(entry.inspection).some(key =>
      !['protocolVersion', 'tools', 'cleanup', 'inspectedAt', 'schemaAdmission'].includes(key)))) fail('invalid')
    const inspection = entry.inspection === undefined ? undefined : checkedInspection(entry.inspection)
    const inspectionOperation = entry.inspectionOperation === undefined ? undefined : checkedOperation(entry.inspectionOperation)
    if (inspectionOperation && !inspection) fail('invalid')
    if (isStdio) {
      if (entry.grantReference !== undefined && (typeof entry.grantReference !== 'string' || !MCP_STDIO_REFERENCE_PATTERN.test(entry.grantReference))) fail('invalid')
      if (entry.connected && (!inspection || !entry.grantReference)) fail('invalid')
      if (!entry.connected && entry.grantReference !== undefined) fail('invalid')
      if (entry.grantReference !== undefined) {
        if (grantReferences.has(entry.grantReference)) fail('invalid')
        grantReferences.add(entry.grantReference)
      }
      return { transport: 'stdio', tenantId, ownerUserId: entry.ownerUserId as string, id: entry.id as string,
        label: entry.label, revision: entry.revision, connected: entry.connected, ...(inspection ? { inspection } : {}),
        ...(inspectionOperation ? { inspectionOperation } : {}),
        ...(entry.grantReference === undefined ? {} : { grantReference: entry.grantReference as string }) }
    }
    if (entry.credentialReference !== undefined && (typeof entry.credentialReference !== 'string' || !credentialPattern.test(entry.credentialReference))) fail('invalid')
    if (entry.connected && (!inspection || (entry.authentication !== 'none' && !entry.credentialReference))) fail('invalid')
    if (entry.credentialReference !== undefined && (!entry.connected || entry.authentication === 'none')) fail('invalid')
    if (entry.credentialReference !== undefined) {
      if (credentialReferences.has(entry.credentialReference)) fail('invalid')
      credentialReferences.add(entry.credentialReference)
    }
    return { ...(entry.transport === 'http' ? { transport: 'http' as const } : {}), tenantId, ...(isOAuth ? { ownerUserId: entry.ownerUserId as string } : {}),
      id: entry.id as string, label: entry.label, endpoint: endpoint!,
      authentication: entry.authentication as PrivateHttpMcpConnection['authentication'], revision: entry.revision,
      connected: entry.connected, ...(inspection ? { inspection } : {}),
      ...(inspectionOperation ? { inspectionOperation } : {}),
      ...(entry.credentialReference === undefined ? {} : { credentialReference: entry.credentialReference as string }) }
  })
  const retired = value.retired.map((entry) => {
    if (!object(entry) || Object.keys(entry).some(key => key !== 'tenantId' && key !== 'id' && key !== 'ownerUserId' && key !== 'transport') ||
        (Object.hasOwn(entry, 'ownerUserId') && !ownerUserId(entry.ownerUserId))) fail('invalid')
    if (entry.transport !== undefined && entry.transport !== 'stdio') fail('invalid')
    if (entry.transport === 'stdio' && !ownerUserId(entry.ownerUserId)) fail('invalid')
    claim(entry.tenantId, entry.id)
    return { tenantId: entry.tenantId as string, id: entry.id as string,
      ...(Object.hasOwn(entry, 'ownerUserId') ? { ownerUserId: entry.ownerUserId as string } : {}),
      ...(entry.transport === 'stdio' ? { transport: 'stdio' as const } : {}) }
  })
  return { connections, retired }
}

export function createMcpConnectionRegistry() {
  let state: McpConnectionState = { connections: [], retired: [] }
  const find = (id: string, tenantId: string) => state.connections.find(row => row.id === id && row.tenantId === tenantId)
  const visibleTo = (row: PrivateMcpConnection, actorUserId?: string) =>
    row.ownerUserId === undefined || (ownerUserId(actorUserId) && row.ownerUserId === actorUserId)
  const findVisible = (id: string, tenantId: string, actorUserId?: string) => {
    const row = find(id, tenantId)
    return row && visibleTo(row, actorUserId) ? row : undefined
  }
  const retiredVisible = (row: McpConnectionState['retired'][number], actorUserId?: string) =>
    row.ownerUserId === undefined || (ownerUserId(actorUserId) && row.ownerUserId === actorUserId)
  const requireCurrent = (id: string, tenantId: string, expectedRevision: number, actorUserId?: string) => {
    const row = findVisible(id, tenantId, actorUserId) ?? fail('missing')
    if (!revision(expectedRevision)) fail('invalid')
    if (row.revision !== expectedRevision || row.revision === Number.MAX_SAFE_INTEGER) fail('conflict')
    return row
  }
  return {
    snapshot(): McpConnectionState { return structuredClone(state) },
    rehydrate(value: unknown) { state = parseMcpConnectionState(value) },
    privateConnection(id: string, tenantId: string, actorUserId?: string): PrivateMcpConnection | undefined {
      const row = findVisible(id, tenantId, actorUserId)
      return row ? structuredClone(row) : undefined
    },
    view(id: string, tenantId: string, actorUserId?: string): McpConnectionView | undefined {
      const row = findVisible(id, tenantId, actorUserId)
      return row ? publicView(row) : undefined
    },
    list(tenantId: string, actorUserId?: string): McpConnectionView[] {
      return state.connections.filter(row => row.tenantId === tenantId && visibleTo(row, actorUserId)).map(publicView)
    },
    savedContexts(tenantId: string, actorUserId?: string): SavedContext[] {
      return state.connections.filter(row => row.tenantId === tenantId && visibleTo(row, actorUserId))
        .map(row => mcpConnectionContext(publicView(row)))
    },
    create(setup: McpConnectionSetup, tenantId: string, allowLoopback = false, actorUserId?: string): { connection: McpConnectionView; created: boolean } {
      if (!text(tenantId) || typeof setup.id !== 'string' || !idPattern.test(setup.id) || !text(setup.label)) fail('invalid')
      const isStdio = setup.transport === 'stdio'
      const httpSetup = isStdio ? undefined : setup as McpHttpConnectionSetup
      const isOAuth = httpSetup?.authentication === 'device-oauth'
      if ((isStdio || isOAuth) && !ownerUserId(actorUserId)) fail('invalid')
      if (!isStdio && !['none', 'device-bearer', 'device-oauth'].includes(httpSetup!.authentication)) fail('invalid')
      const endpoint = isStdio ? undefined : mcpConnectionEndpoint(httpSetup!.endpoint, isOAuth ? false : allowLoopback).endpoint
      const retired = state.retired.find(row => row.id === setup.id && row.tenantId === tenantId)
      if (retired) {
        if (!retiredVisible(retired, actorUserId)) fail('missing')
        fail('retired')
      }
      const existing = find(setup.id, tenantId)
      if (existing) {
        if (!visibleTo(existing, actorUserId)) fail('missing')
        if (existing.label !== setup.label) fail('conflict')
        if (isStdio) {
          if (existing.transport !== 'stdio' || existing.ownerUserId !== actorUserId) fail('conflict')
        } else if (existing.transport === 'stdio' || existing.endpoint !== endpoint ||
            existing.authentication !== httpSetup!.authentication) fail('conflict')
        return { connection: publicView(existing), created: false }
      }
      if (state.connections.length + state.retired.length >= MAX_CONNECTION_IDENTITIES) fail('capacity')
      if (state.connections.filter(row => row.tenantId === tenantId).length >= MAX_MCP_CONNECTIONS_PER_TENANT) fail('capacity')
      if (isStdio && state.connections.filter(row => row.transport === 'stdio').length >= MAX_MCP_STDIO_CONNECTIONS) fail('capacity')
      const row: PrivateMcpConnection = isStdio
        ? { transport: 'stdio', id: setup.id, label: setup.label, tenantId, ownerUserId: actorUserId!, revision: 0, connected: false }
        : { ...(setup.transport === 'http' ? { transport: 'http' as const } : {}), id: setup.id, label: setup.label, endpoint: endpoint!, authentication: httpSetup!.authentication as PrivateHttpMcpConnection['authentication'],
          tenantId, ...(isOAuth ? { ownerUserId: actorUserId! } : {}), revision: 0, connected: false }
      state.connections.push(row)
      return { connection: publicView(row), created: true }
    },
    commitInspection(id: string, tenantId: string, expectedRevision: number, discovery: McpDiscovery, inspectedAt: number,
      credentialReference?: string, operation?: McpInspectionOperation, actorUserId?: string, grantReference?: string): McpConnectionView {
      const row = requireCurrent(id, tenantId, expectedRevision, actorUserId)
      const receipt = operation === undefined ? undefined : checkedOperation(operation)
      if (receipt && row.inspectionOperation?.id === receipt.id) fail('conflict')
      if (row.transport === 'stdio') {
        if (credentialReference !== undefined || !grantReference || !MCP_STDIO_REFERENCE_PATTERN.test(grantReference) ||
            actorUserId !== row.ownerUserId) fail('invalid')
      } else if (grantReference !== undefined ||
          (row.authentication !== 'none' ? !credentialReference || !credentialPattern.test(credentialReference) : credentialReference !== undefined)) fail('invalid')
      if (credentialReference && state.connections.some(candidate => candidate !== row && candidate.credentialReference === credentialReference)) fail('conflict')
      if (grantReference && state.connections.some(candidate => candidate !== row && candidate.transport === 'stdio' && candidate.grantReference === grantReference)) fail('conflict')
      const inspection = checkedInspection({ ...discovery, inspectedAt })!
      row.inspection = inspection
      if (receipt) row.inspectionOperation = receipt
      else delete row.inspectionOperation
      row.connected = true
      row.revision += 1
      if (credentialReference) row.credentialReference = credentialReference
      if (grantReference && row.transport === 'stdio') row.grantReference = grantReference
      return publicView(row)
    },
    disconnect(id: string, tenantId: string, expectedRevision: number, actorUserId?: string): McpConnectionView {
      const row = requireCurrent(id, tenantId, expectedRevision, actorUserId)
      // Advance even an unverified row: it invalidates a concurrent inspection.
      row.connected = false
      if (row.transport === 'stdio') delete row.grantReference
      else delete row.credentialReference
      row.revision += 1
      return publicView(row)
    },
    remove(id: string, tenantId: string, expectedRevision: number, actorUserId?: string): boolean {
      const retired = state.retired.find(row => row.id === id && row.tenantId === tenantId)
      if (retired) {
        if (!retiredVisible(retired, actorUserId)) fail('missing')
        return false
      }
      const row = requireCurrent(id, tenantId, expectedRevision, actorUserId)
      state.connections = state.connections.filter(candidate => candidate !== row)
      state.retired.push({ id, tenantId, ...(row.ownerUserId === undefined ? {} : { ownerUserId: row.ownerUserId }),
        ...(row.transport === 'stdio' ? { transport: 'stdio' as const } : {}) })
      return true
    },
    credentialBindings() {
      return state.connections.flatMap(row => row.transport !== 'stdio' && row.connected && row.credentialReference ? [{
        reference: row.credentialReference, binding: { tenantId: row.tenantId, connectionId: row.id, endpoint: row.endpoint },
      }] : [])
    },
    stdioBindings() {
      return state.connections.flatMap(row => row.transport === 'stdio' ? [{
        reference: row.connected ? row.grantReference ?? null : null,
        binding: { tenantId: row.tenantId, ownerUserId: row.ownerUserId, connectionId: row.id, connectionRevision: row.revision },
      }] : [])
    },
  }
}
