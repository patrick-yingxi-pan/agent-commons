/** Deployment-owned MCP capabilities. The native launcher installs its narrow
 * credential channel before importing the HTTP server; web/dev default to no
 * device credential authority and public HTTPS only. No request can widen it. */
import type { McpCredentialBinding, McpCredentialResolver, McpOAuthCredentialResolver } from './mcpConnectionInspector.ts'
import type { McpStdioConnection } from './mcpStdioClient.ts'

export interface McpCredentialReferenceBinding {
  reference: string
  binding: McpCredentialBinding
}

export interface McpStdioBinding {
  tenantId: string
  ownerUserId: string
  connectionId: string
  connectionRevision: number
}
export interface McpStdioReferenceBinding {
  /** Null is an explicit revoke for a still-live unverified/disconnected row. */
  reference: string | null
  binding: McpStdioBinding
}

export interface McpRuntimeConfiguration {
  resolveCredential?: McpCredentialResolver
  resolveOAuthCredential?: McpOAuthCredentialResolver
  synchronizeBindings?: (bindings: McpCredentialReferenceBinding[]) => Promise<{ available: boolean }>
  /** Native-only process capability. The opaque reference is resolved by the
   * host; launch configuration never crosses this server seam. */
  localProcessesAvailable?: boolean
  openStdio?: (reference: string, binding: McpStdioBinding,
    options: { signal: AbortSignal; isCurrent: () => boolean; purpose: 'inspect' | 'call' }) => McpStdioConnection
  synchronizeStdioBindings?: (bindings: McpStdioReferenceBinding[]) => Promise<{ available: boolean }>
  deviceBearerAvailable: boolean
  deviceOAuthAvailable?: boolean
  allowLoopback: boolean
}

const DEFAULT: Readonly<McpRuntimeConfiguration> = Object.freeze({
  deviceBearerAvailable: false,
  allowLoopback: false,
})
let configuration = DEFAULT
let cleanupPending = false
let oauthCapabilityAvailable = false
let stdioCapabilityAvailable = false
let effectiveSnapshot: { source: Readonly<McpRuntimeConfiguration>; oauth: boolean; stdio: boolean; value: Readonly<McpRuntimeConfiguration> } | undefined

/** This is a boot/test dependency seam, never a route or renderer capability. */
export function configureMcpRuntime(next: McpRuntimeConfiguration): void {
  if (typeof next.deviceBearerAvailable !== 'boolean' || typeof next.allowLoopback !== 'boolean' ||
      (next.deviceBearerAvailable && (typeof next.resolveCredential !== 'function' || typeof next.synchronizeBindings !== 'function')) ||
      (next.deviceOAuthAvailable !== undefined && typeof next.deviceOAuthAvailable !== 'boolean') ||
      (next.deviceOAuthAvailable === true && (typeof next.resolveOAuthCredential !== 'function' || typeof next.synchronizeBindings !== 'function')) ||
      (next.localProcessesAvailable !== undefined && typeof next.localProcessesAvailable !== 'boolean') ||
      (next.localProcessesAvailable === true && (typeof next.openStdio !== 'function' || typeof next.synchronizeStdioBindings !== 'function')) ||
      (next.openStdio !== undefined && typeof next.openStdio !== 'function') ||
      (next.synchronizeStdioBindings !== undefined && typeof next.synchronizeStdioBindings !== 'function')) {
    throw new Error('The MCP deployment configuration is invalid.')
  }
  configuration = Object.freeze({ ...next })
  cleanupPending = false
  oauthCapabilityAvailable = false
  stdioCapabilityAvailable = false
  effectiveSnapshot = undefined
}

export function mcpRuntimeConfiguration(): Readonly<McpRuntimeConfiguration> {
  if (effectiveSnapshot?.source === configuration && effectiveSnapshot.oauth === oauthCapabilityAvailable &&
      effectiveSnapshot.stdio === stdioCapabilityAvailable) return effectiveSnapshot.value
  const value = (configuration.deviceOAuthAvailable !== true || oauthCapabilityAvailable) &&
    (configuration.localProcessesAvailable !== true || stdioCapabilityAvailable) ? configuration : Object.freeze({ ...configuration,
    ...(configuration.deviceOAuthAvailable === true && !oauthCapabilityAvailable ? { deviceOAuthAvailable: false } : {}),
    ...(configuration.localProcessesAvailable === true && !stdioCapabilityAvailable ? { localProcessesAvailable: false } : {}),
  })
  effectiveSnapshot = { source: configuration, oauth: oauthCapabilityAvailable, stdio: stdioCapabilityAvailable, value }
  return value
}

