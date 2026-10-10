import type { McpBoundToolCall, McpJsonValue, McpToolResult } from './mcpExecution.ts'

/** Bounds for explicit unattended permission, not monetary caps. These values
 * do not enable execution; the owner workflow and durable runner admit it. */
export const ROUTINE_MCP_MAX_TOOLS = 16
export const ROUTINE_MCP_MAX_CALLS = 20
export const ROUTINE_MCP_MAX_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000

export interface RoutineMcpToolPermission {
  connectionId: string
  connectionRevision: number
  toolName: string
  schemaHash: string
  /** Exact top-level argument values. Nested objects compare completely, not
   * as partial matches; arrays retain order. Other arguments are model-chosen
   * subject to the reviewed tool schema. Empty explicitly fixes no values. */
  fixedArguments: Record<string, McpJsonValue>
}

export interface RoutineMcpApproval {
  definitionRevision: number
  /** Server-computed digest of the reviewed Routine context, outputs and audience. */
  reviewHash: string
  approvedAt: number
  expiresAt: number
  maxCallsPerRun: number
  tools: RoutineMcpToolPermission[]
}

/** Independent ordering survives revocation. A null approval grants nothing;
 * replacement never changes a queued run's frozen policy. */
export interface RoutineMcpPolicy {
  version: 1
  revision: number
  approval: RoutineMcpApproval | null
}

/** Review input; server-owned timestamps, scope and policy revision are absent.
 * The caller must disclose destination sharing and possible third-party fees. */
export interface RoutineMcpApprovalIntent {
  expectedRevision: number
  expectedDefinitionRevision: number
  /** Server-computed digest; the store validates it against current Routine facts before approval. */
  reviewHash: string
  expiresAt: number
  maxCallsPerRun: number
  tools: RoutineMcpToolPermission[]
}

export type RoutineMcpCallState =
  | { status: 'pending' }
  | { status: 'done'; finishedAt: number; result: McpToolResult }
  | { status: 'failed'; finishedAt: number; result?: McpToolResult }
  | { status: 'uncertain'; finishedAt: number }

/** Exact call receipts remain owner-only, independent of destination sharing.
 * Every reserved call consumes the per-run limit, even a
 * known pre-submit failure; no receipt state authorizes an automatic replay. */
export type RoutineMcpCallReceipt = {
  id: string
  call: McpBoundToolCall
  startedAt: number
} & RoutineMcpCallState
