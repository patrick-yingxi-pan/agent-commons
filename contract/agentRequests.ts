/** Person-private Agent requests. Identity anchors and private credentials never
 * cross this wire; only the receiving owner can see an approved call/result. */
import type { McpBoundToolCall, McpJsonValue, McpToolResult } from './mcpExecution.ts'
import type { McpDiscoveredTool } from './mcpConnections.ts'

export const AGENT_REQUEST_TASK_MAX_BYTES = 8_192
export const AGENT_REQUEST_REPLY_MAX_BYTES = 65_536
export const AGENT_REQUEST_ARGUMENT_DRAFT_MAX_BYTES = 48 * 1_024
/** Strict prose rejects controls other than tab/CR/LF and unpaired surrogates.
 * Its JSON encoding can at most double (quotes, backslashes and whitespace). */
export const AGENT_REQUEST_CREATE_MAX_BYTES = 2 * AGENT_REQUEST_TASK_MAX_BYTES + 1_024
export const AGENT_REQUEST_DECISION_MAX_BYTES = 2 * AGENT_REQUEST_REPLY_MAX_BYTES + 1_024

export interface AgentRequestCreate {
  fromAgentId: string
  toAgentId: string
  task: string
}
export interface AgentRequestOptions {
  sourceAgents: { id: string; label: string }[]
  targetAgents: { id: string; label: string }[]
}
export type AgentRequestStatus = 'waiting' | 'running' | 'awaiting-reply' | 'replied' | 'denied' | 'cancelled'
export type AgentRequestApproval =
  | { transport: 'http'; call: McpBoundToolCall }
  | { transport: 'stdio'; localPrograms: true; call: McpBoundToolCall }
export type AgentRequestExecution = {
  approval: AgentRequestApproval
  callHash: string
  startedAt: number
} & (
  | { status: 'pending' }
  | { status: 'done'; finishedAt: number; summary: string; result: McpToolResult }
  | { status: 'failed'; finishedAt: number; summary: string; result?: McpToolResult }
  | { status: 'uncertain'; finishedAt: number; summary: string }
)
/** Immutable, non-credential coordinates for one optional owner-initiated
 * argument-drafting attempt. This is a private receipt, never execution consent. */
export interface AgentRequestArgumentDraftBinding {
  agentRevision: number
  providerId: string
  providerRevision: number
  providerConnectionRevision: number
  model: string
  connectionId: string
  connectionRevision: number
  toolName: string
  schemaHash: string
  transport: 'http' | 'stdio'
}
export type AgentRequestArgumentDraft = {
  revision: 1 | 2
  binding: AgentRequestArgumentDraftBinding
  inputHash: string
  startedAt: number
} & (
  | { revision: 1; status: 'pending' }
  | { revision: 2; status: 'done'; finishedAt: number; arguments: Record<string, McpJsonValue> }
  | { revision: 2; status: 'failed' | 'uncertain'; finishedAt: number }
)
export interface AgentRequestDraftModel {
  agentRevision: number
  providerId: string
  providerLabel: string
  providerRevision: number
  providerConnectionRevision: number
  model: string
}
export interface AgentRequestStateView {
  id: string
  fromAgentId: string
  toAgentId: string
  task: string
  createdAt: number
  updatedAt: number
  revision: number
  status: AgentRequestStatus
  /** Private owner-only model-draft receipt; omitted from requester projections. */
  argumentDraft?: AgentRequestArgumentDraft
  reply?: string
  execution?: AgentRequestExecution
  /** Explicit backup restore cannot prove this old waiting request never ran. */
  executionBlockedByRestore?: true
}
export interface AgentRequestView extends AgentRequestStateView {
  role: 'requester' | 'owner'
  fromAgentLabel: string
  toAgentLabel: string
  /** Historical rows remain readable after either Agent is removed. */
  fromAgentAvailable: boolean
  toAgentAvailable: boolean
}
/** History/navigation never fetch potentially large private receipts or replies. */
export type AgentRequestSummary = Omit<AgentRequestView, 'execution' | 'reply' | 'argumentDraft'>
export interface AgentRequestReview {
  request: AgentRequestView
  /** Owner-only inspected tools under the receiving Agent's current reach. */
  tools: { connectionId: string; connectionRevision: number; connectionLabel: string;
    transport: 'http' | 'stdio'; schemaHash: string; tool: McpDiscoveredTool }[]
  blockedReason: string | null
  /** Exact current owner-visible endpoint/model coordinates eligible for one draft. */
  draftModel?: AgentRequestDraftModel
}
/** A stale decision never repeats work. Read the canonical request to recover
 * after an ambiguous response instead of manufacturing a new execution. */
export type AgentRequestDecision =
  | { action: 'deny' | 'cancel'; expectedRevision: number }
  | { action: 'draft-arguments'; expectedRevision: number; binding: AgentRequestArgumentDraftBinding }
  | { action: 'run'; expectedRevision: number; approval: AgentRequestApproval }
  | { action: 'share'; expectedRevision: number; reply: string }