/** Boot barrier after durable state has rehydrated, before HTTP admission.
 * Synchronizing the seed/empty registry earlier could erase valid OS secrets. */
export async function initializeMcpRuntime(bindings: McpCredentialReferenceBinding[], stdioBindings: McpStdioReferenceBinding[] = []): Promise<void> {
  const issued = configuration
  let httpResult: { available: boolean }
  let stdioResult: { available: boolean }
  try {
    [httpResult, stdioResult] = await Promise.all([
      issued.synchronizeBindings ? issued.synchronizeBindings(bindings) : Promise.resolve({ available: false }),
      issued.synchronizeStdioBindings ? issued.synchronizeStdioBindings(stdioBindings) : Promise.resolve({ available: false }),
    ])
  } catch (error) {
    if (configuration === issued && issued.localProcessesAvailable === true) {
      stdioCapabilityAvailable = false
      cleanupPending = true
    }
    throw error
  }
  if (configuration !== issued) {
    throw new Error('MCP credential initialization did not acknowledge the current deployment.')
  }
  if (typeof httpResult?.available !== 'boolean' || typeof stdioResult?.available !== 'boolean') {
    if (issued.localProcessesAvailable === true) {
      stdioCapabilityAvailable = false
      cleanupPending = true
    }
    throw new Error('MCP credential initialization did not acknowledge the current deployment.')
  }
  configuration = Object.freeze({ ...issued,
    deviceBearerAvailable: httpResult.available && typeof issued.resolveCredential === 'function',
    ...(issued.deviceOAuthAvailable === true ? {
      deviceOAuthAvailable: httpResult.available && typeof issued.resolveOAuthCredential === 'function',
    } : {}),
  })
  oauthCapabilityAvailable = httpResult.available && issued.deviceOAuthAvailable === true && typeof issued.resolveOAuthCredential === 'function'
  stdioCapabilityAvailable = issued.localProcessesAvailable === true && stdioResult.available === true && typeof issued.openStdio === 'function'
  cleanupPending = (Boolean(issued.synchronizeBindings) && !httpResult.available) ||
    (Boolean(issued.synchronizeStdioBindings) && stdioResult.available !== true)
}

export function mcpRuntimeCapabilities() {
  const effective = mcpRuntimeConfiguration()
  return {
    deviceBearerCredentials: effective.deviceBearerAvailable,
    ...(effective.deviceOAuthAvailable === true && typeof effective.resolveOAuthCredential === 'function'
      ? { deviceOAuthCredentials: true as const } : {}),
    ...(effective.localProcessesAvailable === true && typeof effective.openStdio === 'function'
      ? { localProcesses: true as const } : {}),
    loopbackConnections: effective.allowLoopback,
    credentialCleanupPending: cleanupPending,
  }
}

/** Product state has already committed. A cleanup failure cannot turn that
 * durable acknowledgement into a false rollback or justify a repeated probe. */
export async function synchronizeMcpCredentials(bindings: McpCredentialReferenceBinding[], stdioBindings: McpStdioReferenceBinding[] = []): Promise<'complete' | 'pending'> {
  const issued = configuration
  if (!issued.synchronizeBindings && !issued.synchronizeStdioBindings) return 'complete'
  try {
    const [httpResult, stdioResult] = await Promise.all([
      issued.synchronizeBindings ? issued.synchronizeBindings(bindings) : Promise.resolve({ available: false }),
      issued.synchronizeStdioBindings ? issued.synchronizeStdioBindings(stdioBindings) : Promise.resolve({ available: false }),
    ])
    if (configuration !== issued) return 'pending'
    if (typeof httpResult?.available !== 'boolean' || typeof stdioResult?.available !== 'boolean') {
      if (issued.localProcessesAvailable === true) stdioCapabilityAvailable = false
      cleanupPending = true
      return 'pending'
    }
    if (issued.localProcessesAvailable === true) {
      stdioCapabilityAvailable = stdioResult.available === true && typeof issued.openStdio === 'function'
    }
    cleanupPending = (Boolean(issued.synchronizeBindings) && !httpResult.available) ||
      (Boolean(issued.synchronizeStdioBindings) && stdioResult.available !== true)
  } catch {
    if (configuration !== issued) return 'pending'
    if (issued.localProcessesAvailable === true) {
      stdioCapabilityAvailable = false
    }
    cleanupPending = true
  }
  return cleanupPending ? 'pending' : 'complete'
}
