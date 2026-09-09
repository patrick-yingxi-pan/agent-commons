/** Eager held-state facade for acknowledgement-owned conversation tool consent. */
import { onAccountSwitch } from '../api'
import type {
  ToolActivityDecision,
  ToolActivityDecisionIntent,
} from '../api/toolActivityDecisionCommands.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'
import { IDLE_REVISIONED_MUTATION, type RevisionedMutationOutcome } from './revisionedMutationCore.ts'
import { createRetryableRuntimeLoader, createRuntimeLoadFailureTracker } from './retryableRuntimeLoader.ts'

interface HeldDecision {
  intent: ToolActivityDecisionIntent
  result: Promise<RevisionedMutationOutcome>
  settle: (outcome: RevisionedMutationOutcome) => void
  issuedGeneration: number
  loading: boolean
}

const statusStore = createMutationStatusStore()
const heldDecisions = new Map<string, HeldDecision>()
let accountGeneration = 0
export const publishToolActivityDecisionStatus = statusStore.publish

export const toolActivityDecisionResourceId = (sessionId: string, activityId: string): string =>
  `${sessionId}\0${activityId}`

type Runtime = typeof import('./toolActivityDecisionMutationRuntime.ts')
let runtime: Runtime | null = null
const loadRuntime = createRetryableRuntimeLoader<Runtime>(
  () => import('./toolActivityDecisionMutationRuntime.ts'),
  (loaded) => { runtime = loaded },
)
const loadFailures = createRuntimeLoadFailureTracker()

const publishLoadFailure = (): void => {
  statusStore.publish(loadFailures.status(
    heldDecisions.size,
    'Couldn’t load the tool decision controller. Retry safely or Dismiss.',
  ))
}

const activateHeldDecision = (key: string, held: HeldDecision): void => {
  if (held.loading || heldDecisions.get(key) !== held) return
  held.loading = true
  statusStore.publish({ busy: true, error: null, retryable: false, activeResourceId: key, pendingCount: heldDecisions.size })
  void loadRuntime().then(
    (loaded) => {
      held.loading = false
      if (held.issuedGeneration !== accountGeneration || heldDecisions.get(key) !== held) {
        held.settle('discarded')
        return
      }
      void loaded.enqueueToolActivityDecisionRuntime(held.intent).then(held.settle)
    },
    () => {
      held.loading = false
      if (held.issuedGeneration !== accountGeneration || heldDecisions.get(key) !== held) return
      loadFailures.fail(key)
      publishLoadFailure()
    },
  )
}

onAccountSwitch(() => {
  accountGeneration += 1
  loadFailures.clear()
  for (const held of heldDecisions.values()) held.settle('discarded')
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
  sourceUserId: string | null
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
  let settle!: (outcome: RevisionedMutationOutcome) => void
  const result = new Promise<RevisionedMutationOutcome>((resolve) => { settle = resolve })
  const held = { intent, result, settle, issuedGeneration, loading: false }
  heldDecisions.set(key, held)
  if (loadFailures.active()) publishLoadFailure()
  else {
    statusStore.refresh()
    activateHeldDecision(key, held)
  }
  const release = (): void => {
    if (issuedGeneration !== accountGeneration) return
    if (heldDecisions.get(key)?.result !== result) return
    heldDecisions.delete(key)
    loadFailures.remove(key, heldDecisions.keys())
    if (!runtime) publishLoadFailure()
    else statusStore.refresh()
  }
  void result.then(release)
  return result
}

export const retryToolActivityDecision = (): void => {
  if (runtime) runtime.retryToolActivityDecisionRuntime()
  else {
    loadFailures.retry()
    for (const [key, held] of heldDecisions) activateHeldDecision(key, held)
  }
}
export const discardToolActivityDecision = (): void => {
  if (runtime) runtime.discardToolActivityDecisionRuntime()
  else {
    const key = loadFailures.active()
    if (key) heldDecisions.get(key)?.settle('discarded')
  }
}
export const useToolActivityDecisionStatus = statusStore.useStatus
