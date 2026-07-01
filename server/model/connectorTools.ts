/** ── Connector / MCP tool exposure (P6 §2.2, PD57/PD58) ─────────────────────
 *  Turns a session's attached connector / MCP contexts into tools the model can
 *  call. This is the load-bearing P6 claim made real: today the Messages request's
 *  tool list is only the worker Agent's static allowlist (server/generate.ts); a
 *  connector/MCP attached to the *session* contributed nothing callable. Here we
 *  derive per-context tool definitions from the (fixture) connector detail, declare
 *  them in the request, and — when the model calls one — execute it into a
 *  `ToolActivity` (a mock result fed back to the model + shown under the message).
 *
 *  Framework-free and Node-importable (no React, no server singletons) so it unit-
 *  tests in isolation. The *shape* of the boundary is real (derive → declare →
 *  execute → feed back); only the fulfilment is mock (no real OAuth / MCP transport
 *  yet — that's a later P6 slice). Authority is structural: only an *attached*
 *  connector/MCP context yields tools, so the model can't reach one you didn't add. */
import type { Connector, ToolActivity } from '../../contract/entities.ts'
import type { SessionContext } from '../../contract/contexts.ts'
import { connectorDetail, type ConnectorDetail } from '../data/connectorDetails.ts'

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
  summary: string
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
 *  action; everything else ⇒ read). Both are mocked in this slice; the distinction
 *  drives the card's wording and the future consent gate for real writes. */
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
export function deriveConnectorTools(contexts: SessionContext[]): DerivedConnectorTools {
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
          summary: mcpResult(toolName, ctx.label),
        })
      }
    } else {
      const name = `connector__${s}__list`
      if (bindings.has(name)) continue
      definitions.push({ name, description: `List available resources from the ${ctx.label} connector.`, input_schema: emptySchema })
      bindings.set(name, { connectorId: ctx.id, connectorLabel: ctx.label, kind: 'read', summary: connectorResult(detail) })
    }
  }
  return { definitions, bindings }
}

/** Execute a connector tool call into a `ToolActivity`, or `undefined` when `name`
 *  isn't a derived connector tool (so the caller falls back to the built-in tools).
 *  The fulfilment is the mock result computed at derivation — no real side effect. */
export function runConnectorTool(name: string, bindings: Map<string, ToolBinding>): ToolActivity | undefined {
  const b = bindings.get(name)
  if (!b) return undefined
  return { tool: name, connector: b.connectorLabel, connectorId: b.connectorId, kind: b.kind, summary: b.summary }
}
