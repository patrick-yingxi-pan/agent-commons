/** Eager held-state facade for acknowledgement-owned access-token revocation. */
import type { ApiToken } from '../../contract/index.ts'
import { onAccountSwitch } from '../api'
import type { ApiTokenRevocationIntent } from '../api/apiTokenRevocationCommands.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'
import { IDLE_REVISIONED_MUTATION, type RevisionedMutationOutcome } from './revisionedMutationCore.ts'

interface HeldRevocation {
  token: ApiToken
  intent: ApiTokenRevocationIntent
  result: Promise<RevisionedMutationOutcome>
}

const statusStore = createMutationStatusStore()
const heldRevocations = new Map<string, HeldRevocation>()
let accountGeneration = 0
export const publishApiTokenRevocationStatus = statusStore.publish

type Runtime = typeof import('./apiTokenRevocationMutationRuntime.ts')
let runtime: Runtime | null = null
let runtimePromise: Promise<Runtime> | null = null
const loadRuntime = (): Promise<Runtime> => {
  runtimePromise ??= import('./apiTokenRevocationMutationRuntime.ts').then((loaded) => {
    runtime = loaded
    return loaded
  })
  return runtimePromise
}

onAccountSwitch(() => {
  accountGeneration += 1
  heldRevocations.clear()
  if (runtime) runtime.clearApiTokenRevocations()
  else statusStore.publish(IDLE_REVISIONED_MUTATION)
})

export const isApiTokenRevocationHeld = (tokenId: string): boolean =>
  heldRevocations.has(tokenId)

/** Preserve an uncertain row even when a crossed refetch observes committed
 * absence before the originating response/reconciliation settles. */
export const heldApiTokenRevocations = (): ApiToken[] =>
  [...heldRevocations.values()].map((held) => held.token)

export function enqueueApiTokenRevocation(
  token: ApiToken,
): Promise<RevisionedMutationOutcome> {
  const existing = heldRevocations.get(token.id)
  if (existing) return existing.result

  const issuedGeneration = accountGeneration
  const intent: ApiTokenRevocationIntent = { tokenId: token.id, intentId: crypto.randomUUID() }
  const result = loadRuntime().then((loaded) =>
    issuedGeneration === accountGeneration
      ? loaded.enqueueApiTokenRevocationRuntime(intent)
      : 'discarded' as const,
  )
  heldRevocations.set(token.id, { token, intent, result })
  statusStore.refresh()
  const release = (): void => {
    if (issuedGeneration !== accountGeneration) return
    if (heldRevocations.get(token.id)?.result !== result) return
    heldRevocations.delete(token.id)
    statusStore.refresh()
  }
  void result.then(release, release)
  return result
}

export const retryApiTokenRevocation = (): void => { runtime?.retryApiTokenRevocationRuntime() }
export const discardApiTokenRevocation = (): void => { runtime?.discardApiTokenRevocationRuntime() }
export const useApiTokenRevocationStatus = statusStore.useStatus
