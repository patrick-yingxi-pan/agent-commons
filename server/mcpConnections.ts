/** Private connection authority. No network or persistence side effects live in
 * this registry: the caller persists a transition before acknowledging it, and
 * probes outside the registry against a revision checked again at commit. */
import { createHash } from 'node:crypto'
import { EXTERNAL_MCP_ID_PREFIX, type McpConnectionView } from '../contract/mcpConnections.ts'
import type { SavedContext } from '../contract/contexts.ts'
import { parseOutboundEndpoint } from './outboundAddress.ts'
import { parseMcpToolsPage } from './mcpCatalog.ts'
import { MCP_LEGACY_VERSIONS, MCP_MODERN_VERSION, type McpDiscovery } from './mcpDiscovery.ts'

export const MAX_MCP_CONNECTIONS_PER_TENANT = 64
// Creation reserves eventual retirement space. Reaching this bound can refuse
// new setup, but can never prevent disconnecting/removing an existing server.
const MAX_CONNECTION_IDENTITIES = 4096
const credentialPattern = /^MCP_DESKTOP_[A-F0-9]{32}$/
const idPattern = /^mcp-connection-[a-f0-9]{32}$/
const text = (value: unknown, max = 256): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f\u007f-\u009f\uD800-\uDFFF]/u.test(value)
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

