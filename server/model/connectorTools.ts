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
import { connectorDetail, type ConnectorDetail } from '../data/connectorDetails.ts'
import { acceptConnectorInput, invokeConnectorRuntime, type ConnectorToolRuntime } from '../connectorRuntime.ts'

/** The Anthropic tool-definition slice we declare per connector/MCP tool. */
export interface ConnectorToolDef {
  name: string
  description: string
  input_schema: { type: 'object'; properties: Record<string, never>; required: string[] }
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
}

/** What `deriveConnectorTools` returns: the definitions to declare + the bindings the
 *  executor dispatches through (keyed by tool name). */
export interface DerivedConnectorTools {
  definitions: ConnectorToolDef[]
  bindings: Map<string, ToolBinding>
}

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
  options: { standingApprovedContextIds?: ReadonlySet<string> } = {},
): DerivedConnectorTools {
  const definitions: ConnectorToolDef[] = []
  const bindings = new Map<string, ToolBinding>()
  const emptySchema = { type: 'object' as const, properties: {} as Record<string, never>, required: [] as string[] }

  for (const ctx of contexts) {
    if (!isConnectorContext(ctx)) continue
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
  return { definitions, bindings }
}

/** The bare tool name for display / prose — drop the `mcp__slug__` / `connector__slug__`
 *  wire prefix that carries the connector routing. */
export function shortToolName(tool: string): string {
  const parts = tool.split('__')
  return parts.length >= 3 ? parts.slice(2).join('__') : tool
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
