import type { DispatchBinding } from './dispatchExecution.ts'
import type { McpDiscoveredTool } from './mcpConnections.ts'
import type { McpBoundToolCall, McpToolResult } from './mcpExecution.ts'
import type { CommissionMcpApprovalIntent, CommissionMcpPolicy, CommissionMcpWork } from './commissionMcp.ts'

/** Person-private live review, never a field on a shared Contributor row.
 * Model selection is a review input, not execution authority. Approval always
 * sends the complete explicit binding and the server's current review hash. */
export interface CommissionMcpReview {
  commissionId: string
  projectId: string
  configurationRevision: number
  reviewHash: string
  execution: DispatchBinding | null
  policy: CommissionMcpPolicy
  active: boolean
  blockedReason: string | null
  disclosures: string[]
  tools: Array<{
    connectionId: string
    connectionRevision: number
    connectionLabel: string
    schemaHash: string
    tool: McpDiscoveredTool
  }>
  claims: CommissionMcpClaimView[]
}

/** History is evidence of a claimed item, never permission to run it again. */
export interface CommissionMcpClaimView {
  id: string
  work: CommissionMcpWork
  startedAt: number
  phase: 'preparing' | 'effect' | 'closed'
  status: 'pending' | 'done' | 'failed' | 'uncertain'
  finishedAt?: number
  call?: McpBoundToolCall
  result?: McpToolResult
}

export type CommissionMcpDecisionRequest =
  | { requestId: string; action: 'approve'; approval: CommissionMcpApprovalIntent }
  | { requestId: string; action: 'revoke'; expectedRevision: number }

export interface CommissionMcpDecisionResponse {
  commissionId: string
  requestId: string
  decisionId: string
  review: CommissionMcpReview
}
