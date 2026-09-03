import type { CreateDelegationRequest } from '../../contract/index.ts'

/** One submitted Delegation form owns one immutable authority request. */
export interface DelegationCreationIntent {
  readonly tenantId: string
  readonly intentId: string
  readonly projectId: string
  readonly request: CreateDelegationRequest
}

export const delegationCreationResourceId = (intent: DelegationCreationIntent): string =>
  `delegation-create:${intent.projectId}:${intent.intentId}`
