/** Product-owned execution transaction for one already-approved external MCP
 * activity. Durable activity and attachment authority stay here; the bound
 * call core owns one exact inspected tool invocation. */
import { isExternalMcpId } from '../contract/mcpConnections.ts'
import type { ToolActivity, SessionContext } from '../contract/index.ts'
import type { McpJsonValue } from '../contract/mcpExecution.ts'
import { mcpRuntimeConfiguration } from './mcpRuntime.ts'
import type { McpConnectionView } from '../contract/mcpConnections.ts'
import type { PrivateMcpConnection } from './mcpConnections.ts'
import { createBoundMcpExecutor, createBoundMcpFormExecutor, type McpBoundExecutionOutcome, type McpBoundFormContinuation, type McpBoundFormExecutionOutcome } from './mcpBoundExecution.ts'
import { callMcpToolWithSession } from './mcpToolSession.ts'
import { isToolActivityDecisionId } from './toolActivityDecisionIdentity.ts'

export interface McpExecutionStore {
  privateMcpConnection(id: string, tenantId: string, actorUserId?: string): PrivateMcpConnection | undefined
  mcpConnection(id: string, tenantId: string, actorUserId?: string): McpConnectionView | undefined
  sessionContexts(sessionId: string, actorUserId?: string): SessionContext[]
}

/** Private form continuations have a person-bound, expiring host receipt in
 * addition to the ordinary connection and activity binding. Keep this
 * requirement confined to the form executor so legacy callers stay unchanged. */
export interface McpFormExecutionStore extends McpExecutionStore {
  mcpInputExecutionPermitted(sessionId: string, activityId: string, decisionId: string, tenantId: string,
    actorUserId?: string): boolean
}

export type McpExecutionOutcome = McpBoundExecutionOutcome
export type McpFormExecutionOutcome = McpBoundFormExecutionOutcome

function stillAuthorized(store: McpExecutionStore, sessionId: string, tenantId: string, connectionId: string,
  toolName: string, actorUserId?: string): boolean {
  if (!store.sessionContexts(sessionId, actorUserId).some((context) => context.id === connectionId && context.type === 'mcp')) return false
  const view = store.mcpConnection(connectionId, tenantId, actorUserId)
  return Boolean(view && view.id === connectionId && view.execution === 'approval-required' &&
    view.executableTools?.includes(toolName))
}

/** Execute exactly once. Every return value is safe to persist; raw endpoint,
 * credential, transport errors, and remote response text stay private. */
export function createApprovedMcpExecutor({
  call = callMcpToolWithSession,
  runtimeConfiguration = mcpRuntimeConfiguration,
}: {
  call?: typeof callMcpToolWithSession
  runtimeConfiguration?: typeof mcpRuntimeConfiguration
} = {}) {
  const executeBound = createBoundMcpExecutor({ call, runtimeConfiguration })
  return async (
    store: McpExecutionStore,
    sessionId: string,
    tenantId: string,
    activity: ToolActivity,
    actorUserId?: string,
  ): Promise<McpExecutionOutcome> => {
    if (activity.kind !== 'action' || activity.status !== 'running' || !activity.mcp || activity.op !== undefined ||
        !isExternalMcpId(activity.connectorId) || !activity.decisionId || !isToolActivityDecisionId(activity.decisionId)) {
      return { status: 'failed', summary: 'This MCP execution no longer matches its durable approval.' }
    }
    // Consent is scoped at entry. Never let a mutable activity object retarget
    // an in-flight invocation to a different attachment or tool.
    const connectionId = activity.connectorId
    const toolName = activity.mcp.toolName
    const connectionRevision = activity.mcp.connectionRevision
    const schemaHash = activity.mcp.schemaHash
    const decisionId = activity.decisionId
    const activityId = activity.id
    const argumentsSnapshot = activity.input ?? {}
    return executeBound(store, tenantId, {
      connectionId,
      connectionRevision,
      toolName,
      schemaHash,
      arguments: argumentsSnapshot as Record<string, McpJsonValue>,
    }, () => activity.kind === 'action' && activity.status === 'running' && activity.id === activityId &&
      activity.op === undefined && activity.connectorId === connectionId && activity.decisionId === decisionId &&
      activity.mcp?.connectionRevision === connectionRevision && activity.mcp.toolName === toolName &&
      activity.mcp.schemaHash === schemaHash && stillAuthorized(store, sessionId, tenantId, connectionId, toolName, actorUserId),
    actorUserId)
  }
}

export const executeApprovedMcpActivity = createApprovedMcpExecutor()

/** Explicit form-capable variant for a separately authorized person-reviewed
 * continuation. The ordinary executor above remains form-blind. */
export function createApprovedMcpFormExecutor({
  call,
  callWithForms,
  runtimeConfiguration,
}: {
  call?: NonNullable<Parameters<typeof createBoundMcpFormExecutor>[0]>['call']
  callWithForms?: NonNullable<Parameters<typeof createBoundMcpFormExecutor>[0]>['callWithForms']
  runtimeConfiguration?: NonNullable<Parameters<typeof createBoundMcpFormExecutor>[0]>['runtimeConfiguration']
} = {}) {
  const executeBound = createBoundMcpFormExecutor({ call, callWithForms, runtimeConfiguration })
  return async (
    store: McpFormExecutionStore,
    sessionId: string,
    tenantId: string,
    activity: ToolActivity,
    actorUserId?: string,
    continuation?: McpBoundFormContinuation,
  ): Promise<McpFormExecutionOutcome> => {
    if (activity.kind !== 'action' || activity.status !== 'running' || !activity.mcp || activity.op !== undefined ||
        !isExternalMcpId(activity.connectorId) || !activity.decisionId || !isToolActivityDecisionId(activity.decisionId)) {
      return continuation
        ? { status: 'uncertain', summary: 'The MCP tool was already submitted, but its follow-up could not be completed. Its final outcome is unknown; it will not be retried automatically.' }
        : { status: 'failed', summary: 'This MCP execution no longer matches its durable approval.' }
    }
    const connectionId = activity.connectorId
    const toolName = activity.mcp.toolName
    const connectionRevision = activity.mcp.connectionRevision
    const schemaHash = activity.mcp.schemaHash
    const decisionId = activity.decisionId
    const activityId = activity.id
    const argumentsSnapshot = activity.input ?? {}
    return executeBound(store, tenantId, {
      connectionId,
      connectionRevision,
      toolName,
      schemaHash,
      arguments: argumentsSnapshot as Record<string, McpJsonValue>,
    }, () => activity.kind === 'action' && activity.status === 'running' && activity.id === activityId &&
      activity.op === undefined && activity.connectorId === connectionId && activity.decisionId === decisionId &&
      activity.mcp?.connectionRevision === connectionRevision && activity.mcp.toolName === toolName &&
      activity.mcp.schemaHash === schemaHash && stillAuthorized(store, sessionId, tenantId, connectionId, toolName, actorUserId) &&
      store.mcpInputExecutionPermitted(sessionId, activityId, decisionId, tenantId, actorUserId),
    actorUserId, continuation)
  }
}

export const executeApprovedMcpFormActivity = createApprovedMcpFormExecutor()
