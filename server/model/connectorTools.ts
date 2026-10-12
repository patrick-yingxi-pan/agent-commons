/** ── Connector / MCP tool exposure (P6 §2.2, PD57/PD58) ─────────────────────
 *  Turns a session's attached connector / MCP contexts into tools the model can
 *  call. This is the load-bearing P6 claim made real: today the Messages request's
 *  tool list is only the worker Agent's static allowlist (server/generate.ts); a
 *  connector/MCP attached to the *session* contributed nothing callable. Here we
 *  derive per-context tool definitions from the (fixture) connector detail, declare
 *  them in the request, and — when the model calls one — route it through the
 *  connector runtime into a `ToolActivity` fed back to the model and UI.
 *
 *  Framework-free and Node-importable (no React, no server singletons) so it unit-
 *  tests in isolation. Authority is structural: only an *attached* connector/MCP
 *  context yields tools. Fulfilment is injected: development uses the declared
 *  fixture runtime while release profiles fail closed until a real adapter exists. */
import type { Connector, ToolActivity } from '../../contract/entities.ts'
import type { SessionContext } from '../../contract/contexts.ts'
import { isExternalMcpId, type McpConnectionView } from '../../contract/mcpConnections.ts'
import type { McpBoundToolCall, McpToolResult } from '../../contract/mcpExecution.ts'
import type { RoutineMcpCallReceipt, RoutineMcpToolPermission } from '../../contract/routineMcp.ts'
import { createHash, randomUUID } from 'node:crypto'
import { mcpToolSchemaHash } from '../mcpToolAdmission.ts'
import { snapshotMcpToolInvocation } from '../mcpToolCall.ts'
import { validateMcpSchema } from '../mcpSchema.ts'
import { parseMcpToolResult } from '../mcpToolResult.ts'
import { MCP_MODERN_VERSION } from '../mcpProtocol.ts'
import { sameRoutineMcpJson } from '../routineMcpPolicy.ts'
import { connectorDetail, type ConnectorDetail } from '../data/connectorDetails.ts'
import { acceptConnectorInput, invokeConnectorRuntime, type ConnectorToolRuntime } from '../connectorRuntime.ts'

/** The Anthropic tool-definition slice we declare per connector/MCP tool. */
export interface ConnectorToolDef {
  name: string
  description: string
  input_schema: { type: 'object'; [key: string]: unknown }
}

/** Execution binding for a derived tool — how to turn a call into a `ToolActivity`. */
interface ToolBinding {
  connectorId: string
  connectorLabel: string
  kind: ToolActivity['kind']
  developmentFixtureSummary: string
  /** A scheduled routine has already received standing approval for the
   *  contexts in its authored workflow. Interactive turns omit this and keep
   *  action tools proposal-only. */
  standingApproved: boolean
  /** Exact inspected authority, never a development fixture or standing grant. */
  mcp?: { anchor: NonNullable<ToolActivity['mcp']>; inputSchema: Record<string, unknown> }
  /** Separate owner-reviewed unattended authority. Never represented as ToolActivity consent. */
  routineMcp?: { call: Omit<McpBoundToolCall, 'arguments'>; inputSchema: Record<string, unknown>; fixedArguments: RoutineMcpToolPermission['fixedArguments'] }
}

/** Explicit adapter for the durable Routine MCP ledger. Interactive sessions do
 * not receive this capability even when a context has standing approval. */
export interface RoutineMcpRuntime {
  tools: readonly (RoutineMcpToolPermission & { transport?: 'stdio' })[]
  /** Trusted host opt-in for local programs; ordinary model callers omit it. */
  localPrograms?: true
  execute(call: McpBoundToolCall, key: string, signal?: AbortSignal): Promise<RoutineMcpCallReceipt>
}

/** What `deriveConnectorTools` returns: the definitions to declare + the bindings the
 *  executor dispatches through (keyed by tool name). */
export interface DerivedConnectorTools {
  definitions: ConnectorToolDef[]
  bindings: Map<string, ToolBinding>
  externalUnavailable?: boolean
  routineUnavailable?: boolean
}
export const EXTERNAL_CATALOG_LIMIT_MESSAGE = 'Attached external MCP tools exceed the bounded catalog capacity and are unavailable for this turn. Ask the user to attach fewer MCP servers; do not claim tools were called.'
export const ROUTINE_MCP_UNAVAILABLE_MESSAGE = 'A reviewed Routine MCP tool is no longer available under its exact inspected connection and schema. No external MCP tool was offered for this run.'

