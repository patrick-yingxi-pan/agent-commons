import type { McpInputCommand } from '../contract/mcpInput.ts'
import { snapshotMcpJson } from './mcpJson.ts'
import { isToolActivityDecisionId } from './toolActivityDecisionIdentity.ts'

/** Validate the envelope before joining its private pending schema. Answers are
 * detached and bounded here, then validated against that exact round in store. */
export function parseMcpInputCommand(value: unknown): McpInputCommand | null {
  try {
    const row = snapshotMcpJson(value, { maxBytes: 65_536, maxDepth: 16, maxNodes: 8192 })
    if (!row || typeof row !== 'object' || Array.isArray(row)) return null
    const keys = ['decisionId', 'round', 'responseId', 'action', ...(row.action === 'respond' ? ['responses'] : [])]
    if (Object.keys(row).length !== keys.length || Object.keys(row).some(key => !keys.includes(key)) ||
        typeof row.decisionId !== 'string' || !isToolActivityDecisionId(row.decisionId) ||
        typeof row.round !== 'number' || !Number.isSafeInteger(row.round) || row.round < 1 || row.round > 4 ||
        typeof row.responseId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(row.responseId) ||
        (row.action !== 'respond' && row.action !== 'stop')) return null
    if (row.action === 'respond' && (!row.responses || typeof row.responses !== 'object' || Array.isArray(row.responses))) return null
    return row as unknown as McpInputCommand
  } catch { return null }
}
