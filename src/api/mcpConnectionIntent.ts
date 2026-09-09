import type {
  McpConnectionCreateRequest,
  McpConnectionInspectionRequest,
  McpConnectionView,
} from '../../contract/mcpConnections.ts'

/** Framework-free, account-fenced input shared by the queue facade and its
 * lazy transport. It holds the user's exact form request and public reviewed
 * state, never raw tokens; private binding reads stay in the native ceremony. */
export type McpConnectionMutationIntent =
  | { readonly kind: 'create'; readonly tenantId: string; readonly sourceUserId: string | null; readonly request: McpConnectionCreateRequest }
  | { readonly kind: 'inspect'; readonly tenantId: string; readonly sourceUserId: string | null; readonly id: string; readonly request: McpConnectionInspectionRequest; readonly reviewed?: McpConnectionView }
  | { readonly kind: 'disconnect'; readonly tenantId: string; readonly sourceUserId: string | null; readonly id: string; readonly expectedRevision: number; readonly reviewed?: McpConnectionView }
  | { readonly kind: 'remove'; readonly tenantId: string; readonly sourceUserId: string | null; readonly id: string; readonly expectedRevision: number; readonly reviewed?: McpConnectionView }
  | { readonly kind: 'cleanup'; readonly tenantId: string; readonly sourceUserId: string | null; readonly id: string; readonly reviewed?: McpConnectionView }

export const mcpConnectionMutationResourceId = (intent: McpConnectionMutationIntent): string =>
  `${intent.tenantId}:${intent.kind === 'create' ? `create:${intent.request.creationId}` : intent.id}`

type WithoutTenant<T> = T extends unknown ? Omit<T, 'tenantId'> : never
export type McpConnectionMutationInput = WithoutTenant<McpConnectionMutationIntent> & { readonly tenantId?: string }
