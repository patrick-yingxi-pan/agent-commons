/** Pure projection for linking a Contribution's exact successful MCP mutation
 * to one open Project work item. This is not authorization: callers must still
 * perform all current identity, role, ownership and revision checks. */
import type { EffectEnvelope } from '../contract/contributions.ts'
import type { OpenSubGoal } from '../contract/directory.ts'
import { MCP_MODERN_VERSION } from './mcpProtocol.ts'
import { parseMcpToolResult } from './mcpToolResult.ts'
import type { StoredContributionEffectAttempt } from './contributionEffectState.ts'

export type ProjectWorkResolution =
  | { status: 'ready'; effectId: string }
  | { status: 'needs-result' | 'uncertain' | 'closed' }

export interface ProjectWorkResolutionContribution {
  id: string
  projectId: string
  workItemId?: string
  envelope?: EffectEnvelope
  effectAttempts?: readonly StoredContributionEffectAttempt[]
}

type ProjectWorkResolutionItem = Pick<OpenSubGoal, 'id' | 'projectId' | 'type' | 'target' | 'status'>

function uncertainAttempt(attempt: StoredContributionEffectAttempt): boolean {
  if (attempt.status === 'pending' || attempt.status === 'uncertain') return true
  if (attempt.status !== 'failed' || attempt.result === undefined) return false
  try { return parseMcpToolResult(attempt.result, MCP_MODERN_VERSION).isError }
  catch { return true }
}

function validSuccessfulResult(attempt: StoredContributionEffectAttempt): boolean {
  if (attempt.status !== 'done' || !attempt.result) return false
  try { return !parseMcpToolResult(attempt.result, MCP_MODERN_VERSION).isError }
  catch { return false }
}

/**
 * Derive whether a linked Contribution can resolve this exact work item.
 * Pending, uncertain, or returned-error receipts are conservative even when
 * another attempt succeeded; known pre-submit failures remain retryable.
 */
export function computeProjectWorkResolution(
  item: ProjectWorkResolutionItem | undefined,
  contribution: ProjectWorkResolutionContribution | undefined,
): ProjectWorkResolution {
  if (!item || item.status !== 'open' || item.type !== 'mcp.mutate') return { status: 'closed' }
  if (!contribution || contribution.projectId !== item.projectId || contribution.workItemId !== item.id) {
    return { status: 'needs-result' }
  }

  const attempts = contribution.effectAttempts ?? []
  if (attempts.some(uncertainAttempt)) return { status: 'uncertain' }

  const envelope = contribution.envelope
  if (!envelope || envelope.status !== 'approved' || envelope.approvedVersion !== envelope.version) {
    return { status: 'needs-result' }
  }

  for (const attempt of attempts) {
    if (!validSuccessfulResult(attempt) || attempt.projectId !== item.projectId ||
        attempt.contributionId !== contribution.id || attempt.envelopeVersion !== envelope.version) continue
    const line = envelope.lines.find((candidate) => candidate.id === attempt.lineId)
    if (line?.type === 'mcp.mutate' && line.target === item.target) return { status: 'ready', effectId: attempt.id }
  }
  return { status: 'needs-result' }
}
