/** Tiny eager facade for acknowledgement-owned discussion and Commons prose. */
import { onAccountSwitch } from '../api'
import type { AnchorLocus, Discussion, SocialEntityRef } from '../../contract/index.ts'
import {
  socialPostAnchorResourceId,
  socialPostResourceId,
  type SocialPostMutationIntent,
} from '../api/socialPostRevision.ts'
import {
  IDLE_REVISIONED_MUTATION,
  type RevisionedMutationOutcome,
} from './revisionedMutationCore.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'

export interface SocialPostMutationResult {
  outcome: RevisionedMutationOutcome
  discussion?: Discussion
}

const statusStore = createMutationStatusStore()
const heldResources = new Map<string, number>()
let accountGeneration = 0
export const publishSocialPostMutationStatus = statusStore.publish
export const SOCIAL_POST_MUTATION_WAIT = 'Wait for this post to be confirmed.'

type Runtime = typeof import('./socialPostMutationRuntime.ts')
let runtime: Runtime | null = null
let runtimePromise: Promise<Runtime> | null = null
const loadRuntime = (): Promise<Runtime> => {
  runtimePromise ??= import('./socialPostMutationRuntime.ts').then((loaded) => {
    runtime = loaded
    return loaded
  })
  return runtimePromise
}

onAccountSwitch(() => {
  accountGeneration += 1
  heldResources.clear()
  if (runtime) runtime.clearSocialPostMutations()
  else statusStore.publish(IDLE_REVISIONED_MUTATION)
})

export function isSocialPostMutationHeld(
  subject: SocialEntityRef,
  locus?: AnchorLocus,
): boolean {
  return (heldResources.get(socialPostAnchorResourceId(subject, locus)) ?? 0) > 0
}

export function isWallPostMutationHeld(authorName: string): boolean {
  return (heldResources.get(`principal:${authorName}:wall`) ?? 0) > 0
}

function enqueue(intent: SocialPostMutationIntent): Promise<SocialPostMutationResult> {
  const issuedGeneration = accountGeneration
  const resourceId = socialPostResourceId(intent)
  heldResources.set(resourceId, (heldResources.get(resourceId) ?? 0) + 1)
  statusStore.refresh()
  const result = loadRuntime().then((loaded) =>
    issuedGeneration === accountGeneration
      ? loaded.enqueueSocialPostMutationRuntime(intent)
      : { outcome: 'discarded' as const },
  )
  void result.finally(() => {
    if (issuedGeneration !== accountGeneration) return
    const next = Math.max(0, (heldResources.get(resourceId) ?? 1) - 1)
    if (next === 0) heldResources.delete(resourceId)
    else heldResources.set(resourceId, next)
    statusStore.refresh()
  })
  return result
}

export function enqueueThreadPost(input: {
  tenantId: string
  subject: SocialEntityRef
  discussionId?: string
  locus?: AnchorLocus
  body: string
  replyTo?: string
}): Promise<SocialPostMutationResult> {
  const logicalKey = crypto.randomUUID()
  return enqueue(input.discussionId
    ? {
        kind: 'append',
        tenantId: input.tenantId,
        logicalKey,
        subject: input.subject,
        discussionId: input.discussionId,
        body: input.body,
        ...(input.locus ? { locus: input.locus } : {}),
        ...(input.replyTo !== undefined ? { replyTo: input.replyTo } : {}),
      }
    : {
        kind: 'open',
        tenantId: input.tenantId,
        logicalKey,
        subject: input.subject,
        body: input.body,
        ...(input.locus ? { locus: input.locus } : {}),
      })
}

export function enqueueWallPost(input: {
  tenantId: string
  authorName: string
  body: string
}): Promise<SocialPostMutationResult> {
  return enqueue({ ...input, kind: 'wall', logicalKey: crypto.randomUUID() })
}

export const retrySocialPostMutation = (): void => { runtime?.retrySocialPostMutationRuntime() }
export const discardSocialPostMutation = (): void => { runtime?.discardSocialPostMutationRuntime() }
export const useSocialPostMutationStatus = statusStore.useStatus
