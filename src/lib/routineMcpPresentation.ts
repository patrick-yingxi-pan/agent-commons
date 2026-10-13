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
    ...(review.localPrograms === true ? { localPrograms: true } : {}),
  }
}

/** Read labels distinguish connection provenance without inferring it from names. */
export function routineMcpTransportLabel(transport?: 'stdio'): string {
  return transport === 'stdio' ? 'Local program' : 'External server'
}

const ROUTINE_RUN_LABELS: Record<ScheduledRun['status'], string> = {
  running: 'Run in progress',
  ok: 'Run completed',
  skipped: 'Run skipped',
  failed: 'Run failed',
  cancelled: 'Run stopped',
}

/** The receipt phase describes ledger recovery, not the owning RoutineRun.
 * An exhaustive map prevents newly added outcomes from inheriting failure. */
export function routineMcpRunLabel(status: ScheduledRun['status']): string {
  return ROUTINE_RUN_LABELS[status]
}