export function mcpConnectionCreationId(tenantId: string, logicalKey: string): string {
  if (!text(tenantId) || !text(logicalKey)) fail('invalid')
  return `${EXTERNAL_MCP_ID_PREFIX}${createHash('sha256').update(JSON.stringify([tenantId, logicalKey])).digest('hex').slice(0, 32)}`
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

export interface PrivateMcpConnection {
  tenantId: string
  id: string
  label: string
  endpoint: string
  authentication: McpConnectionView['authentication']
  credentialReference?: string
  revision: number
  connected: boolean
  inspection?: McpDiscovery & { inspectedAt: number }
}
export interface McpConnectionState {
  connections: PrivateMcpConnection[]
  retired: Array<{ tenantId: string; id: string }>
}
export interface McpConnectionSetup {
  id: string
  label: string
  endpoint: string
  authentication: McpConnectionView['authentication']
}

function publicView(row: PrivateMcpConnection): McpConnectionView {
  return {
    id: row.id, label: row.label, revision: row.revision, authentication: row.authentication,
    status: row.connected ? 'connected' : row.inspection ? 'disconnected' : 'unverified',
    protocolVersion: row.inspection?.protocolVersion ?? null,
    inspectedAt: row.inspection?.inspectedAt ?? null,
    tools: structuredClone(row.inspection?.tools ?? []), execution: 'unavailable',
  }
}
function checkedInspection(value: unknown): PrivateMcpConnection['inspection'] {
  if (!object(value) || !revision(value.inspectedAt) ||
      (value.protocolVersion !== MCP_MODERN_VERSION && !MCP_LEGACY_VERSIONS.some(version => value.protocolVersion === version)) ||
      typeof value.cleanup !== 'string' ||
      !['not-needed', 'released', 'server-managed', 'unconfirmed'].includes(value.cleanup)) fail('invalid')
  const { tools } = parseMcpToolsPage({ tools: value.tools })
  // Retain only catalog/protocol facts. Remote instructions and server-supplied
  // identity are unnecessary to this authoritative saved-connection record.
  return { tools, protocolVersion: value.protocolVersion as string,
    cleanup: value.cleanup as McpDiscovery['cleanup'], inspectedAt: value.inspectedAt as number }
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
  const counts = new Map<string, number>()
  const claim = (tenantId: unknown, id: unknown) => {
    if (!text(tenantId) || typeof id !== 'string' || !idPattern.test(id)) fail('invalid')
    const key = JSON.stringify([tenantId, id])
    if (seen.has(key)) fail('invalid')
    seen.add(key)
  }
  const connections = value.connections.map((entry): PrivateMcpConnection => {
    if (!object(entry) || Object.keys(entry).some(key => !['tenantId', 'id', 'label', 'endpoint', 'authentication', 'credentialReference', 'revision', 'connected', 'inspection'].includes(key))) fail('invalid')
    claim(entry.tenantId, entry.id)
    if (!text(entry.label) || typeof entry.endpoint !== 'string' || !revision(entry.revision) ||
        typeof entry.connected !== 'boolean' || typeof entry.authentication !== 'string' ||
        !['none', 'device-bearer'].includes(entry.authentication)) fail('invalid')
    const tenantId = entry.tenantId as string
    const count = (counts.get(tenantId) ?? 0) + 1
    if (count > MAX_MCP_CONNECTIONS_PER_TENANT) fail('capacity')
    counts.set(tenantId, count)
    const endpoint = mcpConnectionEndpoint(entry.endpoint, true).endpoint
    if (endpoint !== entry.endpoint) fail('invalid')
    if (entry.inspection !== undefined && (!object(entry.inspection) || Object.keys(entry.inspection).some(key =>
      !['protocolVersion', 'tools', 'cleanup', 'inspectedAt'].includes(key)))) fail('invalid')
    const inspection = entry.inspection === undefined ? undefined : checkedInspection(entry.inspection)
    if (entry.credentialReference !== undefined && (typeof entry.credentialReference !== 'string' || !credentialPattern.test(entry.credentialReference))) fail('invalid')
    if (entry.connected && (!inspection || (entry.authentication === 'device-bearer' && !entry.credentialReference))) fail('invalid')
    if (entry.credentialReference !== undefined && (!entry.connected || entry.authentication !== 'device-bearer')) fail('invalid')
    if (entry.credentialReference !== undefined) {
      if (credentialReferences.has(entry.credentialReference)) fail('invalid')
      credentialReferences.add(entry.credentialReference)
    }
    return { tenantId, id: entry.id as string, label: entry.label, endpoint,
      authentication: entry.authentication as PrivateMcpConnection['authentication'], revision: entry.revision,
      connected: entry.connected, ...(inspection ? { inspection } : {}),
      ...(entry.credentialReference === undefined ? {} : { credentialReference: entry.credentialReference as string }) }
  })
  const retired = value.retired.map((entry) => {
    if (!object(entry) || Object.keys(entry).some(key => key !== 'tenantId' && key !== 'id')) fail('invalid')
    claim(entry.tenantId, entry.id)
    return { tenantId: entry.tenantId as string, id: entry.id as string }
  })
  return { connections, retired }
}

export function createMcpConnectionRegistry() {
  let state: McpConnectionState = { connections: [], retired: [] }
  const find = (id: string, tenantId: string) => state.connections.find(row => row.id === id && row.tenantId === tenantId)
  const requireCurrent = (id: string, tenantId: string, expectedRevision: number) => {
    const row = find(id, tenantId) ?? fail('missing')
    if (!revision(expectedRevision)) fail('invalid')
    if (row.revision !== expectedRevision || row.revision === Number.MAX_SAFE_INTEGER) fail('conflict')
    return row
  }
  return {
    snapshot(): McpConnectionState { return structuredClone(state) },
    rehydrate(value: unknown) { state = parseMcpConnectionState(value) },
    privateConnection(id: string, tenantId: string): PrivateMcpConnection | undefined {
      const row = find(id, tenantId)
      return row ? structuredClone(row) : undefined
    },
    view(id: string, tenantId: string): McpConnectionView | undefined {
      const row = find(id, tenantId)
      return row ? publicView(row) : undefined
    },
    list(tenantId: string): McpConnectionView[] {
      return state.connections.filter(row => row.tenantId === tenantId).map(publicView)
    },
    savedContexts(tenantId: string): SavedContext[] {
      return state.connections.filter(row => row.tenantId === tenantId).map(row => ({
        id: row.id, label: row.label, kind: 'mcp', status: row.connected ? 'connected' : 'needs-auth',
        connectionRevision: row.revision, lastUsedAt: null, sessions: 0,
        detail: row.connected ? `External MCP · ${row.inspection!.tools.length} tools inspected` : 'External MCP · connection required',
      }))
    },
    create(setup: McpConnectionSetup, tenantId: string, allowLoopback = false): { connection: McpConnectionView; created: boolean } {
      if (!text(tenantId) || typeof setup.id !== 'string' || !idPattern.test(setup.id) || !text(setup.label) ||
          !['none', 'device-bearer'].includes(setup.authentication)) fail('invalid')
      const endpoint = mcpConnectionEndpoint(setup.endpoint, allowLoopback).endpoint
      if (state.retired.some(row => row.id === setup.id && row.tenantId === tenantId)) fail('retired')
      const existing = find(setup.id, tenantId)
      if (existing) {
        if (existing.endpoint !== endpoint || existing.label !== setup.label || existing.authentication !== setup.authentication) fail('conflict')
        return { connection: publicView(existing), created: false }
      }
      if (state.connections.length + state.retired.length >= MAX_CONNECTION_IDENTITIES) fail('capacity')
      if (state.connections.filter(row => row.tenantId === tenantId).length >= MAX_MCP_CONNECTIONS_PER_TENANT) fail('capacity')
      const row: PrivateMcpConnection = { id: setup.id, label: setup.label, endpoint,
        authentication: setup.authentication, tenantId, revision: 0, connected: false }
      state.connections.push(row)
      return { connection: publicView(row), created: true }
    },
    commitInspection(id: string, tenantId: string, expectedRevision: number, discovery: McpDiscovery, inspectedAt: number, credentialReference?: string): McpConnectionView {
      const row = requireCurrent(id, tenantId, expectedRevision)
      if (row.authentication === 'device-bearer' ? !credentialReference || !credentialPattern.test(credentialReference) : credentialReference !== undefined) fail('invalid')
      if (credentialReference && state.connections.some(candidate => candidate !== row && candidate.credentialReference === credentialReference)) fail('conflict')
      const inspection = checkedInspection({ ...discovery, inspectedAt })!
      row.inspection = inspection
      row.connected = true
      row.revision += 1
      if (credentialReference) row.credentialReference = credentialReference
      return publicView(row)
    },
    disconnect(id: string, tenantId: string, expectedRevision: number): McpConnectionView {
      const row = requireCurrent(id, tenantId, expectedRevision)
      // Advance even an unverified row: it invalidates a concurrent inspection.
      row.connected = false
      delete row.credentialReference
      row.revision += 1
      return publicView(row)
    },
    remove(id: string, tenantId: string, expectedRevision: number): boolean {
      if (state.retired.some(row => row.id === id && row.tenantId === tenantId)) return false
      const row = requireCurrent(id, tenantId, expectedRevision)
      state.connections = state.connections.filter(candidate => candidate !== row)
      state.retired.push({ id, tenantId })
      return true
    },
    credentialBindings() {
      return state.connections.flatMap(row => row.connected && row.credentialReference ? [{
        reference: row.credentialReference, binding: { tenantId: row.tenantId, connectionId: row.id, endpoint: row.endpoint },
      }] : [])
    },
  }
}
