/** Narrow renderer/native OAuth ceremony. Secrets, endpoints, raw metadata and
 * credential references are deliberately absent from these public types. */
export type McpOAuthErrorCode = 'request' | 'busy' | 'stale' | 'expired' | 'cancelled' | 'conflict' | 'unavailable'

export interface McpOAuthSource { tenantId: string; userId: string }
export interface McpOAuthStartRequest { connectionId: string; expectedRevision: number; source: McpOAuthSource }
export interface McpOAuthStartResponse { flowId: string; connectionId: string; revision: number; authorizationServers: string[] }
export interface McpOAuthReviewRequest { flowId: string; issuer: string }
export interface McpOAuthReviewResponse { flowId: string; issuer: string; scopesSupported: string[]; suggestedScopes: string[] }
export interface McpOAuthAuthorizeRequest { flowId: string; scopes: string[] }
export interface McpOAuthFlowRequest { flowId: string }
export interface McpOAuthPublicConnection { id: string; revision: number; status: 'unverified' | 'connected' | 'disconnected' }
export type McpOAuthDecisionResponse =
  | { status: 'complete'; connection: McpOAuthPublicConnection; credentialCleanup?: 'complete' | 'pending' }
  | { status: 'inspection-pending'; flowId: string }
export type McpOAuthCancelResponse = { status: 'cancelled' } | Extract<McpOAuthDecisionResponse, { status: 'inspection-pending' }>

export interface NativeMcpOAuthBridge {
  start(request: McpOAuthStartRequest): Promise<McpOAuthStartResponse>
  review(request: McpOAuthReviewRequest): Promise<McpOAuthReviewResponse>
  authorize(request: McpOAuthAuthorizeRequest): Promise<McpOAuthDecisionResponse>
  reconcile(request: McpOAuthFlowRequest): Promise<McpOAuthDecisionResponse>
  cancel(request: McpOAuthFlowRequest): Promise<McpOAuthCancelResponse>
}
