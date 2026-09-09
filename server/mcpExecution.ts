/** Product-owned execution transaction for one already-approved external MCP
 * activity. Consent and durable state live in the store; this module resolves
 * private connection authority and performs exactly one protocol call. */
import { isExternalMcpId, type McpDiscoveredTool, type McpConnectionView } from '../contract/mcpConnections.ts'
import type { McpJsonValue, McpToolResult, ToolActivity, SessionContext } from '../contract/index.ts'
import { mcpRuntimeConfiguration } from './mcpRuntime.ts'
import { mcpConnectionEndpoint, type PrivateMcpConnection } from './mcpConnections.ts'
import { McpToolCallError } from './mcpToolCall.ts'
import { callMcpToolWithSession } from './mcpToolSession.ts'
import { isMcpProtocolVersion } from './mcpProtocol.ts'
import { MCP_SCHEMA_ADMISSION_VERSION, admitMcpTool, mcpToolSchemaHash } from './mcpToolAdmission.ts'
import { validateMcpSchema } from './mcpSchema.ts'
import { isToolActivityDecisionId } from './toolActivityDecisionIdentity.ts'

const EXECUTION_TIMEOUT_MS = 30_000

export interface McpExecutionStore {
  privateMcpConnection(id: string, tenantId: string): PrivateMcpConnection | undefined
  mcpConnection(id: string, tenantId: string): McpConnectionView | undefined
  sessionContexts(sessionId: string): SessionContext[]
}

export type McpExecutionOutcome =
  | { status: 'done'; summary: string; result: McpToolResult }
  | { status: 'failed'; summary: string; result?: McpToolResult }
  | { status: 'uncertain'; summary: string }

function containsPrivateLiteral(value: McpJsonValue | McpToolResult, literals: string[]): boolean {
  if (typeof value === 'string') return literals.some((literal) => literal.length > 0 && value.includes(literal))
  if (Array.isArray(value)) return value.some((item) => containsPrivateLiteral(item, literals))
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([key, item]) =>
      literals.some((literal) => literal.length > 0 && key.includes(literal)) || containsPrivateLiteral(item as McpJsonValue, literals))
  }
  return false
}

function rejectOnAbort(signal: AbortSignal): { promise: Promise<never>; cleanup: () => void } {
  let rejectPromise: (reason?: unknown) => void = () => {}
  const promise = new Promise<never>((_resolve, reject) => { rejectPromise = reject })
  const reject = () => rejectPromise(new Error('timeout'))
  if (signal.aborted) reject()
  else signal.addEventListener('abort', reject, { once: true })
  return { promise, cleanup: () => signal.removeEventListener('abort', reject) }
}

function activityTool(row: PrivateMcpConnection, activity: ToolActivity): McpDiscoveredTool | undefined {
  if (!activity.mcp || row.revision !== activity.mcp.connectionRevision || !row.connected || !row.inspection) return undefined
  const tool = row.inspection.tools.find((candidate) => candidate.name === activity.mcp!.toolName)
  if (!tool || mcpToolSchemaHash(tool) !== activity.mcp.schemaHash) return undefined
  if (row.inspection.schemaAdmission?.version !== MCP_SCHEMA_ADMISSION_VERSION || !row.inspection.schemaAdmission.hashes.includes(activity.mcp.schemaHash)) return undefined
  return tool
}

function stillAuthorized(store: McpExecutionStore, sessionId: string, tenantId: string, activity: ToolActivity): McpDiscoveredTool | undefined {
  if (!store.sessionContexts(sessionId).some((context) => context.id === activity.connectorId && context.type === 'mcp')) return undefined
  const view = store.mcpConnection(activity.connectorId, tenantId)
  if (!view || view.id !== activity.connectorId || view.execution !== 'approval-required' || !view.executableTools?.includes(activity.mcp?.toolName ?? '')) return undefined
  const row = store.privateMcpConnection(activity.connectorId, tenantId)
  return row?.id === activity.connectorId && row.tenantId === tenantId ? activityTool(row, activity) : undefined
}

const failed = (summary: string): McpExecutionOutcome => ({ status: 'failed', summary })
const uncertain = (): McpExecutionOutcome => ({
  status: 'uncertain',
  summary: 'The MCP server may have accepted this call, but no valid result was received. It will not be run again automatically.',
})

/** Execute exactly once. Every return value is safe to persist; raw endpoint,
 * credential, transport errors, and remote response text stay private. */
