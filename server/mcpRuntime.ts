/** Deployment-owned MCP capabilities. The native launcher installs its narrow
 * credential channel before importing the HTTP server; web/dev default to no
 * device credential authority and public HTTPS only. No request can widen it. */
import type { McpCredentialBinding, McpCredentialResolver, McpOAuthCredentialResolver } from './mcpConnectionInspector.ts'

export interface McpCredentialReferenceBinding {
  reference: string
  binding: McpCredentialBinding
}

export interface McpRuntimeConfiguration {
  resolveCredential?: McpCredentialResolver
  resolveOAuthCredential?: McpOAuthCredentialResolver
  synchronizeBindings?: (bindings: McpCredentialReferenceBinding[]) => Promise<{ available: boolean }>
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

/** This is a boot/test dependency seam, never a route or renderer capability. */
export function configureMcpRuntime(next: McpRuntimeConfiguration): void {
  if (typeof next.deviceBearerAvailable !== 'boolean' || typeof next.allowLoopback !== 'boolean' ||
      (next.deviceBearerAvailable && (typeof next.resolveCredential !== 'function' || typeof next.synchronizeBindings !== 'function')) ||
      (next.deviceOAuthAvailable !== undefined && typeof next.deviceOAuthAvailable !== 'boolean') ||
      (next.deviceOAuthAvailable === true && (typeof next.resolveOAuthCredential !== 'function' || typeof next.synchronizeBindings !== 'function'))) {
    throw new Error('The MCP deployment configuration is invalid.')
  }
  configuration = Object.freeze({ ...next })
  cleanupPending = false
  oauthCapabilityAvailable = false
}

export function mcpRuntimeConfiguration(): Readonly<McpRuntimeConfiguration> {
  if (configuration.deviceOAuthAvailable !== true || oauthCapabilityAvailable) return configuration
  // A requested native seam is not effective until the post-rehydration
  // binding synchronization barrier acknowledges usable storage.
  return Object.freeze({ ...configuration, deviceOAuthAvailable: false })
}

/** Boot barrier after durable state has rehydrated, before HTTP admission.
 * Synchronizing the seed/empty registry earlier could erase valid OS secrets. */
export async function initializeMcpRuntime(bindings: McpCredentialReferenceBinding[]): Promise<void> {
  const issued = configuration
  if (!issued.synchronizeBindings) return
  const result = await issued.synchronizeBindings(bindings)
  if (configuration !== issued || typeof result?.available !== 'boolean') {
    throw new Error('MCP credential initialization did not acknowledge the current deployment.')
  }
  configuration = Object.freeze({ ...issued,
    deviceBearerAvailable: result.available && typeof issued.resolveCredential === 'function',
    ...(issued.deviceOAuthAvailable === true ? {
      deviceOAuthAvailable: result.available && typeof issued.resolveOAuthCredential === 'function',
    } : {}),
  })
  oauthCapabilityAvailable = result.available && issued.deviceOAuthAvailable === true && typeof issued.resolveOAuthCredential === 'function'
  cleanupPending = !result.available
}

export function mcpRuntimeCapabilities() {
  const effective = mcpRuntimeConfiguration()
  return {
    deviceBearerCredentials: effective.deviceBearerAvailable,
    ...(effective.deviceOAuthAvailable === true && typeof effective.resolveOAuthCredential === 'function'
      ? { deviceOAuthCredentials: true as const } : {}),
    loopbackConnections: effective.allowLoopback,
    credentialCleanupPending: cleanupPending,
  }
}

/** Product state has already committed. A cleanup failure cannot turn that
 * durable acknowledgement into a false rollback or justify a repeated probe. */
export async function synchronizeMcpCredentials(bindings: McpCredentialReferenceBinding[]): Promise<'complete' | 'pending'> {
  const issued = configuration
  if (!issued.synchronizeBindings) return 'complete'
  try {
    const result = await issued.synchronizeBindings(bindings)
    if (configuration !== issued) return 'pending'
    cleanupPending = !result.available
  } catch {
    if (configuration !== issued) return 'pending'
    cleanupPending = true
  }
  return cleanupPending ? 'pending' : 'complete'
}
