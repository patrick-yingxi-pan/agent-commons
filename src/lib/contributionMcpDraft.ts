import type { McpJsonValue } from '../../contract/mcpExecution.ts'
import type { McpConnectionView } from '../../contract/mcpConnections.ts'
import { ENVELOPE_HARNESSES, type EnvelopeHarness } from '../../contract/contributions.ts'
import type { ProjectEffectType } from '../../contract/coordination.ts'

/** Explicit-call only describes the separately confirmed MCP execution path. */
export const CONTRIBUTION_LEGACY_ENVELOPE_HARNESSES = ENVELOPE_HARNESSES.filter(
  (harness): harness is Exclude<EnvelopeHarness, 'explicit-call'> => harness !== 'explicit-call',
)

/** Keep the editable draft coherent when its effect type changes. MCP target,
 * binding and arguments are type-specific and are cleared by the component. */
export function transitionContributionEffectDraftType(
  current: { type: ProjectEffectType; target: string; harness: EnvelopeHarness },
  type: ProjectEffectType,
): { type: ProjectEffectType; target: string; harness: EnvelopeHarness } {
  const involvesMcp = current.type === 'mcp.mutate' || type === 'mcp.mutate'
  return {
    type,
    target: involvesMcp ? '' : current.target,
    harness: type === 'mcp.mutate'
      ? 'explicit-call'
      : current.harness === 'explicit-call' ? 'draft-escrow' : current.harness,
  }
}

export const CONTRIBUTION_MCP_ARGUMENTS_MAX_BYTES = 49_152

export type ParsedContributionMcpArguments =
  | { ok: true; value: Record<string, McpJsonValue> }
  | { ok: false; message: string }

/** Parse only a bounded JSON object for a reviewed MCP call. The server still
 * validates it against the selected tool's current admitted schema. */
export function parseContributionMcpArguments(text: string): ParsedContributionMcpArguments {
  if (new TextEncoder().encode(text).byteLength > CONTRIBUTION_MCP_ARGUMENTS_MAX_BYTES) {
    return { ok: false, message: 'Arguments are too large. Keep this JSON under 48 KiB.' }
  }
  let value: unknown
  try { value = JSON.parse(text) }
  catch { return { ok: false, message: 'Enter valid JSON arguments before proposing this call.' } }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, message: 'MCP arguments must be a JSON object, such as {}.' }
  }
  return { ok: true, value: value as Record<string, McpJsonValue> }
}

export function formatContributionMcpArguments(value: Record<string, McpJsonValue>): string {
  return JSON.stringify(value, null, 2)
}

export type ContributionMcpChoice = { connection: McpConnectionView; toolName: string; label: string }

export function contributionMcpChoices(connections: readonly McpConnectionView[]): ContributionMcpChoice[] {
  return connections.flatMap((connection) => {
    if (connection.status !== 'connected' || connection.execution !== 'approval-required') return []
    const executable = new Set(connection.executableTools ?? [])
    return connection.tools
      .filter((tool) => executable.has(tool.name))
      .map((tool) => ({ connection, toolName: tool.name, label: `${connection.label} · ${tool.title || tool.name}` }))
  })
}

export const contributionMcpChoiceKey = (connectionId: string, toolName: string): string =>
  `${connectionId}\0${toolName}`
