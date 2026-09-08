import type {
  McpConnectionCreateRequest,
  McpConnectionInspectionRequest,
  McpConnectionView,
} from '../../contract/mcpConnections.ts'

/** Framework-free, account-fenced input shared by the queue facade and its
 * lazy transport. It contains public reviewed state only; endpoint and
 * credential references stay in the separate native/API ceremony. */
export type McpConnectionMutationIntent =
  | { readonly kind: 'create'; readonly tenantId: string; readonly request: McpConnectionCreateRequest }
  | { readonly kind: 'inspect'; readonly tenantId: string; readonly id: string; readonly request: McpConnectionInspectionRequest; readonly reviewed?: McpConnectionView }
  | { readonly kind: 'disconnect'; readonly tenantId: string; readonly id: string; readonly expectedRevision: number; readonly reviewed?: McpConnectionView }
  | { readonly kind: 'remove'; readonly tenantId: string; readonly id: string; readonly expectedRevision: number; readonly reviewed?: McpConnectionView }
  | { readonly kind: 'cleanup'; readonly tenantId: string; readonly id: string; readonly reviewed?: McpConnectionView }

export const mcpConnectionMutationResourceId = (intent: McpConnectionMutationIntent): string =>
  `${intent.tenantId}:${intent.kind === 'create' ? `create:${intent.request.creationId}` : intent.id}`

type WithoutTenant<T> = T extends unknown ? Omit<T, 'tenantId'> : never
export type McpConnectionMutationInput = WithoutTenant<McpConnectionMutationIntent> & { readonly tenantId?: string }
