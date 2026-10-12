/** Project-visible receipt for an explicitly confirmed MCP effect. This shape
 * is inert history, not permission to run a tool. The Contribution workflow
 * must persist its private approval/binding before starting the call. */
import type { McpJsonValue, McpToolResult } from './mcpExecution.ts'

export const CONTRIBUTION_EFFECT_RESULT_MAX_BYTES = 262_144

interface ContributionEffectRunBase {
  id: string
  envelopeVersion: number
  lineId: string
  actor: string
  connectionLabel: string
  /** Derived local-process provenance. Absent remains the historical HTTP shape. */
  transport?: 'stdio'
  toolName: string
  /** Exact reviewed values; visible under the containing Project's read wall. */
  arguments: Record<string, McpJsonValue>
  startedAt: number
}

export type ContributionEffectRunState =
  | { status: 'pending'; finishedAt?: never; summary?: never; result?: never }
  | { status: 'done'; finishedAt: number; summary: string; result: McpToolResult }
  | { status: 'failed'; finishedAt: number; summary: string; result?: McpToolResult }
  | { status: 'uncertain'; finishedAt: number; summary: string; result?: never }

export type ContributionEffectRun = ContributionEffectRunBase & ContributionEffectRunState
