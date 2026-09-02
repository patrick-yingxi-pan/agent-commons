/** Tiny eager facade for acknowledgement-owned sharing and revocation. */
import { onAccountSwitch } from '../api'
import type { CreateGrantRequest, Grant, SocialEntityRef } from '../../contract/index.ts'
import type { GrantMutationIntent } from '../api/grantRevision.ts'
import {
  IDLE_REVISIONED_MUTATION,
  type RevisionedMutationOutcome,
} from './revisionedMutationCore.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'

const statusStore = createMutationStatusStore()
const heldResources = new Map<string, number>()
let accountGeneration = 0
export const publishGrantMutationStatus = statusStore.publish
export const SHARING_MUTATION_WAIT = 'Wait for the current sharing change to be confirmed.'

type Runtime = typeof import('./grantMutationRuntime.ts')
let runtime: Runtime | null = null
let runtimePromise: Promise<Runtime> | null = null
const loadRuntime = (): Promise<Runtime> => {
  runtimePromise ??= import('./grantMutationRuntime.ts').then((loaded) => {
    runtime = loaded
    return loaded
  })
  return runtimePromise
}

const resourceKey = (subject: SocialEntityRef): string => `${subject.kind}:${subject.id}`
const intentSubject = (intent: GrantMutationIntent): SocialEntityRef =>
  intent.kind === 'upsert' ? intent.request.subject : intent.grant.subject

onAccountSwitch(() => {
  accountGeneration += 1
  heldResources.clear()
  if (runtime) runtime.clearGrantMutations()
  else statusStore.publish(IDLE_REVISIONED_MUTATION)
})

export function isGrantMutationHeld(subject: SocialEntityRef): boolean {
  return (heldResources.get(resourceKey(subject)) ?? 0) > 0
}

function enqueue(intent: GrantMutationIntent): Promise<RevisionedMutationOutcome> {
  const issuedGeneration = accountGeneration
  const key = resourceKey(intentSubject(intent))
  heldResources.set(key, (heldResources.get(key) ?? 0) + 1)
  statusStore.refresh()
  const outcome = loadRuntime().then((loaded) =>
    issuedGeneration === accountGeneration
      ? loaded.enqueueGrantMutationRuntime(intent)
      : 'discarded' as const,
  )
  void outcome.finally(() => {
    if (issuedGeneration !== accountGeneration) return
    const next = Math.max(0, (heldResources.get(key) ?? 1) - 1)
    if (next === 0) heldResources.delete(key)
    else heldResources.set(key, next)
    statusStore.refresh()
  })
  return outcome
}

export const enqueueGrantChange = (request: CreateGrantRequest): Promise<RevisionedMutationOutcome> =>
  enqueue({ kind: 'upsert', request })

export const enqueueGrantRevocation = (grant: Grant): Promise<RevisionedMutationOutcome> =>
  enqueue({ kind: 'revoke', grant })

export const retryGrantMutation = (): void => { runtime?.retryGrantMutationRuntime() }
export const discardGrantMutation = (): void => { runtime?.discardGrantMutationRuntime() }
export const useGrantMutationStatus = statusStore.useStatus
