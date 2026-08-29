/** App wiring for proposal land/decline acknowledgement and recovery. */
import { useSyncExternalStore } from 'react'
import type { SocialEntityRef, SocialProposal } from '../../contract/index.ts'
import {
  AccountSwitchedError,
  ApiRequestError,
  declineSocialProposal,
  landSocialProposal,
  onAccountSwitch,
  reconcileSocialProposals,
} from '../api'
import type { RevisionedMutationFailure, RevisionedMutationOutcome } from './revisionedMutationCore'
import {
  createProposalVerdictMutationController,
  IDLE_PROPOSAL_VERDICT_MUTATION,
  type ProposalVerdict,
  type ProposalVerdictIntent,
  type ProposalVerdictMutationStatus,
} from './proposalVerdictMutationsCore'

function describeFailure(
  error: unknown,
  intent: ProposalVerdictIntent,
  reconciled: SocialProposal | undefined,
): RevisionedMutationFailure {
  if (reconciled?.state === 'landed') {
    return { message: 'This proposal was already landed elsewhere. Dismiss this pending verdict to continue.', retryable: false }
  }
  if (reconciled?.state === 'declined') {
    return { message: 'This proposal was already declined elsewhere. Dismiss this pending verdict to continue.', retryable: false }
  }
  if (intent.verdict === 'land' && reconciled?.stale) {
    return {
      message: 'This proposal is outdated because its target changed during review. Dismiss it, review the current version, and ask for a new proposal.',
      retryable: false,
    }
  }
  if (error instanceof AccountSwitchedError) {
    return { message: 'That proposal verdict belonged to the previous account. Dismiss it to continue.', retryable: false }
  }
  if (error instanceof ApiRequestError) {
    if (error.status === 409) {
      return { message: 'That proposal can no longer accept this verdict. Dismiss it and review the current ledger.', retryable: false }
    }
    if (error.status === 400 || error.status === 404) {
      return { message: 'That proposal is no longer available. Dismiss the verdict to continue.', retryable: false }
    }
    if (error.status === 401 || error.status === 403) {
      return { message: 'You no longer have permission to decide that proposal. Dismiss the verdict to continue.', retryable: false }
    }
    if (error.status === 429) {
      return { message: 'Too many proposal decisions at once. Retry in a moment.', retryable: true }
    }
  }
  return {
    message: 'Couldn’t confirm the proposal verdict. Your decision is still here—retry when the connection recovers.',
    retryable: true,
  }
}

let status: ProposalVerdictMutationStatus = IDLE_PROPOSAL_VERDICT_MUTATION
const listeners = new Set<() => void>()
const publish = (next: ProposalVerdictMutationStatus): void => {
  status = next
  for (const listener of listeners) listener()
}

const controller = createProposalVerdictMutationController({
  mutate: (intent, idempotencyKey) =>
    intent.verdict === 'land'
      ? landSocialProposal(intent.proposalId, intent.subject, idempotencyKey)
      : declineSocialProposal(intent.proposalId, intent.subject, idempotencyKey),
  reconcile: reconcileSocialProposals,
  describeFailure,
  setStatus: publish,
  mintIdempotencyKey: () => crypto.randomUUID(),
})

onAccountSwitch(() => controller.clearAll())

export function decideProposal(
  proposalId: string,
  subject: SocialEntityRef,
  verdict: ProposalVerdict,
): Promise<RevisionedMutationOutcome> {
  return controller.enqueue({ proposalId, subject, verdict })
}

export const retryProposalVerdict = controller.retry
export const discardProposalVerdict = controller.discard

export function useProposalVerdictMutationStatus(): ProposalVerdictMutationStatus {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => status,
    () => IDLE_PROPOSAL_VERDICT_MUTATION,
  )
}
