/** Reusable one-attempt executor for an exact MCP call bound to current
 * inspected connection authority. Callers own consent and durable receipts. */
import type { McpBoundToolCall, McpJsonValue, McpToolResult } from '../contract/mcpExecution.ts'
import type { McpFormInputRequired, McpFormInputResponses } from '../contract/mcpElicitation.ts'
import type { McpConnectionView, McpDiscoveredTool } from '../contract/mcpConnections.ts'
import { mcpRuntimeConfiguration } from './mcpRuntime.ts'
import { mcpConnectionEndpoint, type PrivateMcpConnection } from './mcpConnections.ts'
import { McpToolCallError, snapshotMcpFormToolInvocation } from './mcpToolCall.ts'
import { callMcpToolWithSession } from './mcpToolSession.ts'
import { createMcpFormToolSession } from './mcpFormToolSession.ts'
import type { McpFormToolResult } from './mcpToolCall.ts'
import { isMcpProtocolVersion, MCP_MODERN_VERSION } from './mcpProtocol.ts'
import { MCP_SCHEMA_ADMISSION_VERSION, admitMcpTool, mcpToolSchemaHash } from './mcpToolAdmission.ts'
import { validateMcpSchema } from './mcpSchema.ts'
import { snapshotMcpJson } from './mcpJson.ts'
import { snapshotMcpBoundToolCall } from './mcpBoundCall.ts'

const EXECUTION_TIMEOUT_MS = 30_000
const callMcpFormToolSession = createMcpFormToolSession()

export interface McpBoundExecutionStore {
  privateMcpConnection(id: string, tenantId: string, actorUserId?: string): PrivateMcpConnection | undefined
  mcpConnection(id: string, tenantId: string, actorUserId?: string): McpConnectionView | undefined
}

export type McpBoundExecutionOutcome =
  | { status: 'done'; summary: string; result: McpToolResult }
  | { status: 'failed'; summary: string; result?: McpToolResult }
  | { status: 'uncertain'; summary: string }

