import type { DispatchBinding } from './dispatchExecution.ts'
import type { McpToolPermission, McpToolResult } from './mcpExecution.ts'

/** A distinct owner opt-in, never inferred from Commission.standing, Routine
 * grants, Project sharing, or connection setup. These limits are not money caps. */
export const COMMISSION_MCP_MAX_TOOLS = 16
export const COMMISSION_MCP_MAX_WORK_ITEMS = 100
export const COMMISSION_MCP_MAX_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000

export interface CommissionMcpApproval {
  configurationRevision: number
  /** Server-derived digest of Commission, Agent/provider, Project and audience
   * facts shown in review. The future store must recompute it at every admission. */
  reviewHash: string
  execution: DispatchBinding
  approvedAt: number
  expiresAt: number
  /** At most one exact MCP call per work item. Every admitted item consumes a
   * slot, including failure/uncertainty; renewal cannot replay an old work item. */
  maxWorkItems: number
  tools: McpToolPermission[]
}

export interface CommissionMcpPolicy {
  version: 1
  revision: number
  approval: CommissionMcpApproval | null
}

/** Private review intent. Absence/null grants nothing. No actor, tenant or
 * Project identity is accepted from this payload; the host supplies that scope. */
export interface CommissionMcpApprovalIntent {
  expectedRevision: number
  expectedConfigurationRevision: number
  reviewHash: string
  execution: DispatchBinding
  expiresAt: number
  maxWorkItems: number
  tools: McpToolPermission[]
}

/** One frozen work item. Initial execution treats every MCP tool as potentially
 * effectful; peer read-only annotations cannot bypass Project fire/Guardian gates. */
export interface CommissionMcpWork {
  itemId: string
  subGoal: string
  type: 'mcp.mutate'
  target: string
  note: string
}

export type CommissionMcpAttemptState =
  | { status: 'pending' }
  | { status: 'done'; finishedAt: number; result: McpToolResult }
  | { status: 'failed'; finishedAt: number; result?: McpToolResult }
  | { status: 'uncertain'; finishedAt: number }
