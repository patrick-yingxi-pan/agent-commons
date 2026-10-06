import type { ContributionReviewerBinding } from './contributionReview.ts'
import type { DelegatedActKind } from './delegations.ts'

/** Explicit owner-funded judgment over exact currently displayed authority.
 * Null means no changeset/envelope, never “use whichever exists at dispatch”. */
export interface DelegatedJudgmentRequest {
  expectedDelegationRevision: number
  expectedChangesetVersion: number | null
  expectedEnvelopeVersion: number | null
  reviewer: ContributionReviewerBinding
}

export type DelegatedJudgmentDecision = 'approve' | 'decline' | 'escalate'
export type DelegatedJudgmentStatus = 'pending' | 'draft' | 'decided' | 'declined' | 'escalated' | 'failed' | 'uncertain' | 'stale'

/** Durable attempt history. Retry reads the same attempt, including uncertainty;
 * only a fresh explicit owner action can begin another provider request. */
export interface DelegatedJudgmentRun {
  id: string
  delegationId: string
  delegationRevision: number
  actKind: DelegatedActKind
  mode: 'draft' | 'decide'
  changesetVersion: number | null
  envelopeVersion: number | null
  reviewer: string
  provider: string
  model: string
  startedAt: number
  finishedAt?: number
  status: DelegatedJudgmentStatus
  decision?: DelegatedJudgmentDecision
  /** Initiating owner only: model prose may quote the private written policy. */
  summary?: string
}

export const MAX_DELEGATED_JUDGMENTS = 50
export const MAX_JUDGMENT_SUMMARY_CHARS = 2000
