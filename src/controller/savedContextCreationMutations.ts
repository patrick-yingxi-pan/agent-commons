/** Eager facade for acknowledgement-owned reusable Context setup. */
import type { SavedContext } from '../../contract/index.ts'
import { onAccountSwitch } from '../api'
import {
  savedContextCreationResourceId,
  type SavedContextCreationIntent,
} from '../api/savedContextCreationCommands.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'
import {
  IDLE_REVISIONED_MUTATION,
  type RevisionedMutationOutcome,
} from './revisionedMutationCore.ts'

interface HeldSavedContextCreation {
  intent: SavedContextCreationIntent
  result: Promise<RevisionedMutationOutcome>
}

const statusStore = createMutationStatusStore()
const held = new Map<string, HeldSavedContextCreation>()
let accountGeneration = 0
export const publishSavedContextCreationStatus = statusStore.publish

type Runtime = typeof import('./savedContextCreationMutationRuntime.ts')
let runtime: Runtime | null = null
let runtimePromise: Promise<Runtime> | null = null
const loadRuntime = (): Promise<Runtime> => {
  runtimePromise ??= import('./savedContextCreationMutationRuntime.ts').then((loaded) => {
    runtime = loaded
    return loaded
  })
  return runtimePromise
}

onAccountSwitch(() => {
  accountGeneration += 1
  held.clear()
  if (runtime) runtime.clearSavedContextCreations()
  else statusStore.publish(IDLE_REVISIONED_MUTATION)
})

export const isSavedContextCreationHeld = (contextId: string): boolean => held.has(contextId)

export function enqueueSavedContextCreation(input: {
  tenantId: string
  context: SavedContext
}): Promise<RevisionedMutationOutcome> {
  const existing = held.get(input.context.id)
  if (existing) return existing.result
  const issuedGeneration = accountGeneration
  const intent: SavedContextCreationIntent = {
    tenantId: input.tenantId,
    context: { ...input.context },
    intentId: crypto.randomUUID(),
  }
  const result = loadRuntime().then((loaded) =>
    issuedGeneration === accountGeneration
      ? loaded.enqueueSavedContextCreationRuntime(intent)
      : 'discarded' as const,
  )
  held.set(savedContextCreationResourceId(intent), { intent, result })
  statusStore.refresh()
  void result.finally(() => {
    if (issuedGeneration !== accountGeneration || held.get(intent.context.id)?.result !== result) return
    held.delete(intent.context.id)
    statusStore.refresh()
  })
  return result
}

export const retrySavedContextCreation = (): void => { runtime?.retrySavedContextCreationRuntime() }
export const discardSavedContextCreation = (): void => { runtime?.discardSavedContextCreationRuntime() }
export const useSavedContextCreationStatus = statusStore.useStatus
