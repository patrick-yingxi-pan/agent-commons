import type {
  McpConnectionCreateResult,
  McpConnectionLifecycleRequest,
  McpConnectionMutationResult,
  McpConnectionRemovalResult,
  McpConnectionView,
} from '../../contract/mcpConnections.ts'
import { apiDelete, apiPost } from './client.ts'
import { paths } from './keys.ts'
import type { McpConnectionMutationIntent } from './mcpConnectionIntent.ts'
import {
  cleanupIsUncertain,
  cleanupIsKnownPending,
  getMcpConnection,
  markCleanupComplete,
  markCleanupPending,
  mcpHttpSignal,
  rememberConnection,
  rememberCredentialCleanup,
  rememberRemoval,
} from './mcpConnectionReads.ts'

export type McpConnectionMutationResponse = McpConnectionCreateResult | McpConnectionMutationResult | McpConnectionRemovalResult
export const MCP_MUTATION_TIMEOUT_MS = 45_000

export class McpCredentialCleanupPendingError extends Error {
  constructor() {
    super('MCP credential cleanup remains pending.')
    this.name = 'McpCredentialCleanupPendingError'
  }
}

export class McpCredentialCleanupUncertainError extends Error {
  constructor() {
    super('The MCP connection change and device credential cleanup could not be confirmed.')
    this.name = 'McpCredentialCleanupUncertainError'
  }
}

function cleanupReconciliationError(idempotencyKey: string): Error {
  return cleanupIsKnownPending(idempotencyKey)
    ? new McpCredentialCleanupPendingError()
    : new McpCredentialCleanupUncertainError()
}

function isConfirmedInspectionRefusal(cause: unknown): boolean {
  const error = cause as { code?: string; status?: number } | undefined
  // Inspection has not committed a durable state transition before the
  // upstream catalog/auth check succeeds. This exact typed 502 is therefore a
  // confirmed refusal, unlike transport/internal failures with no proof.
  return error?.code === 'upstream_unavailable' && error.status === 502
}

export async function applyMcpConnectionMutation(
  intent: McpConnectionMutationIntent,
  idempotencyKey: string,
): Promise<void> {
  if (intent.kind === 'create') {
    const result = await apiPost<McpConnectionCreateResult>(paths.mcpConnections, intent.request, { idempotencyKey, signal: mcpHttpSignal(MCP_MUTATION_TIMEOUT_MS) })
    rememberConnection(result.connection)
    return
  }
  if (intent.kind === 'inspect') {
    const result = await apiPost<McpConnectionMutationResult>(paths.mcpConnectionInspect(intent.id), intent.request, { idempotencyKey, signal: mcpHttpSignal(MCP_MUTATION_TIMEOUT_MS) })
    if (result.connection.id !== intent.id) throw new Error('The MCP inspection acknowledgement addressed a different connection.')
    rememberConnection(result.connection)
    rememberCredentialCleanup(result.credentialCleanup)
    if (result.credentialCleanup === 'pending') markCleanupPending(idempotencyKey)
    else markCleanupComplete(idempotencyKey)
    if (result.credentialCleanup === 'pending') throw new McpCredentialCleanupPendingError()
    return
  }
  if (intent.kind === 'disconnect') {
    const result = await apiPost<McpConnectionMutationResult>(
      paths.mcpConnectionDisconnect(intent.id),
      { expectedRevision: intent.expectedRevision } satisfies McpConnectionLifecycleRequest,
      { idempotencyKey, signal: mcpHttpSignal(MCP_MUTATION_TIMEOUT_MS) },
    )
    if (result.connection.id !== intent.id) throw new Error('The MCP disconnect acknowledgement addressed a different connection.')
    rememberConnection(result.connection)
    rememberCredentialCleanup(result.credentialCleanup)
    if (result.credentialCleanup === 'pending') markCleanupPending(idempotencyKey)
    else markCleanupComplete(idempotencyKey)
    if (result.credentialCleanup === 'pending') throw new McpCredentialCleanupPendingError()
    return
  }
  if (intent.kind === 'remove') {
    const result = await apiDelete<McpConnectionRemovalResult>(
      paths.mcpConnection(intent.id),
      { expectedRevision: intent.expectedRevision } satisfies McpConnectionLifecycleRequest,
      { idempotencyKey, signal: mcpHttpSignal(MCP_MUTATION_TIMEOUT_MS) },
    )
    // Both removed:true and removed:false are authoritative absence
    // acknowledgements for the public row. The reviewed row remains held by
    // the facade while native cleanup is pending.
    rememberRemoval(intent.id, intent.expectedRevision)
    rememberCredentialCleanup(result.credentialCleanup)
    if (result.credentialCleanup === 'pending') markCleanupPending(idempotencyKey)
    else markCleanupComplete(idempotencyKey)
    if (result.credentialCleanup === 'pending') throw new McpCredentialCleanupPendingError()
    return
  }
  const result = await apiPost<McpConnectionMutationResult>(paths.mcpConnectionCleanup(intent.id), {}, { idempotencyKey, signal: mcpHttpSignal(MCP_MUTATION_TIMEOUT_MS) })
  if (result.connection.id !== intent.id) throw new Error('The MCP cleanup acknowledgement addressed a different connection.')
  rememberConnection(result.connection)
  rememberCredentialCleanup(result.credentialCleanup)
  if (result.credentialCleanup === 'pending') markCleanupPending(idempotencyKey)
  else markCleanupComplete(idempotencyKey)
  if (result.credentialCleanup === 'pending') throw new McpCredentialCleanupPendingError()
}

