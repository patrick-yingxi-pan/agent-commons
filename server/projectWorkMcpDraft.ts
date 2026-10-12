/** Pure preparation for private model computation over one inspected tool.
 * No connection identity, credential or invocation authority is persisted in
 * the draft preview or supplied as a callable model tool. */
import { createHash } from 'node:crypto'
import type { OpenSubGoal } from '../contract/index.ts'
import type { McpDiscoveredTool } from '../contract/mcpConnections.ts'
import { projectWorkMcpDraftBindingText, type ProjectWorkMcpDraftPreview,
  type ProjectWorkMcpDraftSelection } from '../contract/projectWorkMcpDraft.ts'
import type { McpBoundExecutionStore } from './mcpBoundExecution.ts'
import { resolveContributionMcpBinding } from './contributionEnvelope.ts'
import { ValidationError } from './conflict.ts'

export interface PreparedProjectWorkMcpDraft {
  preview: ProjectWorkMcpDraftPreview
  tool: McpDiscoveredTool
}

export function prepareProjectWorkMcpDraft(
  store: McpBoundExecutionStore,
  tenantId: string,
  userId: string | undefined,
  selection: ProjectWorkMcpDraftSelection,
  item: OpenSubGoal,
): PreparedProjectWorkMcpDraft {
  if (!userId || !userId.trim() || userId.length > 200 || !/^[\x20-\x7e]+$/.test(userId) ||
      item.status !== 'open' || item.type !== 'mcp.mutate' || item.target !== selection.toolName) {
    throw new ValidationError('MCP argument drafting requires your exact inspected tool and an open matching MCP work item.')
  }
  const selected = resolveContributionMcpBinding(store, tenantId, selection, userId)
  if (!selected) throw new ValidationError('The selected MCP tool is no longer available to you. Refresh its connection before drafting.')
  return {
    tool: selected.tool,
    preview: { connectionLabel: selected.label, toolName: selected.tool.name,
      bindingHash: createHash('sha256').update(projectWorkMcpDraftBindingText(tenantId, userId, selection, selected.tool)).digest('hex'),
      ...(selected.transport ? { transport: selected.transport } : {}) },
  }
}
