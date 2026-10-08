/** Reusable one-attempt executor for an exact MCP call bound to current
 * inspected connection authority. Callers own consent and durable receipts. */
import type { McpBoundToolCall, McpJsonValue, McpToolResult } from '../contract/mcpExecution.ts'
import type { McpConnectionView, McpDiscoveredTool } from '../contract/mcpConnections.ts'
import { mcpRuntimeConfiguration } from './mcpRuntime.ts'
import { mcpConnectionEndpoint, type PrivateMcpConnection } from './mcpConnections.ts'
import { McpToolCallError } from './mcpToolCall.ts'
import { callMcpToolWithSession } from './mcpToolSession.ts'
import { isMcpProtocolVersion } from './mcpProtocol.ts'
import { MCP_SCHEMA_ADMISSION_VERSION, admitMcpTool, mcpToolSchemaHash } from './mcpToolAdmission.ts'
import { validateMcpSchema } from './mcpSchema.ts'
import { snapshotMcpJson } from './mcpJson.ts'
import { snapshotMcpBoundToolCall } from './mcpBoundCall.ts'

const EXECUTION_TIMEOUT_MS = 30_000

export interface McpBoundExecutionStore {
  privateMcpConnection(id: string, tenantId: string): PrivateMcpConnection | undefined
  mcpConnection(id: string, tenantId: string): McpConnectionView | undefined
}

export type McpBoundExecutionOutcome =
  | { status: 'done'; summary: string; result: McpToolResult }
  | { status: 'failed'; summary: string; result?: McpToolResult }
  | { status: 'uncertain'; summary: string }

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function snapshotConnection(value: PrivateMcpConnection, binding: McpBoundToolCall): PrivateMcpConnection | undefined {
  try {
    // Detach only the private authority and selected reviewed tool. A valid
    // discovered catalog can be much larger than one selected schema, and
    // unrelated tools must neither enter this call's snapshot nor its budget.
    if (typeof value.id !== 'string' || typeof value.tenantId !== 'string' || typeof value.label !== 'string' ||
        typeof value.endpoint !== 'string' || !['none', 'device-bearer'].includes(value.authentication) ||
        !Number.isSafeInteger(value.revision) || typeof value.connected !== 'boolean' || !value.inspection ||
        typeof value.inspection.protocolVersion !== 'string' || typeof value.inspection.cleanup !== 'string' ||
        !Number.isSafeInteger(value.inspection.inspectedAt) || !Array.isArray(value.inspection.tools)) return undefined
    const selected = value.inspection.tools.find((candidate) => candidate.name === binding.toolName)
    if (!selected) return undefined
    const tool = snapshotMcpJson(selected, { maxBytes: 196_608, maxDepth: 36, maxNodes: 12_288 })
    const admission = value.inspection.schemaAdmission
    if (!record(tool) || !admission || !Number.isSafeInteger(admission.version) || !Array.isArray(admission.hashes) ||
        admission.hashes.length > value.inspection.tools.length) return undefined
    const hashes = snapshotMcpJson(admission.hashes, { maxBytes: 16_384, maxDepth: 3, maxNodes: 512 })
    if (!Array.isArray(hashes)) return undefined
    const snapshot: PrivateMcpConnection = {
      id: value.id,
      tenantId: value.tenantId,
      label: value.label,
      endpoint: value.endpoint,
      authentication: value.authentication,
      revision: value.revision,
      connected: value.connected,
      inspection: {
        protocolVersion: value.inspection.protocolVersion,
        cleanup: value.inspection.cleanup as NonNullable<PrivateMcpConnection['inspection']>['cleanup'],
        inspectedAt: value.inspection.inspectedAt,
        tools: [tool as unknown as McpDiscoveredTool],
        schemaAdmission: { version: admission.version, hashes: hashes as string[] },
      },
      ...(value.credentialReference === undefined ? {} : { credentialReference: value.credentialReference }),
    }
    return snapshot
  } catch { return undefined }
}

function rejectOnAbort(signal: AbortSignal): { promise: Promise<never>; cleanup: () => void } {
  let rejectPromise: (reason?: unknown) => void = () => {}
  const promise = new Promise<never>((_resolve, reject) => { rejectPromise = reject })
  const reject = () => rejectPromise(new Error('timeout'))
  if (signal.aborted) reject()
  else signal.addEventListener('abort', reject, { once: true })
  return { promise, cleanup: () => signal.removeEventListener('abort', reject) }
}

function containsPrivateLiteral(value: McpJsonValue | McpToolResult, literals: string[]): boolean {
  if (typeof value === 'string') return literals.some((literal) => literal.length > 0 && value.includes(literal))
  if (Array.isArray(value)) return value.some((item) => containsPrivateLiteral(item, literals))
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([key, item]) =>
      literals.some((literal) => literal.length > 0 && key.includes(literal)) || containsPrivateLiteral(item as McpJsonValue, literals))
  }
  return false
}

const failed = (summary: string): McpBoundExecutionOutcome => ({ status: 'failed', summary })
const unavailable = 'The reviewed MCP connection or tool is no longer available. Start a new tool request.'
const uncertain = (): McpBoundExecutionOutcome => ({
  status: 'uncertain',
  summary: 'The MCP server may have accepted this call, but no valid result was received. It will not be run again automatically.',
})

function authorized(authorize: () => boolean): boolean {
  let decision: unknown
  try { decision = authorize() } catch { return false }
  if (decision === true) return true
  // The contract is synchronous. Observe only a native rejected Promise so a
  // mistaken async callback cannot create an unhandled rejection; never await it.
  if (decision instanceof Promise) void decision.catch(() => {})
  return false
}

