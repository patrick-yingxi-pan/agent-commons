import type { PatchDelegationRequest } from '../../contract/index.ts'

/** One owner-reviewed Delegation policy version and its exact recovery identity. */
export interface DelegationPolicyIntent {
  readonly tenantId: string
  readonly projectId: string
  readonly delegationId: string
  readonly intentId: string
  readonly request: PatchDelegationRequest
}

export const delegationPolicyResourceId = (intent: DelegationPolicyIntent): string =>
  `delegation-policy:${intent.projectId}:${intent.delegationId}`
