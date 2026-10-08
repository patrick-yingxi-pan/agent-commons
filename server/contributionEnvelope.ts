/** Strict, bounded normalization and side-effect-free preparation for
 * Contribution effect envelopes. Credentials and outbound execution remain
 * exclusively in the durable execution workflow. */
import type {
  ContributionMcpPreview,
  ContributionMcpSelection,
  EffectEnvelopeLine,
  EnvelopeHarness,
  ProposeEnvelopeRequest,
} from '../contract/contributions.ts'
import { EFFECT_ENVELOPE_CARDINALITY_MAX, EFFECT_ENVELOPE_LINE_MAX, CONTRIBUTION_FIELD_MAX } from '../contract/contributions.ts'
import { PROJECT_EFFECT_TYPES, type ProjectEffectType } from '../contract/coordination.ts'
import { isExternalMcpId, type McpDiscoveredTool } from '../contract/mcpConnections.ts'
import type { McpBoundToolCall, McpJsonValue } from '../contract/mcpExecution.ts'
import { MCP_SCHEMA_ADMISSION_VERSION, admitMcpTool, mcpToolSchemaHash } from './mcpToolAdmission.ts'
import { validateMcpSchema } from './mcpSchema.ts'
import { snapshotMcpJson } from './mcpJson.ts'
import { snapshotMcpBoundToolCall } from './mcpBoundCall.ts'
import type { McpBoundExecutionStore } from './mcpBoundExecution.ts'
import type { PrivateMcpConnection } from './mcpConnections.ts'

export interface NormalizedEnvelopeProposalLine {
  type: ProjectEffectType
  target: string
  cardinality: number
  harness: EnvelopeHarness
  note: string
  mcp?: ContributionMcpSelection
}

export interface StoredContributionEnvelopeLine extends EffectEnvelopeLine {
  /** Server-private authority; must be stripped from every wire projection. */
  mcpAuthority?: { tenantId: string; call: McpBoundToolCall }
}

export type StoredContributionEnvelope = Omit<import('../contract/contributions.ts').EffectEnvelope, 'lines'> & {
  lines: StoredContributionEnvelopeLine[]
}

const SELECTION_FIELDS = ['connectionId', 'connectionRevision', 'toolName', 'arguments'] as const
const TOOL_NAME_CONTROL = /^[\u0000-\u001f\u007f-\u009f\ud800-\udfff]$/

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function toolName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && Array.from(value).length <= 128 &&
    !Array.from(value).some((char) => TOOL_NAME_CONTROL.test(char))
}

function snapshotSelection(value: unknown): ContributionMcpSelection | undefined {
  try {
    const envelope = snapshotMcpJson(value, { maxBytes: 65_536, maxDepth: 33, maxNodes: 8_192 })
    if (!object(envelope) || Object.keys(envelope).length !== SELECTION_FIELDS.length ||
        Object.keys(envelope).some((key) => !(SELECTION_FIELDS as readonly string[]).includes(key)) ||
        typeof envelope.connectionId !== 'string' || !isExternalMcpId(envelope.connectionId) ||
        !Number.isSafeInteger(envelope.connectionRevision) || Number(envelope.connectionRevision) < 0 ||
        !toolName(envelope.toolName) || !object(envelope.arguments)) return undefined
    const args = snapshotMcpJson(envelope.arguments, { maxBytes: 49_152, maxDepth: 32, maxNodes: 4_096 })
    if (!object(args)) return undefined
    return {
      connectionId: envelope.connectionId,
      connectionRevision: envelope.connectionRevision as number,
      toolName: envelope.toolName,
      arguments: args as Record<string, McpJsonValue>,
    }
  } catch { return undefined }
}

function canonical(value: McpJsonValue): McpJsonValue {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
  }
  return value
}

function sameArguments(left: Record<string, McpJsonValue>, right: Record<string, McpJsonValue>): boolean {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
}

/** Canonicalizes the same legacy defaults/trimming as the store used to own,
 * while strictifying only the new optional MCP selection. No live lookup is
 * performed, so keyed retries compare the user's original exact intent. */
