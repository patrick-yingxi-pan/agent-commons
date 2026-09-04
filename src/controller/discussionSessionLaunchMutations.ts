/** Tiny eager facade for acknowledgement-gated discussion handoff. */
import { onAccountSwitch } from '../api'
import type { DiscussionSessionLaunchIntent } from '../api/discussionSessionLaunchCommands.ts'
import { sessionCreationId } from '../api/sessionCreationIdentity.ts'
import {
  IDLE_REVISIONED_MUTATION,
  type RevisionedMutationOutcome,
} from './revisionedMutationCore.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'

export interface DiscussionSessionLaunchResult {
  outcome: RevisionedMutationOutcome
  sessionId: string
}

const statusStore = createMutationStatusStore()
const heldDiscussions = new Map<string, Promise<DiscussionSessionLaunchResult>>()
let accountGeneration = 0
export const publishDiscussionSessionLaunchStatus = statusStore.publish

type Runtime = typeof import('./discussionSessionLaunchMutationRuntime.ts')
let runtime: Runtime | null = null
let runtimePromise: Promise<Runtime> | null = null
const loadRuntime = (): Promise<Runtime> => {
  runtimePromise ??= import('./discussionSessionLaunchMutationRuntime.ts').then((loaded) => {
    runtime = loaded
    return loaded
  })
  return runtimePromise
}

onAccountSwitch(() => {
  accountGeneration += 1
  heldDiscussions.clear()
  if (runtime) runtime.clearDiscussionSessionLaunches()
  else statusStore.publish(IDLE_REVISIONED_MUTATION)
})

export function isDiscussionSessionLaunchHeld(discussionId: string): boolean {
  return heldDiscussions.has(discussionId)
}

export function enqueueDiscussionSessionLaunch(input: {
  tenantId: string
  discussionId: string
  digest: string
}): Promise<DiscussionSessionLaunchResult> {
  const existing = heldDiscussions.get(input.discussionId)
  if (existing) return existing

  const issuedGeneration = accountGeneration
  const intent: DiscussionSessionLaunchIntent = { ...input, intentId: crypto.randomUUID() }
  const outcome = loadRuntime().then((loaded) =>
    issuedGeneration === accountGeneration
      ? loaded.enqueueDiscussionSessionLaunchRuntime(intent)
      : 'discarded' as const,
  )
  const result = Promise.all([outcome, sessionCreationId(input.tenantId, intent.intentId)])
    .then(([settled, sessionId]) => ({ outcome: settled, sessionId }))
  heldDiscussions.set(input.discussionId, result)
  statusStore.refresh()
  const release = (): void => {
    if (issuedGeneration !== accountGeneration) return
    if (heldDiscussions.get(input.discussionId) !== result) return
    heldDiscussions.delete(input.discussionId)
    statusStore.refresh()
  }
  void result.then(release, release)
  return result
}

export const retryDiscussionSessionLaunch = (): void => { runtime?.retryDiscussionSessionLaunchRuntime() }
export const discardDiscussionSessionLaunch = (): void => { runtime?.discardDiscussionSessionLaunchRuntime() }
export const useDiscussionSessionLaunchStatus = statusStore.useStatus
