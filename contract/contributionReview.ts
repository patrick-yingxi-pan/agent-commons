/** Explicit owner-selected, version-pinned, tool-free contribution review. */
export interface ContributionReviewerBinding {
  agentId: string
  agentRevision: number
  providerId: string
  providerRevision: number
  connectionRevision: number
}

export interface ContributionReviewFinding {
  entryId: string
  body: string
}

export interface ContributionReviewResult {
  summary: string
  findings: ContributionReviewFinding[]
}

export type ContributionReviewStatus = 'pending' | 'passed' | 'findings' | 'failed' | 'uncertain' | 'stale'

/** Public history contains display attribution, never private provider configuration. */
export interface ContributionReviewRun {
  id: string
  version: number
  reviewer: string
  provider: string
  model: string
  startedAt: number
  finishedAt?: number
  status: ContributionReviewStatus
  summary?: string
  findings?: ContributionReviewFinding[]
}

export const MAX_CONTRIBUTION_REVIEWS = 50
export const MAX_REVIEW_SUMMARY_CHARS = 2000
export const MAX_REVIEW_FINDINGS = 12
export const MAX_REVIEW_FINDING_CHARS = 2000