export function normalizedEnvelopeProposalLines(
  req: ProposeEnvelopeRequest,
): NormalizedEnvelopeProposalLine[] | undefined {
  try {
    const lines = req.lines
    if (!Array.isArray(lines) || lines.length === 0 || lines.length > EFFECT_ENVELOPE_LINE_MAX) return undefined
    const normalized: NormalizedEnvelopeProposalLine[] = []
    const seen = new Set<string>()
    for (const line of lines) {
      if (!object(line)) return undefined
      const cardinality = line.cardinality ?? 1
      const harness = line.harness ?? 'draft-escrow'
      if (!PROJECT_EFFECT_TYPES.includes(line.type as ProjectEffectType) ||
          typeof line.target !== 'string' || !line.target.trim() ||
          !Number.isInteger(cardinality) || cardinality < 1 || cardinality > EFFECT_ENVELOPE_CARDINALITY_MAX ||
          typeof harness !== 'string' || !['dry-run', 'draft-escrow', 'canary', 'cooling-window', 'hold-until-landing', 'explicit-call'].includes(harness) ||
          (line.note !== undefined && typeof line.note !== 'string')) return undefined

      const hasMcp = Object.hasOwn(line, 'mcp')
      const mcp = hasMcp ? snapshotSelection(line.mcp) : undefined
      if ((hasMcp && !mcp) || (harness === 'explicit-call') !== Boolean(mcp)) return undefined
      if (mcp && (line.type !== 'mcp.mutate' || line.target !== mcp.toolName)) return undefined
      if (mcp && line.type !== 'mcp.mutate') return undefined

      const next: NormalizedEnvelopeProposalLine = {
        type: line.type as ProjectEffectType,
        target: line.target.trim().slice(0, CONTRIBUTION_FIELD_MAX),
        cardinality,
        harness: harness as EnvelopeHarness,
        note: (line.note ?? '').trim().slice(0, CONTRIBUTION_FIELD_MAX),
        ...(mcp ? { mcp } : {}),
      }
      if (mcp && next.target !== mcp.toolName) return undefined
      const key = JSON.stringify([next.type, next.target, next.harness, next.note,
        next.mcp ? [next.mcp.connectionId, next.mcp.connectionRevision, next.mcp.toolName, canonical(next.mcp.arguments)] : null])
      if (seen.has(key)) return undefined
      seen.add(key)
      normalized.push(next)
    }
    return normalized
  } catch { return undefined }
}

export function envelopeProposalLinesMatch(
  left: NormalizedEnvelopeProposalLine[],
  right: NormalizedEnvelopeProposalLine[],
): boolean {
  if (left.length !== right.length) return false
  return left.every((line, index) => {
    const candidate = right[index]
    return candidate !== undefined && line.type === candidate.type && line.target === candidate.target &&
      line.cardinality === candidate.cardinality && line.harness === candidate.harness && line.note === candidate.note &&
      (line.mcp === undefined ? candidate.mcp === undefined : candidate.mcp !== undefined &&
        line.mcp.connectionId === candidate.mcp.connectionId &&
        line.mcp.connectionRevision === candidate.mcp.connectionRevision && line.mcp.toolName === candidate.mcp.toolName &&
        sameArguments(line.mcp.arguments, candidate.mcp.arguments))
  })
}

interface SelectedBinding {
  row: PrivateMcpConnection
  label: string
  tool: McpDiscoveredTool
  schemaHash: string
}

