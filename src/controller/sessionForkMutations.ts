/** Tiny eager facade for acknowledgement-owned conversation branching. */
import { onAccountSwitch } from '../api'
import { sessionForkCreationId } from '../api/sessionCreationIdentity.ts'
import type { SessionForkIntent } from '../api/sessionForkCommands.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'
import {
  IDLE_REVISIONED_MUTATION,
  type RevisionedMutationOutcome,
} from './revisionedMutationCore.ts'

export interface SessionForkResult {
  outcome: RevisionedMutationOutcome
  sessionId: string
}

const statusStore = createMutationStatusStore()
const heldPositions = new Map<string, Promise<SessionForkResult>>()
let accountGeneration = 0
export const publishSessionForkStatus = statusStore.publish

const positionKey = (sourceSessionId: string, atMessageId: string): string =>
  `${sourceSessionId}\0${atMessageId}`

type Runtime = typeof import('./sessionForkMutationRuntime.ts')
let runtime: Runtime | null = null
let runtimePromise: Promise<Runtime> | null = null
const loadRuntime = (): Promise<Runtime> => {
  runtimePromise ??= import('./sessionForkMutationRuntime.ts').then((loaded) => {
    runtime = loaded
    return loaded
  })
  return runtimePromise
}

onAccountSwitch(() => {
  accountGeneration += 1
  heldPositions.clear()
  if (runtime) runtime.clearSessionForks()
  else statusStore.publish(IDLE_REVISIONED_MUTATION)
})

export function enqueueSessionFork(input: {
  tenantId: string
  sourceSessionId: string
  atMessageId: string
}): Promise<SessionForkResult> {
  const key = positionKey(input.sourceSessionId, input.atMessageId)
  const existing = heldPositions.get(key)
  if (existing) return existing

  const issuedGeneration = accountGeneration
  const intent: SessionForkIntent = { ...input, intentId: crypto.randomUUID() }
  const outcome = loadRuntime().then((loaded) =>
    issuedGeneration === accountGeneration
      ? loaded.enqueueSessionForkRuntime(intent)
      : 'discarded' as const,
  )
  const result = Promise.all([outcome, sessionForkCreationId(input.tenantId, intent.intentId)])
    .then(([settled, sessionId]) => ({ outcome: settled, sessionId }))
  heldPositions.set(key, result)
  const release = (): void => {
    if (issuedGeneration !== accountGeneration) return
    if (heldPositions.get(key) !== result) return
    heldPositions.delete(key)
  }
  void result.then(release, release)
  return result
}

export const retrySessionFork = (): void => { runtime?.retrySessionForkRuntime() }
export const discardSessionFork = (): void => { runtime?.discardSessionForkRuntime() }
export const useSessionForkStatus = statusStore.useStatus