/** Only connector / MCP contexts contribute model tools (a folder/repo/file is
 *  surfaced through the built-in resource tools, not here). */
export function isConnectorContext(ctx: SessionContext): boolean {
  return ctx.type === 'connector' || ctx.type === 'mcp'
}

/** A URL/tool-name-safe slug from a context label ("MCP · filesystem" → "filesystem",
 *  "Google Drive" → "google_drive"). Falls back to the id when a label slugs to empty. */
function slug(label: string): string {
  return label
    .replace(/^MCP\s*·\s*/i, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

/** Rebuild the `Connector` shape `connectorDetail` expects from a bound context. */
function asConnector(ctx: SessionContext): Connector {
  return { id: ctx.id, label: ctx.label, kind: ctx.type === 'mcp' ? 'mcp' : 'connector' }
}

/** A conservative read/action classifier for an MCP tool name (mutating verbs ⇒
 *  action; everything else ⇒ read). The distinction drives consent; the injected
 *  runtime decides whether fulfilment is fixture, unavailable, or real. */
const ACTION_VERB = /(write|create|update|delete|remove|post|send|click|navigate|evaluate|screenshot|run)/i

function mcpResult(tool: string, label: string): string {
  return `(mock) ran ${tool} on ${label}.`
}

function connectorResult(detail: ConnectorDetail): string {
  const names = detail.items.map((i) => i.label).filter(Boolean).slice(0, 5)
  return names.length
    ? `(mock) ${detail.itemsLabel}: ${names.join(', ')}.`
    : `(mock) no ${detail.itemsLabel.toLowerCase()} found.`
}

/** Derive the callable tools for a session's attached contexts. Non-connector
 *  contexts are ignored; each MCP context contributes one tool per advertised tool,
 *  each connector one `…__list` read tool over its resources. Deterministic: same
 *  contexts ⇒ same definitions + bindings (so tests and the wire are stable). */
export function deriveConnectorTools(
  contexts: SessionContext[],
  options: { standingApprovedContextIds?: ReadonlySet<string>; externalMcpConnections?: readonly McpConnectionView[]; routineMcp?: RoutineMcpRuntime } = {},
): DerivedConnectorTools {
  const definitions: ConnectorToolDef[] = []
  const bindings = new Map<string, ToolBinding>()
  const emptySchema = { type: 'object' as const, properties: {} as Record<string, never>, required: [] as string[] }

  for (const ctx of contexts) {
    if (!isConnectorContext(ctx)) continue
    // A saved external connection cannot borrow fixture capabilities through
    // a label or a caller-supplied kind. Its separately admitted path follows.
    if (isExternalMcpId(ctx.id)) continue
    const detail = connectorDetail(asConnector(ctx))
    const s = slug(ctx.label) || ctx.id

    if (ctx.type === 'mcp') {
      for (const item of detail.items) {
        const toolName = item.label.trim()
        if (!toolName) continue
        const name = `mcp__${s}__${toolName}`
        if (bindings.has(name)) continue // a repeated tool name on the same server — declare once
        definitions.push({ name, description: `${toolName} — via the ${ctx.label} MCP server.`, input_schema: emptySchema })
        bindings.set(name, {
          connectorId: ctx.id,
          connectorLabel: ctx.label,
          kind: ACTION_VERB.test(toolName) ? 'action' : 'read',
          developmentFixtureSummary: mcpResult(toolName, ctx.label),
          standingApproved: options.standingApprovedContextIds?.has(ctx.id) === true,
        })
      }
    } else {
      const name = `connector__${s}__list`
      if (bindings.has(name)) continue
      definitions.push({ name, description: `List available resources from the ${ctx.label} connector.`, input_schema: emptySchema })
      bindings.set(name, {
        connectorId: ctx.id,
        connectorLabel: ctx.label,
        kind: 'read',
        developmentFixtureSummary: connectorResult(detail),
        standingApproved: options.standingApprovedContextIds?.has(ctx.id) === true,
      })
    }
  }
  const externalDefinitions: ConnectorToolDef[] = []
  const externalBindings = new Map<string, ToolBinding>()
  let bytes = 0
  let routineUnavailable = false
  const routineTools = options.routineMcp?.tools
  if (options.routineMcp) {
    const seenRoutine = new Set<string>()
    for (const permission of routineTools ?? []) {
      const key = JSON.stringify([permission.connectionId, permission.toolName])
      if (seenRoutine.has(key)) { routineUnavailable = true; break }
      seenRoutine.add(key)
      const context = contexts.find(row => row.type === 'mcp' && row.id === permission.connectionId)
      const connection = options.externalMcpConnections?.find(row => row.id === permission.connectionId)
      const matches = connection?.tools.filter(row => row.name === permission.toolName) ?? []
      const connectionTransport = connection?.transport === 'stdio' ? 'stdio' : undefined
      if (!context || !isExternalMcpId(permission.connectionId) || !connection || connection.status !== 'connected' ||
          (connection.transport !== undefined && connection.transport !== 'http' && connection.transport !== 'stdio') ||
          (connectionTransport === 'stdio' && (options.routineMcp.localPrograms !== true || permission.transport !== 'stdio')) ||
          (connectionTransport !== permission.transport) ||
          connection.execution !== 'approval-required' || connection.revision !== permission.connectionRevision ||
          !connection.executableTools?.includes(permission.toolName) || matches.length !== 1 ||
          mcpToolSchemaHash(matches[0]!) !== permission.schemaHash) {
        routineUnavailable = true
        break
      }
      const tool = matches[0]!
      const name = `mcp_external_${createHash('sha256').update(JSON.stringify([connection.id, tool.name])).digest('hex').slice(0, 48)}`
      if (externalBindings.has(name)) continue
      const exact = snapshotMcpToolInvocation({ tool, arguments: {} })
      const inputSchema = exact.tool.inputSchema as ConnectorToolDef['input_schema']
      const constrainedSchema = withFixedArgumentHints(inputSchema, permission.fixedArguments)
      if (!constrainedSchema) { routineUnavailable = true; break }
      const fixedDescription = Object.keys(permission.fixedArguments).length
        ? ` Exact reviewed argument constraints: ${JSON.stringify(permission.fixedArguments)}. Other arguments must still pass the inspected schema.`
        : ' No argument values are fixed; all arguments must pass the inspected schema.'
      const definition: ConnectorToolDef = { name,
        description: `${tool.name} — via ${connection.label}. Unattended Routine permission; exact arguments are bounded by the reviewed constraints.${fixedDescription}\n${tool.description ?? ''}`,
        input_schema: constrainedSchema }
      bytes += new TextEncoder().encode(JSON.stringify(definition)).byteLength
      if (externalDefinitions.length >= 128 || bytes > 524_288) return { definitions, bindings, routineUnavailable: true }
      externalDefinitions.push(definition)
      externalBindings.set(name, { connectorId: connection.id, connectorLabel: connection.label,
        kind: 'action', developmentFixtureSummary: '', standingApproved: false,
        routineMcp: { call: { connectionId: permission.connectionId, connectionRevision: permission.connectionRevision,
          toolName: permission.toolName, schemaHash: permission.schemaHash }, inputSchema: exact.tool.inputSchema,
          fixedArguments: permission.fixedArguments } })
    }
  } else {
    for (const context of contexts) {
      if (context.type !== 'mcp' || !isExternalMcpId(context.id)) continue
      const connection = options.externalMcpConnections?.find(row => row.id === context.id)
      if (!connection || connection.status !== 'connected' || connection.execution !== 'approval-required') continue
      for (const tool of connection.tools) {
        if (!connection.executableTools?.includes(tool.name)) continue
        const name = `mcp_external_${createHash('sha256').update(JSON.stringify([connection.id, tool.name])).digest('hex').slice(0, 48)}`
        if (externalBindings.has(name)) continue
        const exact = snapshotMcpToolInvocation({ tool, arguments: {} })
        const definition: ConnectorToolDef = { name,
          description: `${tool.name} — via ${connection.label}. External server; every call proposes exact arguments for owner approval.\n${tool.description ?? ''}`,
          input_schema: exact.tool.inputSchema as ConnectorToolDef['input_schema'] }
        bytes += new TextEncoder().encode(JSON.stringify(definition)).byteLength
        // Do not partially expose an oversized set and leave the model guessing
        // which attached tools it can use. The caller discloses this refusal.
        if (externalDefinitions.length >= 128 || bytes > 524_288) return { definitions, bindings, externalUnavailable: true }
        externalDefinitions.push(definition)
        externalBindings.set(name, { connectorId: connection.id, connectorLabel: connection.label,
          kind: 'action', developmentFixtureSummary: '', standingApproved: false,
          mcp: { anchor: { connectionRevision: connection.revision, toolName: tool.name, schemaHash: mcpToolSchemaHash(tool) }, inputSchema: exact.tool.inputSchema } })
      }
    }
  }
  if (routineUnavailable) return { definitions, bindings, routineUnavailable: true }
  for (const [name, binding] of externalBindings) bindings.set(name, binding)
  return { definitions: [...definitions, ...externalDefinitions], bindings }
}

function withFixedArgumentHints(
  schema: ConnectorToolDef['input_schema'],
  fixed: RoutineMcpToolPermission['fixedArguments'],
): ConnectorToolDef['input_schema'] | undefined {
  const properties = schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)
    ? schema.properties as Record<string, unknown> : {}
  const next = Object.create(null) as Record<string, unknown>
  for (const key of Object.keys(properties)) Object.defineProperty(next, key, {
    value: properties[key], enumerable: true, writable: true, configurable: true,
  })
  for (const [key, value] of Object.entries(fixed)) {
    const prior = Object.hasOwn(properties, key) ? properties[key] : {}
    if (prior !== null && (typeof prior !== 'object' || Array.isArray(prior))) return undefined
    const hint = Object.assign(Object.create(null), prior, { const: value })
    Object.defineProperty(next, key, { value: hint, enumerable: true, writable: true, configurable: true })
  }
  return { ...schema, properties: next }
}

/** The bare tool name for display / prose — drop the `mcp__slug__` / `connector__slug__`
 *  wire prefix that carries the connector routing. */
export function shortToolName(tool: string): string {
  const parts = tool.split('__')
  return parts.length >= 3 ? parts.slice(2).join('__') : tool
}

export interface RoutineMcpToolResult {
  content: string
  isError: boolean
}

/** Execute only a definition carrying the separate Routine-owned binding. The
 * provider's tool-use id is deliberately absent from the callback identity. */
export async function runRoutineMcpTool(
  name: string,
  bindings: Map<string, ToolBinding>,
  input: Record<string, unknown>,
  runtime: RoutineMcpRuntime | undefined,
  signal?: AbortSignal,
): Promise<RoutineMcpToolResult | undefined> {
  const binding = bindings.get(name)?.routineMcp
  if (!binding) return undefined
  if (!runtime) return { content: 'The reviewed Routine MCP executor is unavailable. No external call was made.', isError: true }
  if (signal?.aborted) return { content: 'The Routine MCP call was cancelled before dispatch.', isError: true }

  let exact: McpBoundToolCall
  try {
    const invocation = snapshotMcpToolInvocation({ tool: { name: binding.call.toolName, inputSchema: binding.inputSchema }, arguments: input })
    exact = { ...binding.call, arguments: invocation.arguments as McpBoundToolCall['arguments'] }
  } catch {
    return { content: 'The Routine MCP arguments were invalid or exceeded the bounded input limit. No external call was made.', isError: true }
  }
  if (!Object.keys(binding.fixedArguments).every(key => Object.hasOwn(exact.arguments, key) &&
      sameRoutineMcpJson(binding.fixedArguments[key], exact.arguments[key]))) {
    return { content: 'The Routine MCP arguments did not satisfy the reviewed fixed values. No external call was made.', isError: true }
  }
  const valid = await validateMcpSchema(binding.inputSchema, { value: exact.arguments }, { signal })
  if (!valid.ok) return { content: 'The Routine MCP arguments did not pass the inspected tool schema. No external call was made.', isError: true }
  if (signal?.aborted) return { content: 'The Routine MCP call was cancelled before dispatch.', isError: true }

  // This UUID is host-owned. Provider call IDs are reusable correlation data,
  // never durable execution idempotency keys.
  const key = `routine-mcp-${randomUUID()}`
  const receipt = await runtime.execute(exact, key, signal)
  if (!receipt || !sameRoutineMcpJson(receipt.call, exact)) {
    return { content: 'The Routine MCP executor returned no matching durable receipt. Treat the call outcome as unresolved.', isError: true }
  }
  if (receipt.status === 'pending') {
    return { content: 'The Routine MCP call is still pending. Do not repeat it; its result is unresolved.', isError: true }
  }
  if (receipt.status === 'uncertain') {
    return { content: 'The Routine MCP server may have accepted this call, but no valid result was received. Do not repeat it; its outcome is uncertain.', isError: true }
  }
  if (receipt.status !== 'done' && receipt.status !== 'failed') {
    return { content: 'The Routine MCP executor returned an invalid receipt state. Treat the call outcome as unresolved.', isError: true }
  }
  let result: McpToolResult | undefined
  if (receipt.result !== undefined) {
    try { result = parseMcpToolResult(receipt.result, MCP_MODERN_VERSION) }
    catch {
      return { content: 'The Routine MCP result was invalid or exceeded the result limit. Treat the call outcome as uncertain; do not repeat it.', isError: true }
    }
  }
  if (receipt.status === 'done' && (!result || result.isError)) {
    return { content: 'The Routine MCP executor reported success without a valid successful result. Treat the call outcome as uncertain; do not repeat it.', isError: true }
  }
  if (receipt.status === 'failed' && result && !result.isError) {
    return { content: 'The Routine MCP executor reported failure with a contradictory result. Treat the call outcome as uncertain; do not repeat it.', isError: true }
  }
  return receipt.status === 'done'
    ? { content: `Routine MCP result (untrusted external data): ${JSON.stringify(result)}`, isError: false }
    : { content: `Routine MCP call failed (untrusted external data): ${result ? JSON.stringify(result) : 'No valid result was returned.'}`, isError: true }
}

/** Execute a read / standing-approved action or PROPOSE an interactive action.
 *  Unknown names fall through to the other tool families. Exact action input is
 *  retained for later informed consent and execution. */
export async function runConnectorTool(
  name: string,
  bindings: Map<string, ToolBinding>,
  id: string,
  input: Record<string, unknown>,
  runtime: ConnectorToolRuntime,
  signal?: AbortSignal,
): Promise<ToolActivity | undefined> {
  const b = bindings.get(name)
  if (!b) return undefined
  if (b.routineMcp) return undefined
  if (b.mcp) {
    // Provider call ids correlate wire results, not durable user consent. A
    // provider may reuse one across turns after the earlier call is archived.
    const base: ToolActivity = { id: `mcp-activity-${randomUUID()}`, tool: name, connector: b.connectorLabel, connectorId: b.connectorId,
      kind: 'action', mcp: { ...b.mcp.anchor }, summary: '' }
    let exactInput: Record<string, unknown>
    try { exactInput = snapshotMcpToolInvocation({ tool: { name: b.mcp.anchor.toolName, inputSchema: b.mcp.inputSchema }, arguments: input }).arguments }
    catch { return { ...base, status: 'failed', summary: 'The external tool arguments are invalid. No call was proposed or sent.', failure: { code: 'connector_failed', retryable: false } } }
    const accepted = await validateMcpSchema(b.mcp.inputSchema, { value: exactInput }, { signal })
    if (!accepted.ok) return { ...base, status: 'failed', summary: 'The external tool arguments could not be validated. No call was proposed or sent.', failure: { code: 'connector_failed', retryable: false } }
    return { ...base, input: exactInput, status: 'proposed', summary: `Proposed: ${b.mcp.anchor.toolName} on ${b.connectorLabel} — awaiting owner approval for this call only.` }
  }
  const acceptedInput = acceptConnectorInput(input)
  const base = {
    id,
    tool: name,
    connector: b.connectorLabel,
    connectorId: b.connectorId,
    kind: b.kind,
  }
  if (!acceptedInput.ok) {
    return { ...base, status: 'failed', summary: acceptedInput.result.message, failure: acceptedInput.result.failure }
  }
  const exactInput = acceptedInput.input
  const activityBase = { ...base, ...(Object.keys(exactInput).length > 0 ? { input: exactInput } : {}) }
  if (b.kind === 'action' && !b.standingApproved) {
    return { ...activityBase, status: 'proposed', summary: `Proposed: ${shortToolName(name)} on ${b.connectorLabel} — confirm to run.` }
  }

  const result = await invokeConnectorRuntime(runtime, {
    invocationId: id,
    tool: name,
    connectorId: b.connectorId,
    connector: b.connectorLabel,
    kind: b.kind,
    input: exactInput,
    signal,
    developmentFixtureSummary: b.kind === 'read' ? b.developmentFixtureSummary : undefined,
  })
  return result.ok
    ? { ...activityBase, status: 'done', summary: result.summary }
    : { ...activityBase, status: 'failed', summary: result.message, failure: result.failure }
}
