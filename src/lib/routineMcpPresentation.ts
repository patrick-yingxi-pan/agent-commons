import type { ScheduledRun } from '../../contract/cowork.ts'
import type { RoutineMcpApprovalIntent } from '../../contract/routineMcp.ts'

/** Strip owner-only review presentation snapshots before constructing the wire body. */
export function routineMcpApprovalIntent(
  review: RoutineMcpApprovalIntent & { disclosures: string[]; labels: Record<string, string> },
): RoutineMcpApprovalIntent {
  return {
    expectedRevision: review.expectedRevision,
    expectedDefinitionRevision: review.expectedDefinitionRevision,
    reviewHash: review.reviewHash,
    expiresAt: review.expiresAt,
    maxCallsPerRun: review.maxCallsPerRun,
    tools: review.tools,
  }
}

/** The receipt phase describes ledger recovery, not the owning RoutineRun. */
export function routineMcpRunLabel(status: ScheduledRun['status']): string {
  return status === 'running' ? 'Run in progress' : status === 'ok' ? 'Run completed' : status === 'skipped' ? 'Run skipped' : 'Run failed'
}
