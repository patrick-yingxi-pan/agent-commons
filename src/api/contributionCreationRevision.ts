import type { OpenContributionRequest } from '../../contract/index.ts'

/** One submitted Contribution form owns one immutable work declaration. */
export interface ContributionCreationIntent {
  readonly tenantId: string
  readonly intentId: string
  readonly projectId: string
  readonly request: OpenContributionRequest
}

export const contributionCreationResourceId = (intent: ContributionCreationIntent): string =>
  `contribution-create:${intent.projectId}:${intent.intentId}`
