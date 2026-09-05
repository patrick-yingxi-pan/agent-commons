/** Eager held-state facade for acknowledgement-owned conversation compaction. */
import { onAccountSwitch } from '../api'
import type { SessionCompactionIntent } from '../api/sessionCompactionCommands.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'
import { IDLE_REVISIONED_MUTATION, type RevisionedMutationOutcome } from './revisionedMutationCore.ts'

interface HeldCompaction {
  intent: SessionCompactionIntent
  result: Promise<RevisionedMutationOutcome>
}

const statusStore = createMutationStatusStore()
const heldCompactions = new Map<string, HeldCompaction>()
let accountGeneration = 0
export const publishSessionCompactionStatus = statusStore.publish

type Runtime = typeof import('./sessionCompactionMutationRuntime.ts')
let runtime: Runtime | null = null
let runtimePromise: Promise<Runtime> | null = null
const loadRuntime = (): Promise<Runtime> => {
  runtimePromise ??= import('./sessionCompactionMutationRuntime.ts').then((loaded) => {
    runtime = loaded
    return loaded
  })
  return runtimePromise
}

onAccountSwitch(() => {
  accountGeneration += 1
  heldCompactions.clear()
  if (runtime) runtime.clearSessionCompactions()
  else statusStore.publish(IDLE_REVISIONED_MUTATION)
})

export const heldSessionCompactionIntent = (sessionId: string): SessionCompactionIntent | null =>
  heldCompactions.get(sessionId)?.intent ?? null

export const isSessionCompactionHeld = (sessionId: string): boolean =>
  heldCompactions.has(sessionId)

export function enqueueSessionCompaction(input: {
  tenantId: string
  sessionId: string
}): Promise<RevisionedMutationOutcome> {
  const existing = heldCompactions.get(input.sessionId)
  if (existing) return existing.result

  const issuedGeneration = accountGeneration
  const intent: SessionCompactionIntent = { ...input, intentId: crypto.randomUUID() }
  const result = loadRuntime().then((loaded) =>
    issuedGeneration === accountGeneration
      ? loaded.enqueueSessionCompactionRuntime(intent)
      : 'discarded' as const,
  )
  heldCompactions.set(input.sessionId, { intent, result })
  statusStore.refresh()
  const release = (): void => {
    if (issuedGeneration !== accountGeneration) return
    if (heldCompactions.get(input.sessionId)?.result !== result) return
    heldCompactions.delete(input.sessionId)
    statusStore.refresh()
  }
  void result.then(release, release)
  return result
}

export const retrySessionCompaction = (): void => { runtime?.retrySessionCompactionRuntime() }
export const discardSessionCompaction = (): void => { runtime?.discardSessionCompactionRuntime() }
export const useSessionCompactionStatus = statusStore.useStatus
