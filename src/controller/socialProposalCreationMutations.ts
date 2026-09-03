/** Tiny eager facade for acknowledgement-owned change-offer creation. */
import type { OpenProposalRequest, SocialEntityRef } from '../../contract/index.ts'
import { onAccountSwitch } from '../api'
import { socialProposalCreationAnchorId, type SocialProposalCreationIntent } from '../api/socialProposalCreationRevision.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'
import {
  IDLE_REVISIONED_MUTATION,
  type RevisionedMutationOutcome,
} from './revisionedMutationCore.ts'

const statusStore = createMutationStatusStore()
const heldSubjects = new Map<string, number>()
let accountGeneration = 0
export const publishSocialProposalCreationStatus = statusStore.publish

type Runtime = typeof import('./socialProposalCreationMutationRuntime.ts')
let runtime: Runtime | null = null
let runtimePromise: Promise<Runtime> | null = null
const loadRuntime = (): Promise<Runtime> => {
  runtimePromise ??= import('./socialProposalCreationMutationRuntime.ts').then((loaded) => {
    runtime = loaded
    return loaded
  })
  return runtimePromise
}

onAccountSwitch(() => {
  accountGeneration += 1
  heldSubjects.clear()
  if (runtime) runtime.clearSocialProposalCreations()
  else statusStore.publish(IDLE_REVISIONED_MUTATION)
})

export const isSocialProposalCreationHeld = (subject: SocialEntityRef): boolean =>
  (heldSubjects.get(socialProposalCreationAnchorId(subject)) ?? 0) > 0

export function enqueueSocialProposalCreation(input: {
  tenantId: string
  request: OpenProposalRequest
}): Promise<RevisionedMutationOutcome> {
  const issuedGeneration = accountGeneration
  const intent: SocialProposalCreationIntent = { ...input, intentId: crypto.randomUUID() }
  const anchorId = socialProposalCreationAnchorId(input.request.subject)
  heldSubjects.set(anchorId, (heldSubjects.get(anchorId) ?? 0) + 1)
  statusStore.refresh()
  const outcome = loadRuntime().then((loaded) =>
    issuedGeneration === accountGeneration
      ? loaded.enqueueSocialProposalCreationRuntime(intent)
      : 'discarded' as const,
  )
  void outcome.finally(() => {
    if (issuedGeneration !== accountGeneration) return
    const remaining = Math.max(0, (heldSubjects.get(anchorId) ?? 0) - 1)
    if (remaining === 0) heldSubjects.delete(anchorId)
    else heldSubjects.set(anchorId, remaining)
    statusStore.refresh()
  })
  return outcome
}

export const retrySocialProposalCreation = (): void => { runtime?.retrySocialProposalCreationRuntime() }
export const discardSocialProposalCreation = (): void => { runtime?.discardSocialProposalCreationRuntime() }
export const useSocialProposalCreationStatus = statusStore.useStatus
