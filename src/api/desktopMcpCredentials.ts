import type { McpCredentialBinding, McpCredentialBindingResponse } from '../../contract/mcpConnections.ts'
import type { DesktopBridgeScope } from './desktopCredentials.ts'
import { apiGet } from './client.ts'
import { paths } from './keys.ts'
import { mcpHttpSignal } from './mcpConnectionReads.ts'

/** Validate the exact ceremony audience before passing a token to the host.
 * Keeping this with provisioning leaves credential-only code off the initial
 * catalog-read path; ordinary connection reads never request the endpoint. */
export async function getMcpConnectionCredentialBinding(id: string, tenantId: string): Promise<McpCredentialBindingResponse> {
  const result = await apiGet<McpCredentialBindingResponse>(paths.mcpConnectionCredentialBinding(id), { signal: mcpHttpSignal() })
  const binding = result?.binding
  const invalid = () => new Error('The MCP credential binding did not match the requested audience.')
  if (!binding || typeof binding !== 'object' || Array.isArray(binding) ||
      Object.keys(binding).length !== 3 || binding.connectionId !== id || binding.tenantId !== tenantId ||
      typeof binding.endpoint !== 'string' || binding.endpoint.length > 2048) throw invalid()
  let endpoint: URL
  try { endpoint = new URL(binding.endpoint) } catch { throw invalid() }
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.href !== binding.endpoint ||
      endpoint.username || endpoint.password || binding.endpoint.includes('#')) throw invalid()
  return { binding: { tenantId, connectionId: id, endpoint: binding.endpoint } }
}

function bridge(scope: DesktopBridgeScope = window): NonNullable<DesktopBridgeScope['agentCommonsDesktop']>['mcpCredentials'] | undefined {
  return scope.agentCommonsDesktop?.mcpCredentials
}

export const MCP_NATIVE_PROVISION_TIMEOUT_MS = 5_000

export function desktopMcpCredentialsAvailable(scope?: DesktopBridgeScope): boolean {
  return bridge(scope) !== undefined
}

/** Provision-only native ceremony. The bearer secret never enters HTTP or a
 * cache; only the opaque vault reference returns to the renderer. */
export async function provisionDesktopMcpCredential(
  binding: McpCredentialBinding,
  secret: string,
  scope?: DesktopBridgeScope,
  timeoutMs = MCP_NATIVE_PROVISION_TIMEOUT_MS,
): Promise<string> {
  const credentials = bridge(scope)
  if (!credentials) throw new Error('Secure MCP credential storage is unavailable.')
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Secure MCP credential provisioning timed out.')), timeoutMs)
  })
  try {
    // A late native acknowledgement is intentionally ignored here. The host
    // reconciliation pass retires an orphaned reference on the next startup.
    return await Promise.race([credentials.provision(binding, secret), timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
