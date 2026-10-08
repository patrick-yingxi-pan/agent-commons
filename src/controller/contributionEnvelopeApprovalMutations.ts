/** Eager held-state facade for acknowledgement-owned envelope approval. */
import { onAccountSwitch } from '../api'
import type { ContributionEnvelopeApprovalIntent } from '../api/contributionEnvelopeApprovalCommands.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'
import { IDLE_REVISIONED_MUTATION, type RevisionedMutationOutcome } from './revisionedMutationCore.ts'

interface HeldApproval {
  intent: ContributionEnvelopeApprovalIntent
  result: Promise<RevisionedMutationOutcome>
}

const statusStore = createMutationStatusStore()
const heldApprovals = new Map<string, HeldApproval>()
let accountGeneration = 0
export const publishContributionEnvelopeApprovalStatus = statusStore.publish

const contributionKey = (projectId: string, contributionId: string): string =>
  `${projectId}\0${contributionId}`

type Runtime = typeof import('./contributionEnvelopeApprovalMutationRuntime.ts')
let runtime: Runtime | null = null
let runtimePromise: Promise<Runtime> | null = null
const loadRuntime = (): Promise<Runtime> => {
  runtimePromise ??= import('./contributionEnvelopeApprovalMutationRuntime.ts').then((loaded) => {
    runtime = loaded
    return loaded
  })
  return runtimePromise
}

onAccountSwitch(() => {
  accountGeneration += 1
  heldApprovals.clear()
  if (runtime) runtime.clearContributionEnvelopeApprovals()
  else statusStore.publish(IDLE_REVISIONED_MUTATION)
})

export const heldContributionEnvelopeApprovalIntent = (
  projectId: string,
  contributionId: string,
): ContributionEnvelopeApprovalIntent | null =>
  heldApprovals.get(contributionKey(projectId, contributionId))?.intent ?? null

export const isContributionEnvelopeApprovalHeld = (
  projectId: string,
  contributionId: string,
): boolean => heldApprovals.has(contributionKey(projectId, contributionId))

export function enqueueContributionEnvelopeApproval(input: {
  tenantId: string
  sourceUserId: string | null
  projectId: string
  contributionId: string
  envelopeVersion: number
}): Promise<RevisionedMutationOutcome> {
  const key = contributionKey(input.projectId, input.contributionId)
  const existing = heldApprovals.get(key)
  if (existing) return existing.result

  const issuedGeneration = accountGeneration
  const intent: ContributionEnvelopeApprovalIntent = { ...input, intentId: crypto.randomUUID() }
  const result = loadRuntime().then((loaded) =>
    issuedGeneration === accountGeneration
      ? loaded.enqueueContributionEnvelopeApprovalRuntime(intent)
      : 'discarded' as const,
  )
  heldApprovals.set(key, { intent, result })
  statusStore.refresh()
  const release = (): void => {
    if (issuedGeneration !== accountGeneration) return
    if (heldApprovals.get(key)?.result !== result) return
    heldApprovals.delete(key)
    statusStore.refresh()
  }
  void result.then(release, release)
  return result
}

export const retryContributionEnvelopeApproval = (): void => { runtime?.retryContributionEnvelopeApprovalRuntime() }
export const discardContributionEnvelopeApproval = (): void => { runtime?.discardContributionEnvelopeApprovalRuntime() }
export const useContributionEnvelopeApprovalStatus = statusStore.useStatus
