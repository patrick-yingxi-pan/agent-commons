/** Eager held-state facade for acknowledgement-owned Follow and Watch. */
import type { SocialEntityRef } from '../../contract/index.ts'
import { onAccountSwitch } from '../api'
import {
  followRelationshipResourceId,
  standingRelationshipResourceId,
  watchRelationshipResourceId,
  type StandingRelationshipIntent,
} from '../api/standingRelationshipCommands.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'
import { IDLE_REVISIONED_MUTATION, type RevisionedMutationOutcome } from './revisionedMutationCore.ts'

type StandingRelationshipInput =
  | { tenantId: string; kind: 'follow'; name: string; following: boolean }
  | { tenantId: string; kind: 'watch'; subject: SocialEntityRef; watching: boolean }

interface HeldRelationship {
  intent: StandingRelationshipIntent
  result: Promise<RevisionedMutationOutcome>
}

const statusStore = createMutationStatusStore()
const held = new Map<string, HeldRelationship>()
let accountGeneration = 0
export const publishStandingRelationshipStatus = statusStore.publish

type Runtime = typeof import('./standingRelationshipMutationRuntime.ts')
let runtime: Runtime | null = null
let runtimePromise: Promise<Runtime> | null = null
const loadRuntime = (): Promise<Runtime> => {
  runtimePromise ??= import('./standingRelationshipMutationRuntime.ts').then((loaded) => {
    runtime = loaded
    return loaded
  })
  return runtimePromise
}

onAccountSwitch(() => {
  accountGeneration += 1
  held.clear()
  if (runtime) runtime.clearStandingRelationships()
  else statusStore.publish(IDLE_REVISIONED_MUTATION)
})

export function enqueueStandingRelationship(
  input: StandingRelationshipInput,
): Promise<RevisionedMutationOutcome> {
  const frozenInput = input.kind === 'watch'
    ? { ...input, subject: { ...input.subject } }
    : { ...input }
  const intent: StandingRelationshipIntent = { ...frozenInput, intentId: crypto.randomUUID() }
  const resourceId = standingRelationshipResourceId(intent)
  const existing = held.get(resourceId)
  if (existing) return existing.result
  const issuedGeneration = accountGeneration
  const result = loadRuntime().then((loaded) =>
    issuedGeneration === accountGeneration
      ? loaded.enqueueStandingRelationshipRuntime(intent)
      : 'discarded' as const,
  )
  held.set(resourceId, { intent, result })
  statusStore.refresh()
  void result.finally(() => {
    if (issuedGeneration !== accountGeneration || held.get(resourceId)?.result !== result) return
    held.delete(resourceId)
    statusStore.refresh()
  })
  return result
}

export const heldFollowRelationship = (name: string): Extract<StandingRelationshipIntent, { kind: 'follow' }> | undefined => {
  const intent = held.get(followRelationshipResourceId(name))?.intent
  return intent?.kind === 'follow' ? intent : undefined
}

export const heldWatchRelationship = (subject: SocialEntityRef): Extract<StandingRelationshipIntent, { kind: 'watch' }> | undefined => {
  const intent = held.get(watchRelationshipResourceId(subject))?.intent
  return intent?.kind === 'watch' ? intent : undefined
}

export const retryStandingRelationship = (): void => { runtime?.retryStandingRelationshipRuntime() }
export const discardStandingRelationship = (): void => { runtime?.discardStandingRelationshipRuntime() }
export const useStandingRelationshipStatus = statusStore.useStatus
export { followRelationshipResourceId, watchRelationshipResourceId }
