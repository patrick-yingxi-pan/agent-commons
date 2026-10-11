import type {
  McpOAuthAuthorizeRequest, McpOAuthCancelResponse, McpOAuthDecisionResponse, McpOAuthErrorCode,
  McpOAuthFlowRequest, McpOAuthReviewRequest, McpOAuthReviewResponse, McpOAuthSource,
  McpOAuthStartRequest, McpOAuthStartResponse, NativeMcpOAuthBridge,
} from '../../contract/mcpOAuth.ts'
import type { DesktopBridgeScope } from './desktopCredentials.ts'

type DesktopOAuthBridge = NonNullable<DesktopBridgeScope['agentCommonsDesktop']>['mcpOAuth']
const codes: McpOAuthErrorCode[] = ['request', 'busy', 'stale', 'expired', 'cancelled', 'conflict', 'unavailable']
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const exact = (value: Record<string, unknown>, required: string[]) => Object.keys(value).length === required.length && required.every(key => Object.hasOwn(value, key))
const safeText = (value: unknown, max = 2048): value is string => typeof value === 'string' && value.length > 0 && value.length <= max
const invalid = () => Object.assign(new Error('Native MCP OAuth is unavailable or returned an invalid response.'), { code: 'unavailable' as const })
const getBridge = (scope?: DesktopBridgeScope): DesktopOAuthBridge | undefined => scope?.agentCommonsDesktop?.mcpOAuth ?? (scope ? undefined : window.agentCommonsDesktop?.mcpOAuth)
const heldFlows = new Map<string, McpOAuthStartResponse>()
const heldKey = (connectionId: string, source: McpOAuthSource) => JSON.stringify([source.tenantId, source.userId, connectionId])
export function holdDesktopMcpOAuthFlow(connectionId: string, source: McpOAuthSource, flow: McpOAuthStartResponse): void {
  heldFlows.set(heldKey(connectionId, source), { ...flow, authorizationServers: [...flow.authorizationServers] })
}
export function getHeldDesktopMcpOAuthFlow(connectionId: string, source: McpOAuthSource): McpOAuthStartResponse | undefined {
  return heldFlows.get(heldKey(connectionId, source))
}
export function clearHeldDesktopMcpOAuthFlow(connectionId: string, source: McpOAuthSource, expectedFlowId?: string): boolean {
  const key = heldKey(connectionId, source)
  const current = heldFlows.get(key)
  if (expectedFlowId !== undefined && current?.flowId !== expectedFlowId) return false
  return heldFlows.delete(key)
}
/** Apply a late cancellation receipt only while it still names the exact held
 * flow. An earlier unmount must not erase or replace a newer recovery handle. */
export function settleHeldDesktopMcpOAuthCancellation(
  connectionId: string,
  source: McpOAuthSource,
  flow: McpOAuthStartResponse,
  result: 'cancelled' | 'inspection-pending' | 'unknown',
  allowAbsent = false,
): boolean {
  const key = heldKey(connectionId, source)
  const current = heldFlows.get(key)
  if (current && current.flowId !== flow.flowId) return false
  if (!current && !allowAbsent) return false
  if (result === 'inspection-pending' || result === 'unknown') {
    heldFlows.set(key, { ...flow, authorizationServers: [...flow.authorizationServers] })
  } else if (current?.flowId === flow.flowId) {
    heldFlows.delete(key)
  }
  return true
}

export function desktopMcpOAuthAvailable(scope?: DesktopBridgeScope): boolean {
  const bridge = getBridge(scope)
  return Boolean(bridge && ['start', 'review', 'authorize', 'reconcile', 'cancel'].every(method => typeof bridge[method as keyof NativeMcpOAuthBridge] === 'function'))
}

async function call<T>(scope: DesktopBridgeScope | undefined, method: keyof NativeMcpOAuthBridge, request: unknown, validate: (value: unknown) => value is T): Promise<T> {
  const bridge = getBridge(scope)
  const fn = bridge?.[method] as ((arg: never) => Promise<unknown>) | undefined
  if (!fn) throw invalid()
  try {
    const result = await fn.call(bridge, request as never)
    if (!validate(result)) throw invalid()
    return result
  } catch (error) {
    const code = record(error) && codes.includes(error.code as McpOAuthErrorCode) ? error.code as McpOAuthErrorCode : 'unavailable'
    throw Object.assign(new Error(`Native MCP OAuth could not continue (${code}).`), { code })
  }
}

