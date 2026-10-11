import type { McpDiscoveredTool } from './mcpConnections.ts'
import type { ScheduledRun } from './cowork.ts'
import type { RoutineMcpApprovalIntent, RoutineMcpCallReceipt, RoutineMcpPolicy } from './routineMcp.ts'

/** Owner-only, live review. Neither this catalog nor the private receipt ledger
 * belongs in a shared Routine row or its relation graph. */
export interface RoutineMcpReview {
  routineId: string
  definitionRevision: number
  reviewHash: string
  policy: RoutineMcpPolicy
  active: boolean
  /** Another person's grant can be managed without exposing its private tools
   * or receipts. policy retains its revision but projects approval as null. */
  otherPersonApproval?: { active: boolean }
  disclosures: string[]
  tools: Array<{
    connectionId: string
    connectionRevision: number
    connectionLabel: string
    schemaHash: string
    tool: McpDiscoveredTool
  }>
  runs: Array<{ runId: string; status: ScheduledRun['status']; phase: 'active' | 'interrupted'; calls: RoutineMcpCallReceipt[] }>
}

export type RoutineMcpDecisionRequest =
  | { requestId: string; action: 'approve'; approval: RoutineMcpApprovalIntent }
  | { requestId: string; action: 'revoke'; expectedRevision: number }

export interface RoutineMcpDecisionResponse {
  routineId: string
  requestId: string
  decisionId: string
  review: RoutineMcpReview
}