export function createApprovedMcpExecutor({
  call = callMcpToolWithSession,
  runtimeConfiguration = mcpRuntimeConfiguration,
}: {
  call?: typeof callMcpToolWithSession
  runtimeConfiguration?: typeof mcpRuntimeConfiguration
} = {}) {
  return async (
    store: McpExecutionStore,
    sessionId: string,
    tenantId: string,
    activity: ToolActivity,
  ): Promise<McpExecutionOutcome> => {
    if (activity.kind !== 'action' || activity.status !== 'running' || !activity.mcp || activity.op !== undefined ||
        !isExternalMcpId(activity.connectorId) || !activity.decisionId || !isToolActivityDecisionId(activity.decisionId)) {
      return failed('This MCP execution no longer matches its durable approval.')
    }
    const runtime = runtimeConfiguration()
    const initial = store.privateMcpConnection(activity.connectorId, tenantId)
    const tool = initial && activityTool(initial, activity)
    if (!initial || initial.id !== activity.connectorId || initial.tenantId !== tenantId || !tool || !stillAuthorized(store, sessionId, tenantId, activity)) {
      return failed('The reviewed MCP connection or tool is no longer available. Start a new tool request.')
    }
    if (!isMcpProtocolVersion(initial.inspection!.protocolVersion)) {
      return failed('The reviewed MCP protocol is no longer supported. Refresh the connection and start a new tool request.')
    }
    const protocolVersion = initial.inspection!.protocolVersion
    const input = activity.input ?? {}
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), EXECUTION_TIMEOUT_MS)
    timer.unref?.()
    const startedAt = performance.now()
    const remaining = () => Math.max(1, Math.floor(EXECUTION_TIMEOUT_MS - (performance.now() - startedAt)))
    let resultReceived = false
    try {
      const admitted = await admitMcpTool(tool, { signal: controller.signal })
      if (!admitted.ok) return failed('The reviewed MCP schema is no longer executable. Refresh the connection and start a new tool request.')
      const acceptedInput = await validateMcpSchema(tool.inputSchema, { value: input }, { signal: controller.signal, timeoutMs: Math.min(2_000, remaining()) })
      if (!acceptedInput.ok) return failed('The reviewed MCP arguments are not valid for this tool. Start a new tool request.')

      const { endpoint, scope } = mcpConnectionEndpoint(initial.endpoint, runtime.allowLoopback)
      let bearerToken: string | undefined
      if (initial.authentication === 'device-bearer') {
        if (!runtime.deviceBearerAvailable || !runtime.resolveCredential || !initial.credentialReference) {
          return failed('The MCP credential is unavailable. Reconnect it and start a new tool request.')
        }
        const aborted = rejectOnAbort(controller.signal)
        try {
          bearerToken = await Promise.race([
            runtime.resolveCredential(initial.credentialReference, { tenantId, connectionId: initial.id, endpoint }),
            aborted.promise,
          ])
        } catch {
          return failed('The MCP credential is unavailable. Reconnect it and start a new tool request.')
        } finally {
          aborted.cleanup()
        }
        if (!bearerToken || bearerToken.length > 8192 || /[^\x21-\x7e]/.test(bearerToken)) {
          return failed('The MCP credential is unavailable. Reconnect it and start a new tool request.')
        }
      }

      const result = await call(endpoint, {
        tool: { name: activity.mcp!.toolName, inputSchema: tool.inputSchema },
        arguments: input,
      }, {
        scope,
        bearerToken,
        signal: controller.signal,
        timeoutMs: remaining(),
        expectedProtocolVersion: protocolVersion,
        beforeCall: () => {
          if (!stillAuthorized(store, sessionId, tenantId, activity)) throw new McpToolCallError('request', false)
        },
      })
      resultReceived = true

      const privateLiterals = [endpoint, initial.credentialReference ?? '', bearerToken ?? '']
      if (containsPrivateLiteral(result.result, privateLiterals)) return uncertain()
      if (tool.outputSchema !== undefined) {
        if (result.result.structuredContent === undefined) return uncertain()
        const acceptedOutput = await validateMcpSchema(
          tool.outputSchema,
          { value: result.result.structuredContent },
          { signal: controller.signal, timeoutMs: Math.min(2_000, remaining()) },
        )
        if (!acceptedOutput.ok) return uncertain()
      }
      return result.result.isError
        ? { status: 'failed', summary: 'The MCP server returned a tool error.', result: result.result }
        : { status: 'done', summary: 'The MCP tool completed.', result: result.result }
    } catch (error) {
      return resultReceived || (error instanceof McpToolCallError && error.mayHaveExecuted)
        ? uncertain()
        : failed('The MCP call was refused before execution. Start a new tool request.')
    } finally {
      clearTimeout(timer)
      controller.abort()
    }
  }
}

export const executeApprovedMcpActivity = createApprovedMcpExecutor()
