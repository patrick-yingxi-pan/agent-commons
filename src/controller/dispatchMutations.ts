/** Tiny eager facade for acknowledgement-gated one-off Dispatch creation. */
import { onAccountSwitch } from '../api'
import type { DispatchIntent } from '../api/dispatchCommands'
import {
  IDLE_REVISIONED_MUTATION,
  type RevisionedMutationOutcome,
} from './revisionedMutationCore'
import { createMutationStatusStore } from './mutationStatusStore'

const statusStore = createMutationStatusStore()
let heldCount = 0
let accountGeneration = 0
export const publishDispatchMutationStatus = statusStore.publish

type Runtime = typeof import('./dispatchMutationRuntime')
let runtime: Runtime | null = null
let runtimePromise: Promise<Runtime> | null = null
const loadRuntime = (): Promise<Runtime> => {
  runtimePromise ??= import('./dispatchMutationRuntime').then((loaded) => {
    runtime = loaded
    return loaded
  })
  return runtimePromise
}

onAccountSwitch(() => {
  accountGeneration += 1
  heldCount = 0
  if (runtime) runtime.clearDispatchMutations()
  else statusStore.publish(IDLE_REVISIONED_MUTATION)
})

export const isDispatchHeld = (): boolean => heldCount > 0

export function enqueueDispatch(
  input: Omit<DispatchIntent, 'intentId'>,
): Promise<RevisionedMutationOutcome> {
  const issuedGeneration = accountGeneration
  const intent: DispatchIntent = { ...input, intentId: crypto.randomUUID() }
  heldCount += 1
  statusStore.refresh()
  const outcome = loadRuntime().then((loaded) =>
    issuedGeneration === accountGeneration
      ? loaded.enqueueDispatchMutationRuntime(intent)
      : 'discarded' as const,
  )
  void outcome.finally(() => {
    if (issuedGeneration !== accountGeneration) return
    heldCount = Math.max(0, heldCount - 1)
    statusStore.refresh()
  })
  return outcome
}

export const retryDispatchMutation = (): void => { runtime?.retryDispatchMutationRuntime() }
export const discardDispatchMutation = (): void => { runtime?.discardDispatchMutationRuntime() }
export const useDispatchMutationStatus = statusStore.useStatus
