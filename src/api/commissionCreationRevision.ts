import type { CreateCommissionRequest } from '../../contract/index.ts'

/** One Contributor-picker choice owns one immutable assignment and retry key. */
export interface CommissionCreationIntent {
  readonly tenantId: string
  readonly intentId: string
  readonly request: CreateCommissionRequest
}

export const commissionCreationResourceId = (intent: CommissionCreationIntent): string =>
  `commission-create:${intent.request.projectId}:${intent.intentId}`