function selectedBinding(store: McpBoundExecutionStore, tenantId: string, selection: ContributionMcpSelection): SelectedBinding | undefined {
  try {
    const row = store.privateMcpConnection(selection.connectionId, tenantId)
    const view = store.mcpConnection(selection.connectionId, tenantId)
    if (!row || row.id !== selection.connectionId || row.tenantId !== tenantId || !row.connected ||
        row.revision !== selection.connectionRevision || !row.inspection ||
        row.inspection.schemaAdmission?.version !== MCP_SCHEMA_ADMISSION_VERSION ||
        !view || view.id !== selection.connectionId || view.revision !== selection.connectionRevision ||
        view.execution !== 'approval-required' || !view.executableTools?.includes(selection.toolName)) return undefined
    const selected = row.inspection.tools.find((tool) => tool.name === selection.toolName)
    if (!selected) return undefined
    const tool = snapshotMcpJson(selected, { maxBytes: 196_608, maxDepth: 36, maxNodes: 12_288 }) as unknown as McpDiscoveredTool
    const schemaHash = mcpToolSchemaHash(tool)
    if (!row.inspection.schemaAdmission.hashes.includes(schemaHash)) return undefined
    return { row, label: view.label, tool, schemaHash }
  } catch { return undefined }
}

/** Resolve and worker-validate each explicit call without credential access or
 * network I/O. Any unavailable/invalid selection refuses the whole proposal. */
export async function prepareContributionMcpLines(
  store: McpBoundExecutionStore,
  tenantId: string,
  lines: NormalizedEnvelopeProposalLine[],
): Promise<Array<Omit<StoredContributionEnvelopeLine, 'id' | 'used'>> | undefined> {
  const safeLines = normalizedEnvelopeProposalLines({ lines })
  if (!safeLines) return undefined
  const prepared: Array<Omit<StoredContributionEnvelopeLine, 'id' | 'used'>> = []
  for (const line of safeLines) {
    if (!line.mcp) {
      prepared.push({ type: line.type, target: line.target, cardinality: line.cardinality, harness: line.harness, note: line.note })
      continue
    }
    const selected = selectedBinding(store, tenantId, line.mcp)
    if (!selected) return undefined
    const admitted = await admitMcpTool(selected.tool)
    if (!admitted.ok) return undefined
    const input = await validateMcpSchema(selected.tool.inputSchema, { value: line.mcp.arguments })
    if (!input.ok) return undefined
    const call: McpBoundToolCall = {
      connectionId: line.mcp.connectionId,
      connectionRevision: line.mcp.connectionRevision,
      toolName: line.mcp.toolName,
      schemaHash: selected.schemaHash,
      arguments: line.mcp.arguments,
    }
    const provisional: StoredContributionEnvelopeLine = {
      type: line.type,
      target: line.target,
      cardinality: line.cardinality,
      harness: line.harness,
      note: line.note,
      used: 0,
      mcp: { connectionLabel: selected.label, toolName: line.mcp.toolName, arguments: line.mcp.arguments } satisfies ContributionMcpPreview,
      mcpAuthority: { tenantId, call },
      id: 'preparation-only',
    }
    if (!currentContributionMcpLine(store, tenantId, provisional)) return undefined
    const { id: _id, used: _used, ...result } = provisional
    prepared.push(result)
  }
  return prepared
}

/** Recheck the persisted private binding against current owner/readiness facts.
 * Legacy non-MCP lines remain valid without gaining any MCP authority. */
export function currentContributionMcpLine(
  store: McpBoundExecutionStore,
  tenantId: string,
  line: StoredContributionEnvelopeLine,
): boolean {
  if (!line.mcpAuthority) return line.mcp === undefined && line.harness !== 'explicit-call'
  if (!line.mcp || line.type !== 'mcp.mutate' || line.harness !== 'explicit-call' ||
      line.target !== line.mcp.toolName || line.mcpAuthority.tenantId !== tenantId) return false
  const call = snapshotMcpBoundToolCall(line.mcpAuthority.call)
  const preview = snapshotSelection({ connectionId: call?.connectionId, connectionRevision: call?.connectionRevision,
    toolName: line.mcp.toolName, arguments: line.mcp.arguments })
  if (!call || !preview || line.mcp.toolName !== call.toolName || !sameArguments(preview.arguments, call.arguments)) return false
  const binding = selectedBinding(store, tenantId, {
    connectionId: call.connectionId,
    connectionRevision: call.connectionRevision,
    toolName: call.toolName,
    arguments: call.arguments,
  })
  return Boolean(binding && binding.schemaHash === call.schemaHash &&
    binding.label === line.mcp.connectionLabel)
}