const validSource = (value: McpOAuthSource) => record(value) && safeText(value.tenantId, 200) && safeText(value.userId, 200)
const validStart = (value: unknown): value is McpOAuthStartResponse => record(value) && exact(value, ['flowId', 'connectionId', 'revision', 'authorizationServers']) && safeText(value.flowId, 200) && safeText(value.connectionId, 200) &&
  Number.isSafeInteger(value.revision) && Array.isArray(value.authorizationServers) && value.authorizationServers.length <= 16 && value.authorizationServers.every(item => safeText(item))
const validReview = (value: unknown): value is McpOAuthReviewResponse => record(value) && exact(value, ['flowId', 'issuer', 'scopesSupported', 'suggestedScopes']) && safeText(value.flowId, 200) && safeText(value.issuer) &&
  Array.isArray(value.scopesSupported) && value.scopesSupported.length <= 32 && value.scopesSupported.every(item => safeText(item, 256)) &&
  Array.isArray(value.suggestedScopes) && value.suggestedScopes.length <= 32 && value.suggestedScopes.every(item => safeText(item, 256))
const validDecision = (value: unknown): value is McpOAuthDecisionResponse => {
  if (!record(value)) return false
  if (value.status === 'inspection-pending') return exact(value, ['status', 'flowId']) && safeText(value.flowId, 200)
  if (value.status !== 'complete' || !record(value.connection) || !exact(value, Object.hasOwn(value, 'credentialCleanup') ? ['status', 'connection', 'credentialCleanup'] : ['status', 'connection']) || !exact(value.connection, ['id', 'revision', 'status'])) return false
  const c = value.connection
  return safeText(c.id, 200) && Number.isSafeInteger(c.revision) && ['unverified', 'connected', 'disconnected'].includes(String(c.status)) &&
    (!Object.hasOwn(value, 'credentialCleanup') || value.credentialCleanup === 'complete' || value.credentialCleanup === 'pending')
}
const validCancel = (value: unknown): value is McpOAuthCancelResponse => record(value) &&
  ((value.status === 'cancelled' && exact(value, ['status'])) || (value.status === 'inspection-pending' && exact(value, ['status', 'flowId']) && safeText(value.flowId, 200)))

export function startDesktopMcpOAuth(request: McpOAuthStartRequest, scope?: DesktopBridgeScope): Promise<McpOAuthStartResponse> {
  if (!record(request) || !exact(request, ['connectionId', 'expectedRevision', 'source']) || !safeText(request.connectionId, 200) || !Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0 || !record(request.source) || !exact(request.source, ['tenantId', 'userId']) || !validSource(request.source as McpOAuthSource)) return Promise.reject(invalid())
  return call(scope, 'start', request, validStart)
}
export function reviewDesktopMcpOAuth(request: McpOAuthReviewRequest, scope?: DesktopBridgeScope): Promise<McpOAuthReviewResponse> {
  if (!record(request) || !exact(request, ['flowId', 'issuer']) || !safeText(request.flowId, 200) || !safeText(request.issuer)) return Promise.reject(invalid())
  return call(scope, 'review', request, validReview)
}
export function authorizeDesktopMcpOAuth(request: McpOAuthAuthorizeRequest, scope?: DesktopBridgeScope): Promise<McpOAuthDecisionResponse> {
  if (!record(request) || !exact(request, ['flowId', 'scopes']) || !safeText(request.flowId, 200) || !Array.isArray(request.scopes) || request.scopes.length > 32 || request.scopes.some(scopeName => !safeText(scopeName, 256))) return Promise.reject(invalid())
  return call(scope, 'authorize', request, validDecision)
}
export function reconcileDesktopMcpOAuth(request: McpOAuthFlowRequest, scope?: DesktopBridgeScope): Promise<McpOAuthDecisionResponse> {
  if (!record(request) || !exact(request, ['flowId']) || !safeText(request.flowId, 200)) return Promise.reject(invalid())
  return call(scope, 'reconcile', request, validDecision)
}
export function cancelDesktopMcpOAuth(request: McpOAuthFlowRequest, scope?: DesktopBridgeScope): Promise<McpOAuthCancelResponse> {
  if (!record(request) || !exact(request, ['flowId']) || !safeText(request.flowId, 200)) return Promise.reject(invalid())
  return call(scope, 'cancel', request, validCancel)
}