export type McpBoundFormContinuation = { pending: McpFormInputRequired; responses: McpFormInputResponses }
export type McpBoundFormExecutionOutcome = McpBoundExecutionOutcome |
  { status: 'awaiting-input'; summary: string; pending: McpFormInputRequired }

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function snapshotConnection(value: PrivateMcpConnection, binding: McpBoundToolCall): PrivateMcpConnection | undefined {
  try {
    // Detach only the private authority and selected reviewed tool. A valid
    // discovered catalog can be much larger than one selected schema, and
    // unrelated tools must neither enter this call's snapshot nor its budget.
    if (typeof value.id !== 'string' || typeof value.tenantId !== 'string' || typeof value.label !== 'string' ||
        typeof value.endpoint !== 'string' || !['none', 'device-bearer', 'device-oauth'].includes(value.authentication) ||
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
      ...(value.ownerUserId === undefined ? {} : { ownerUserId: value.ownerUserId }),
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
const uncertain = (summary = 'The MCP server may have accepted this call, but no valid result was received. It will not be run again automatically.'): McpBoundExecutionOutcome => ({
  status: 'uncertain',
  summary,
})

const CONTINUATION_UNKNOWN = 'The MCP tool was already submitted, but its follow-up could not be completed. Its final outcome is unknown; it will not be retried automatically.'

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
function createBoundMcpExecutionCore({
  call = callMcpToolWithSession,
  callWithForms = callMcpFormToolSession,
  runtimeConfiguration = mcpRuntimeConfiguration,
}: {
  call?: typeof callMcpToolWithSession
  callWithForms?: ReturnType<typeof createMcpFormToolSession>
  runtimeConfiguration?: typeof mcpRuntimeConfiguration
} = {}) {
  return async (
    store: McpBoundExecutionStore,
    tenantId: string,
    exactBinding: McpBoundToolCall,
    authorize: () => boolean,
    actorUserId?: string,
    options: { formElicitation?: boolean; continuation?: McpBoundFormContinuation } = {},
  ): Promise<McpBoundFormExecutionOutcome> => {
    const continuation = options.continuation
    const hasContinuation = continuation !== undefined
    const refuse = (summary: string): McpBoundFormExecutionOutcome => hasContinuation
      ? uncertain(CONTINUATION_UNKNOWN)
      : failed(summary)
    const binding = snapshotMcpBoundToolCall(exactBinding)
    if (!binding || !authorized(authorize)) return refuse('This MCP execution no longer matches its durable approval.')

    const currentRow = store.privateMcpConnection(binding.connectionId, tenantId, actorUserId)
    const initial = currentRow && snapshotConnection(currentRow, binding)
    const view = store.mcpConnection(binding.connectionId, tenantId, actorUserId)
    const tool = initial && executableTool(initial, binding)
    if (!initial || initial.id !== binding.connectionId || initial.tenantId !== tenantId || !tool ||
        (initial.authentication === 'device-oauth' && (!actorUserId || !initial.ownerUserId || initial.ownerUserId !== actorUserId)) ||
        !view || view.id !== binding.connectionId || view.revision !== binding.connectionRevision ||
        view.execution !== 'approval-required' || !view.executableTools?.includes(binding.toolName)) {
      return refuse(unavailable)
    }
    if (!isMcpProtocolVersion(initial.inspection!.protocolVersion)) {
      return refuse('The reviewed MCP protocol is no longer supported. Refresh the connection and start a new tool request.')
    }

    // The binding, row, reviewed tool/schema, and runtime are detached before
    // the first await. Later mutation cannot rewrite this logical invocation.
    const protocolVersion = initial.inspection!.protocolVersion
    if (hasContinuation && protocolVersion !== MCP_MODERN_VERSION) return uncertain(CONTINUATION_UNKNOWN)
    const input = binding.arguments
    const reviewedTool = tool
    let frozenContinuation: McpBoundFormContinuation | undefined
    if (continuation) {
      try {
        frozenContinuation = snapshotMcpFormToolInvocation({
          tool: { name: binding.toolName, inputSchema: reviewedTool.inputSchema },
          arguments: input,
          continuation,
        }).continuation
      } catch { return uncertain(CONTINUATION_UNKNOWN) }
      if (!frozenContinuation) return uncertain(CONTINUATION_UNKNOWN)
    }
    const runtime = { ...runtimeConfiguration() }
    const stillBound = (): boolean => {
      if (!authorized(authorize)) return false
      const live = store.privateMcpConnection(binding.connectionId, tenantId, actorUserId)
      if (!live || live.id !== binding.connectionId || live.tenantId !== tenantId ||
          live.endpoint !== initial.endpoint || live.authentication !== initial.authentication ||
          live.credentialReference !== initial.credentialReference || live.ownerUserId !== initial.ownerUserId ||
          live.inspection?.protocolVersion !== protocolVersion) return false
      const liveView = store.mcpConnection(binding.connectionId, tenantId, actorUserId)
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
      if (!stillBound()) return refuse(unavailable)
      const admitted = await admitMcpTool(reviewedTool, { signal: controller.signal })
      if (!admitted.ok) return refuse('The reviewed MCP schema is no longer executable. Refresh the connection and start a new tool request.')
      const acceptedInput = await validateMcpSchema(reviewedTool.inputSchema, { value: input }, {
        signal: controller.signal, timeoutMs: Math.min(2_000, remaining()),
      })
      if (!acceptedInput.ok) return refuse('The reviewed MCP arguments are not valid for this tool. Start a new tool request.')
      if (!stillBound()) return refuse(unavailable)

      const { endpoint, scope } = mcpConnectionEndpoint(initial.endpoint,
        initial.authentication === 'device-oauth' ? false : runtime.allowLoopback)
      let bearerToken: string | undefined
      if (initial.authentication === 'device-bearer') {
        if (!runtime.deviceBearerAvailable || !runtime.resolveCredential || !initial.credentialReference) {
          return refuse('The MCP credential is unavailable. Reconnect it and start a new tool request.')
        }
        const aborted = rejectOnAbort(controller.signal)
        try {
          bearerToken = await Promise.race([
            runtime.resolveCredential(initial.credentialReference, { tenantId, connectionId: initial.id, endpoint }),
            aborted.promise,
          ])
        } catch {
          return refuse('The MCP credential is unavailable. Reconnect it and start a new tool request.')
        } finally { aborted.cleanup() }
        if (!bearerToken || bearerToken.length > 8192 || /[^\x21-\x7e]/.test(bearerToken)) {
          return refuse('The MCP credential is unavailable. Reconnect it and start a new tool request.')
        }
      } else if (initial.authentication === 'device-oauth') {
        if (!actorUserId || !initial.ownerUserId || actorUserId !== initial.ownerUserId || !runtime.deviceOAuthAvailable ||
            !runtime.resolveOAuthCredential || !initial.credentialReference) {
          return refuse('The MCP credential is unavailable. Reconnect it and start a new tool request.')
        }
        const aborted = rejectOnAbort(controller.signal)
        try {
          bearerToken = await Promise.race([
            runtime.resolveOAuthCredential(initial.credentialReference, { tenantId, connectionId: initial.id, endpoint,
              ownerUserId: initial.ownerUserId, connectionRevision: binding.connectionRevision },
            { signal: controller.signal, isCurrent: stillBound }),
            aborted.promise,
          ])
        } catch {
          return refuse('The MCP credential is unavailable. Reconnect it and start a new tool request.')
        } finally { aborted.cleanup() }
        if (!bearerToken || bearerToken.length > 8192 || /[^\x21-\x7e]/.test(bearerToken)) {
          return refuse('The MCP credential is unavailable. Reconnect it and start a new tool request.')
        }
      }
      // Credentials may resolve after consent or the reviewed connection was
      // revoked. Refuse before opening a transport handshake as well as at
      // the final tools/call dispatch boundary below.
      if (!stillBound()) return refuse(unavailable)

      const invocation = {
        tool: { name: binding.toolName, inputSchema: reviewedTool.inputSchema },
        arguments: input,
      }
      const callOptions = {
        scope, bearerToken, signal: controller.signal, timeoutMs: remaining(),
        beforeCall: () => { if (!stillBound()) throw new McpToolCallError('request', false) },
      }
      let toolResult: McpToolResult | McpFormToolResult
      if (options.formElicitation && protocolVersion === MCP_MODERN_VERSION) {
        toolResult = (await callWithForms(endpoint, {
          ...invocation,
          ...(frozenContinuation ? { continuation: frozenContinuation } : {}),
        }, callOptions)).result
      } else {
        toolResult = (await call(endpoint, invocation, { ...callOptions, expectedProtocolVersion: protocolVersion })).result
      }
      resultReceived = true
      const privateLiterals = [endpoint, initial.credentialReference ?? '', bearerToken ?? '']
      if ('resultType' in toolResult && toolResult.resultType === 'input_required') {
        // The result is already a remote continuation point. Only the request
        // form—not opaque requestState—is inspected for private literals.
        if (!options.formElicitation || protocolVersion !== MCP_MODERN_VERSION ||
            containsPrivateLiteral(toolResult.inputRequests as unknown as McpJsonValue, privateLiterals)) return uncertain()
        return {
          status: 'awaiting-input',
          summary: 'The MCP server needs input before it can finish this call.',
          pending: toolResult,
        }
      }
      const result = { result: toolResult as McpToolResult }
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
      return resultReceived || (error instanceof McpToolCallError && error.mayHaveExecuted) || hasContinuation
        ? uncertain(hasContinuation ? CONTINUATION_UNKNOWN : undefined)
        : failed('The MCP call was refused before execution. Start a new tool request.')
    } finally {
      clearTimeout(timer)
      controller.abort()
    }
  }
}

export function createBoundMcpExecutor({
  call = callMcpToolWithSession,
  runtimeConfiguration = mcpRuntimeConfiguration,
}: {
  call?: typeof callMcpToolWithSession
  runtimeConfiguration?: typeof mcpRuntimeConfiguration
} = {}) {
  const execute = createBoundMcpExecutionCore({ call, runtimeConfiguration })
  return async (store: McpBoundExecutionStore, tenantId: string, exactBinding: McpBoundToolCall,
    authorize: () => boolean, actorUserId?: string): Promise<McpBoundExecutionOutcome> =>
    execute(store, tenantId, exactBinding, authorize, actorUserId) as Promise<McpBoundExecutionOutcome>
}

export function createBoundMcpFormExecutor({
  call = callMcpToolWithSession,
  callWithForms = callMcpFormToolSession,
  runtimeConfiguration = mcpRuntimeConfiguration,
}: {
  call?: typeof callMcpToolWithSession
  callWithForms?: ReturnType<typeof createMcpFormToolSession>
  runtimeConfiguration?: typeof mcpRuntimeConfiguration
} = {}) {
  const execute = createMcpBoundFormExecutorCore({ call, callWithForms, runtimeConfiguration })
  return (store: McpBoundExecutionStore, tenantId: string, exactBinding: McpBoundToolCall,
    authorize: () => boolean, actorUserId?: string, continuation?: McpBoundFormContinuation) =>
    execute(store, tenantId, exactBinding, authorize, actorUserId, continuation)
}

function createMcpBoundFormExecutorCore(dependencies: Parameters<typeof createBoundMcpExecutionCore>[0]) {
  const execute = createBoundMcpExecutionCore(dependencies)
  return (store: McpBoundExecutionStore, tenantId: string, exactBinding: McpBoundToolCall,
    authorize: () => boolean, actorUserId?: string, continuation?: McpBoundFormContinuation) =>
    execute(store, tenantId, exactBinding, authorize, actorUserId, { formElicitation: true, continuation })
}

export const executeBoundMcpCall = createBoundMcpExecutor()
