import type { CommissionMcpDecisionRequest } from '../../contract/commissionMcpApi.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'
import type { RevisionedMutationOutcome, RevisionedMutationStatus } from './revisionedMutationCore.ts'

/** Private UI context retained with a pending decision after its pane unmounts. */
export interface CommissionMcpHeldPresentation {
  disclosures: string[]
  modelLabel: string
  labels: Record<string, string>
}

export interface CommissionMcpMutationIntent {
  commissionId: string
  tenantId: string
  userId: string
  accountGeneration: number
  request: CommissionMcpDecisionRequest
  presentation?: CommissionMcpHeldPresentation
  sourceUserId: string | null
}

export interface HeldCommissionMcpMutation {
  intent: CommissionMcpMutationIntent
  result: Promise<RevisionedMutationOutcome>
  settle: (value: RevisionedMutationOutcome) => void
  generation: number
  loading: boolean
}

/** The one authoritative held-intent registry and status spine. This module is
 * safe for the eagerly loaded Contributor roster; it contains no send runtime. */
export const heldCommissionMcpMutations = new Map<string, HeldCommissionMcpMutation>()
export const commissionMcpMutationStatus = createMutationStatusStore()

export const isCommissionMcpHeld = (id: string): boolean => heldCommissionMcpMutations.has(id)
export const useCommissionMcpMutationStatus = (): RevisionedMutationStatus => commissionMcpMutationStatus.useStatus()
