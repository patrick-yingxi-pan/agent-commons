/** Eager held-state facade for acknowledgement-owned conversation tool consent. */
import { onAccountSwitch } from '../api'
import type {
  ToolActivityDecision,
  ToolActivityDecisionIntent,
} from '../api/toolActivityDecisionCommands.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'
import { IDLE_REVISIONED_MUTATION, type RevisionedMutationOutcome } from './revisionedMutationCore.ts'

interface HeldDecision {
  intent: ToolActivityDecisionIntent
  result: Promise<RevisionedMutationOutcome>
}

const statusStore = createMutationStatusStore()
const heldDecisions = new Map<string, HeldDecision>()
let accountGeneration = 0
export const publishToolActivityDecisionStatus = statusStore.publish

export const toolActivityDecisionResourceId = (sessionId: string, activityId: string): string =>
  `${sessionId}\0${activityId}`

type Runtime = typeof import('./toolActivityDecisionMutationRuntime.ts')
let runtime: Runtime | null = null
let runtimePromise: Promise<Runtime> | null = null
const loadRuntime = (): Promise<Runtime> => {
  runtimePromise ??= import('./toolActivityDecisionMutationRuntime.ts').then((loaded) => {
    runtime = loaded
    return loaded
  })
  return runtimePromise
}

onAccountSwitch(() => {
  accountGeneration += 1
  heldDecisions.clear()
  if (runtime) runtime.clearToolActivityDecisions()
  else statusStore.publish(IDLE_REVISIONED_MUTATION)
})

export const heldToolActivityDecisionIntent = (
  sessionId: string,
  activityId: string,
): ToolActivityDecisionIntent | null =>
  heldDecisions.get(toolActivityDecisionResourceId(sessionId, activityId))?.intent ?? null

export function enqueueToolActivityDecision(input: {
  tenantId: string
  sessionId: string
  activityId: string
  decision: ToolActivityDecision
}): Promise<RevisionedMutationOutcome> {
  const key = toolActivityDecisionResourceId(input.sessionId, input.activityId)
  const existing = heldDecisions.get(key)
  if (existing) {
    return existing.intent.decision === input.decision ? existing.result : Promise.resolve('discarded')
  }

  const issuedGeneration = accountGeneration
  const intent: ToolActivityDecisionIntent = {
    ...input,
    intentId: crypto.randomUUID(),
  }
  const result = loadRuntime().then((loaded) =>
    issuedGeneration === accountGeneration
      ? loaded.enqueueToolActivityDecisionRuntime(intent)
      : 'discarded' as const,
  )
  heldDecisions.set(key, { intent, result })
  statusStore.refresh()
  const release = (): void => {
    if (issuedGeneration !== accountGeneration) return
    if (heldDecisions.get(key)?.result !== result) return
    heldDecisions.delete(key)
    statusStore.refresh()
  }
  void result.then(release, release)
  return result
}

export const retryToolActivityDecision = (): void => { runtime?.retryToolActivityDecisionRuntime() }
export const discardToolActivityDecision = (): void => { runtime?.discardToolActivityDecisionRuntime() }
export const useToolActivityDecisionStatus = statusStore.useStatus
