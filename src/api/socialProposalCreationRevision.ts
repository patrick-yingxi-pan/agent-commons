import type { OpenProposalRequest, SocialEntityRef } from '../../contract/index.ts'

/** One submitted offer form owns one immutable typed change and rationale. */
export interface SocialProposalCreationIntent {
  readonly tenantId: string
  readonly intentId: string
  readonly request: OpenProposalRequest
}

export const socialProposalCreationAnchorId = (subject: SocialEntityRef): string =>
  `social-proposal-create:${subject.kind}:${subject.id}`

export const socialProposalCreationResourceId = (intent: SocialProposalCreationIntent): string =>
  `${socialProposalCreationAnchorId(intent.request.subject)}:${intent.intentId}`
