import type { CommissionMcpApprovalIntent } from '../../contract/commissionMcp.ts'
import { COMMISSION_MCP_MAX_LIFETIME_MS, COMMISSION_MCP_MAX_TOOLS, COMMISSION_MCP_MAX_WORK_ITEMS } from '../../contract/commissionMcp.ts'
import type { CommissionMcpClaimView, CommissionMcpReview } from '../../contract/commissionMcpApi.ts'
import type { McpJsonValue } from '../../contract/mcpExecution.ts'

export type CommissionToolChoice = CommissionMcpReview['tools'][number]
export type CommissionToolDraft = { selected: boolean; fixedText: string }
export const commissionToolKey = (tool: CommissionToolChoice) => JSON.stringify([tool.connectionId, tool.tool.name, tool.schemaHash])
export const commissionToolLabelKey = (connectionId: string, name: string) => JSON.stringify([connectionId, name])

/** Pure form validation. The server repeats strict JSON/schema and authority
 * checks; this never turns a cached review into execution authority. */
export function commissionApprovalFromDraft(review: CommissionMcpReview, drafts: Record<string, CommissionToolDraft>, count: string, expiry: string, now = Date.now()): CommissionMcpApprovalIntent {
  if (!review.execution || review.blockedReason || !review.disclosures.length) throw new Error('Choose an available endpoint and model, then refresh the current review.')
  const selected = review.tools.filter(tool => drafts[commissionToolKey(tool)]?.selected)
  if (!selected.length || selected.length > COMMISSION_MCP_MAX_TOOLS) throw new Error(`Choose 1 to ${COMMISSION_MCP_MAX_TOOLS} exact tools.`)
  const maxWorkItems = Number(count)
  if (!Number.isInteger(maxWorkItems) || maxWorkItems < 1 || maxWorkItems > COMMISSION_MCP_MAX_WORK_ITEMS) throw new Error(`Choose 1 to ${COMMISSION_MCP_MAX_WORK_ITEMS} work items.`)
  const expiresAt = new Date(expiry).getTime()
  if (!Number.isFinite(expiresAt) || expiresAt <= now || expiresAt > now + COMMISSION_MCP_MAX_LIFETIME_MS) throw new Error('Choose an expiry within the next 30 days.')
  const tools = selected.map(choice => {
    let fixedArguments: Record<string, McpJsonValue>
    try {
      const parsed: unknown = JSON.parse(drafts[commissionToolKey(choice)]!.fixedText || '{}', (_key, value: unknown) => {
        if (typeof value === 'number' && !Number.isFinite(value)) throw new Error()
        return value
      })
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error()
      fixedArguments = parsed as Record<string, McpJsonValue>
    } catch { throw new Error(`${choice.tool.name}: fixed values must be a JSON object.`) }
    const properties = choice.tool.inputSchema.properties
    if (properties && typeof properties === 'object' && !Array.isArray(properties) && Object.keys(fixedArguments).some(key => !Object.hasOwn(properties, key))) throw new Error(`${choice.tool.name}: a fixed value does not match a top-level schema field.`)
    return { connectionId: choice.connectionId, connectionRevision: choice.connectionRevision, toolName: choice.tool.name, schemaHash: choice.schemaHash, fixedArguments }
  })
  return structuredClone({ expectedRevision: review.policy.revision, expectedConfigurationRevision: review.configurationRevision,
    reviewHash: review.reviewHash, execution: review.execution, expiresAt, maxWorkItems, tools })
}

export function commissionApprovalMatchesReview(approval: CommissionMcpApprovalIntent, review: CommissionMcpReview, now = Date.now()): boolean {
  return !review.blockedReason && approval.expiresAt > now && approval.expectedRevision === review.policy.revision &&
    approval.expectedConfigurationRevision === review.configurationRevision && approval.reviewHash === review.reviewHash &&
    approval.execution.agentId === review.execution?.agentId && approval.execution.providerId === review.execution?.providerId &&
    approval.execution.modelId === review.execution?.modelId && approval.tools.every(tool => review.tools.some(choice =>
      choice.connectionId === tool.connectionId && choice.connectionRevision === tool.connectionRevision && choice.tool.name === tool.toolName && choice.schemaHash === tool.schemaHash))
}

export function commissionClaimLabel(claim: CommissionMcpClaimView): string {
  if (claim.status === 'uncertain') return 'Outcome uncertain'
  if (claim.phase === 'preparing') return 'Preparing arguments'
  if (claim.phase === 'closed') return 'Preparation stopped'
  return claim.status === 'pending' ? 'External call in progress' : claim.status === 'done' ? 'Call succeeded' : 'Call failed'
}