function executableTool(row: PrivateMcpConnection, binding: McpBoundToolCall): McpDiscoveredTool | undefined {
  if (row.id !== binding.connectionId || row.revision !== binding.connectionRevision ||
      !row.connected || !row.inspection) return undefined
  const tool = row.inspection.tools.find((candidate) => candidate.name === binding.toolName)
  try { if (!tool || mcpToolSchemaHash(tool) !== binding.schemaHash) return undefined }
  catch { return undefined }
  const admission = row.inspection.schemaAdmission
  if (admission?.version !== MCP_SCHEMA_ADMISSION_VERSION || !admission.hashes.includes(binding.schemaHash)) return undefined
  return tool
}

/** Execute one exact binding. The callback is deliberately synchronous: only
 * literal `true` admits work, and thenables are refusals rather than a second
 * authority protocol. Callers persist consent/receipts outside this module. */
export function createBoundMcpExecutor({
  call = callMcpToolWithSession,
  runtimeConfiguration = mcpRuntimeConfiguration,
}: {
  call?: typeof callMcpToolWithSession
  runtimeConfiguration?: typeof mcpRuntimeConfiguration
} = {}) {
  return async (
    store: McpBoundExecutionStore,
    tenantId: string,
    exactBinding: McpBoundToolCall,
    authorize: () => boolean,
  ): Promise<McpBoundExecutionOutcome> => {
    const binding = snapshotMcpBoundToolCall(exactBinding)
    if (!binding || !authorized(authorize)) return failed('This MCP execution no longer matches its durable approval.')

    const currentRow = store.privateMcpConnection(binding.connectionId, tenantId)
    const initial = currentRow && snapshotConnection(currentRow, binding)
    const view = store.mcpConnection(binding.connectionId, tenantId)
    const tool = initial && executableTool(initial, binding)
    if (!initial || initial.id !== binding.connectionId || initial.tenantId !== tenantId || !tool ||
        !view || view.id !== binding.connectionId || view.revision !== binding.connectionRevision ||
        view.execution !== 'approval-required' || !view.executableTools?.includes(binding.toolName)) {
      return failed(unavailable)
    }
    if (!isMcpProtocolVersion(initial.inspection!.protocolVersion)) {
      return failed('The reviewed MCP protocol is no longer supported. Refresh the connection and start a new tool request.')
    }

    // The binding, row, reviewed tool/schema, and runtime are detached before
    // the first await. Later mutation cannot rewrite this logical invocation.
    const protocolVersion = initial.inspection!.protocolVersion
    const input = binding.arguments
    const reviewedTool = tool
    const runtime = { ...runtimeConfiguration() }
    const stillBound = (): boolean => {
      if (!authorized(authorize)) return false
      const live = store.privateMcpConnection(binding.connectionId, tenantId)
      if (!live || live.id !== binding.connectionId || live.tenantId !== tenantId ||
          live.endpoint !== initial.endpoint || live.authentication !== initial.authentication ||
          live.credentialReference !== initial.credentialReference ||
          live.inspection?.protocolVersion !== protocolVersion) return false
      const liveView = store.mcpConnection(binding.connectionId, tenantId)
      return Boolean(liveView && liveView.id === binding.connectionId &&
        liveView.revision === binding.connectionRevision && liveView.execution === 'approval-required' &&
        liveView.executableTools?.includes(binding.toolName) && executableTool(live, binding))
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), EXECUTION_TIMEOUT_MS)
    timer.unref?.()
    const startedAt = performance.now()
    const remaining = () => Math.max(1, Math.floor(EXECUTION_TIMEOUT_MS - (performance.now() - startedAt)))
    let resultReceived = false
    try {
      if (!stillBound()) return failed(unavailable)
      const admitted = await admitMcpTool(reviewedTool, { signal: controller.signal })
      if (!admitted.ok) return failed('The reviewed MCP schema is no longer executable. Refresh the connection and start a new tool request.')
      const acceptedInput = await validateMcpSchema(reviewedTool.inputSchema, { value: input }, {
        signal: controller.signal, timeoutMs: Math.min(2_000, remaining()),
      })
      if (!acceptedInput.ok) return failed('The reviewed MCP arguments are not valid for this tool. Start a new tool request.')
      if (!stillBound()) return failed(unavailable)

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
        } finally { aborted.cleanup() }
        if (!bearerToken || bearerToken.length > 8192 || /[^\x21-\x7e]/.test(bearerToken)) {
          return failed('The MCP credential is unavailable. Reconnect it and start a new tool request.')
        }
      }
      // Credentials may resolve after consent or the reviewed connection was
      // revoked. Refuse before opening a transport handshake as well as at
      // the final tools/call dispatch boundary below.
      if (!stillBound()) return failed(unavailable)

      const result = await call(endpoint, {
        tool: { name: binding.toolName, inputSchema: reviewedTool.inputSchema },
        arguments: input,
      }, {
        scope, bearerToken, signal: controller.signal, timeoutMs: remaining(), expectedProtocolVersion: protocolVersion,
        beforeCall: () => { if (!stillBound()) throw new McpToolCallError('request', false) },
      })
      resultReceived = true
      const privateLiterals = [endpoint, initial.credentialReference ?? '', bearerToken ?? '']
      if (containsPrivateLiteral(result.result, privateLiterals)) return uncertain()
      if (reviewedTool.outputSchema !== undefined) {
        if (result.result.structuredContent === undefined) return uncertain()
        const acceptedOutput = await validateMcpSchema(reviewedTool.outputSchema, { value: result.result.structuredContent }, {
          signal: controller.signal, timeoutMs: Math.min(2_000, remaining()),
        })
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

export const executeBoundMcpCall = createBoundMcpExecutor()
