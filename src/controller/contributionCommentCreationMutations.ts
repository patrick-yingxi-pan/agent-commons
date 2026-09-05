/** Eager held-state facade for acknowledgement-owned Contribution comments. */
import { CONTRIBUTION_FIELD_MAX } from '../../contract/index.ts'
import { onAccountSwitch } from '../api'
import type { ContributionCommentCreationIntent } from '../api/contributionCommentCreationCommands.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'
import { IDLE_REVISIONED_MUTATION, type RevisionedMutationOutcome } from './revisionedMutationCore.ts'

interface HeldComment {
  intent: ContributionCommentCreationIntent
  result: Promise<RevisionedMutationOutcome>
}

const statusStore = createMutationStatusStore()
const heldComments = new Map<string, HeldComment>()
let accountGeneration = 0
export const publishContributionCommentCreationStatus = statusStore.publish

const contributionKey = (projectId: string, contributionId: string): string =>
  `${projectId}\0${contributionId}`

type Runtime = typeof import('./contributionCommentCreationMutationRuntime.ts')
let runtime: Runtime | null = null
let runtimePromise: Promise<Runtime> | null = null
const loadRuntime = (): Promise<Runtime> => {
  runtimePromise ??= import('./contributionCommentCreationMutationRuntime.ts').then((loaded) => {
    runtime = loaded
    return loaded
  })
  return runtimePromise
}

onAccountSwitch(() => {
  accountGeneration += 1
  heldComments.clear()
  if (runtime) runtime.clearContributionCommentCreations()
  else statusStore.publish(IDLE_REVISIONED_MUTATION)
})

export const heldContributionCommentIntent = (
  projectId: string,
  contributionId: string,
): ContributionCommentCreationIntent | null =>
  heldComments.get(contributionKey(projectId, contributionId))?.intent ?? null

export function enqueueContributionCommentCreation(input: {
  tenantId: string
  projectId: string
  contributionId: string
  body: string
}): Promise<RevisionedMutationOutcome> {
  const key = contributionKey(input.projectId, input.contributionId)
  const existing = heldComments.get(key)
  if (existing) return existing.result

  const issuedGeneration = accountGeneration
  const intent: ContributionCommentCreationIntent = {
    ...input,
    body: input.body.trim().slice(0, CONTRIBUTION_FIELD_MAX),
    intentId: crypto.randomUUID(),
  }
  const result = loadRuntime().then((loaded) =>
    issuedGeneration === accountGeneration
      ? loaded.enqueueContributionCommentCreationRuntime(intent)
      : 'discarded' as const,
  )
  heldComments.set(key, { intent, result })
  statusStore.refresh()
  const release = (): void => {
    if (issuedGeneration !== accountGeneration) return
    if (heldComments.get(key)?.result !== result) return
    heldComments.delete(key)
    statusStore.refresh()
  }
  void result.then(release, release)
  return result
}

export const retryContributionCommentCreation = (): void => { runtime?.retryContributionCommentCreationRuntime() }
export const discardContributionCommentCreation = (): void => { runtime?.discardContributionCommentCreationRuntime() }
export const useContributionCommentCreationStatus = statusStore.useStatus
