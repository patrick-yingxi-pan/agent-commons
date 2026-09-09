/** Connects the bounded protocol client to private connection authority. This
 * is deliberately not a tool executor. The route must supply its authenticated
 * tenant; the credential resolver belongs to the deployment, not the request. */
import type { McpConnectionView } from '../contract/mcpConnections.ts'
import { discoverMcpTools, type McpDiscovery } from './mcpDiscovery.ts'
import { McpConnectionError, mcpConnectionEndpoint, type PrivateMcpConnection, type McpInspectionOperation } from './mcpConnections.ts'
import { admitMcpCatalog, McpSchemaAdmissionError } from './mcpToolAdmission.ts'

import type { McpCredentialBinding } from '../contract/mcpConnections.ts'
export type { McpCredentialBinding } from '../contract/mcpConnections.ts'
export type McpCredentialResolver = (reference: string, binding: McpCredentialBinding) => Promise<string>
export interface McpInspectionStore {
  privateMcpConnection(id: string, tenantId: string): PrivateMcpConnection | undefined
  commitMcpInspection(id: string, tenantId: string, expectedRevision: number, discovery: McpDiscovery,
    inspectedAt: number, credentialReference?: string, operation?: McpInspectionOperation): McpConnectionView
}
export class McpInspectionError extends Error {
  readonly code: 'credentials_unavailable' | 'cancelled' | 'timeout' | 'busy'
  constructor(code: McpInspectionError['code']) {
    super(`MCP inspection failed (${code}).`)
    this.code = code
  }
}

export function createMcpConnectionInspector({
  store, discover = discoverMcpTools, resolveCredential, allowLoopback = false,
  timeoutMs = 30_000, now = Date.now,
}: {
  store: McpInspectionStore
  discover?: typeof discoverMcpTools
  resolveCredential?: McpCredentialResolver
  allowLoopback?: boolean
  timeoutMs?: number
  now?: () => number
}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new McpConnectionError('invalid')
  const active = new Set<string>()
  return async (id: string, tenantId: string, expectedRevision: number,
    { credentialReference: replacementReference, signal, operation }: { credentialReference?: string; signal?: AbortSignal; operation?: McpInspectionOperation } = {}): Promise<McpConnectionView> => {
    const row = store.privateMcpConnection(id, tenantId)
    if (!row) throw new McpConnectionError('missing')
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new McpConnectionError('invalid')
    if (row.revision !== expectedRevision) throw new McpConnectionError('conflict')
    // A refresh may reuse only this exact revision's private credential. A
    // disconnect removes it, so reconnect must provision a fresh reference.
    const credentialReference = replacementReference ?? row.credentialReference
    const { endpoint, scope } = mcpConnectionEndpoint(row.endpoint, allowLoopback)
    if (row.authentication === 'device-bearer') {
      if (!resolveCredential) throw new McpInspectionError('credentials_unavailable')
      if (typeof credentialReference !== 'string' || !/^MCP_DESKTOP_[A-F0-9]{32}$/.test(credentialReference)) throw new McpConnectionError('invalid')
    } else if (credentialReference !== undefined) throw new McpConnectionError('invalid')
    if (signal?.aborted) throw new McpInspectionError('cancelled')
    const key = JSON.stringify([tenantId, id])
    if (active.has(key) || active.size >= 16) throw new McpInspectionError('busy')
    active.add(key)
    const controller = new AbortController()
    let stopReason: McpInspectionError | undefined
    let rejectStopped!: (error: McpInspectionError) => void
    const stopped = new Promise<never>((_resolve, reject) => { rejectStopped = reject })
    void stopped.catch(() => {})
    const stop = (code: 'cancelled' | 'timeout') => {
      if (stopReason) return
      stopReason = new McpInspectionError(code)
      controller.abort()
      rejectStopped(stopReason)
    }
    const cancelled = () => stop('cancelled')
    signal?.addEventListener('abort', cancelled, { once: true })
    const timer = setTimeout(() => stop('timeout'), timeoutMs)
    const started = performance.now()
    const ensureCurrent = () => {
      if (stopReason) throw stopReason
      if (performance.now() - started >= timeoutMs) { stop('timeout'); throw stopReason }
      const current = store.privateMcpConnection(id, tenantId)
      if (!current) throw new McpConnectionError('missing')
      if (current.revision !== expectedRevision) throw new McpConnectionError('conflict')
    }
    try {
      let bearerToken: string | undefined
      if (credentialReference) {
        try {
          bearerToken = await Promise.race([Promise.resolve().then(() => resolveCredential!(credentialReference,
            { tenantId, connectionId: id, endpoint })), stopped])
        } catch {
          if (stopReason) throw stopReason
          throw new McpInspectionError('credentials_unavailable')
        }
        if (typeof bearerToken !== 'string' || bearerToken.length < 1 || bearerToken.length > 8192 || /[^\x21-\x7e]/.test(bearerToken)) {
          throw new McpInspectionError('credentials_unavailable')
        }
      }
      // Credential resolution can outlive a disconnect or remove. Revalidate
      // before sending anything to the endpoint, and again after discovery.
      ensureCurrent()
      const discovery = await Promise.race([discover(endpoint, { scope, bearerToken, signal: controller.signal,
        timeoutMs: Math.max(1, Math.floor(timeoutMs - (performance.now() - started))) }), stopped])
      ensureCurrent()
      const schemaAdmission = await Promise.race([admitMcpCatalog(discovery.tools, { signal: controller.signal }), stopped])
      ensureCurrent()
      return store.commitMcpInspection(id, tenantId, expectedRevision, { ...discovery, schemaAdmission }, now(), credentialReference, operation)
    } catch (error) {
      if (stopReason) throw stopReason
      if (error instanceof McpSchemaAdmissionError) throw new McpInspectionError(error.code === 'cancelled' ? 'cancelled' : 'busy')
      throw error
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', cancelled)
      controller.abort()
      active.delete(key)
    }
  }
}