/** Reconcile only enough public truth to prove this exact held intent. The
 * private binding endpoint is intentionally never used for ordinary reads. */
export async function reconcileMcpConnectionMutation(
  intent: McpConnectionMutationIntent,
  _baseline: McpConnectionView | undefined,
  idempotencyKey: string,
  cause?: unknown,
): Promise<boolean> {
  if (intent.kind === 'create') {
    const expectedId = await mcpConnectionCreationId(intent.tenantId, intent.request.creationId)
    try {
      const result = await getMcpConnection(expectedId)
      rememberConnection(result)
      return true
    } catch (error) {
      if ((error as { status?: number }).status === 404) return false
      throw error
    }
  }
  if (intent.kind === 'remove') {
    try {
      await getMcpConnection(intent.id)
      if (cleanupIsUncertain(idempotencyKey, cause)) throw cleanupReconciliationError(idempotencyKey)
      return false
    } catch (error) {
      if ((error as { status?: number }).status === 404) {
        // Public absence proves server removal, not native-vault cleanup.
        // Keep the row's cleanup capability pending until the explicit retry
        // endpoint acknowledges the device-side reconciliation.
        rememberRemoval(intent.id, _baseline?.revision ?? 0)
        rememberCredentialCleanup('pending')
        if (cleanupIsUncertain(idempotencyKey, cause)) throw cleanupReconciliationError(idempotencyKey)
        return false
      }
      throw error
    }
  }
  if (intent.kind === 'cleanup') {
    // Dismiss is read-only with respect to native cleanup. Only explicit
    // Retry replays the cleanup POST through applyMcpConnectionMutation.
    if (cleanupIsUncertain(idempotencyKey, cause)) throw cleanupReconciliationError(idempotencyKey)
    return false
  }
  if (intent.kind === 'inspect') {
    const confirmedRefusal = isConfirmedInspectionRefusal(cause)
    try {
      await getMcpConnection(intent.id)
      if (cleanupIsKnownPending(idempotencyKey)) throw new McpCredentialCleanupPendingError()
      if (confirmedRefusal) return false
      if (cleanupIsUncertain(idempotencyKey, cause)) throw cleanupReconciliationError(idempotencyKey)
      return false
    } catch (error) {
      if ((error as { status?: number }).status === 404) {
        if (cleanupIsKnownPending(idempotencyKey)) throw new McpCredentialCleanupPendingError()
        if (confirmedRefusal) return false
        if (cleanupIsUncertain(idempotencyKey, cause)) throw cleanupReconciliationError(idempotencyKey)
        return false
      }
      throw error
    }
  }
  let current: McpConnectionView
  try {
    current = await getMcpConnection(intent.id)
  } catch (error) {
    if ((error as { status?: number }).status === 404) {
      if (cleanupIsUncertain(idempotencyKey, cause)) throw cleanupReconciliationError(idempotencyKey)
      return false
    }
    throw error
  }
  void current
  // Public state alone does not carry the private request fingerprint or
  // cleanup result; explicit Retry must replay the exact POST.
  if (cleanupIsUncertain(idempotencyKey, cause)) throw cleanupReconciliationError(idempotencyKey)
  return false
}

async function mcpConnectionCreationId(tenantId: string, creationId: string): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([tenantId, creationId]))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const hex = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
  return `mcp-connection-${hex.slice(0, 32)}`
}
