/** Eager held-state facade for receipt-owned relation proposal decisions. */
import { onAccountSwitch } from '../api'
import { opKey, type RelationOp } from '../../contract/index.ts'
import type {
  RelationActionDecisionIntent,
  RelationActionVerdict,
} from '../api/relationActionDecisionCommands.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'
import { IDLE_REVISIONED_MUTATION, type RevisionedMutationOutcome } from './revisionedMutationCore.ts'

interface HeldDecision {
  intent: RelationActionDecisionIntent
  result: Promise<RevisionedMutationOutcome>
}

const statusStore = createMutationStatusStore()
const heldDecisions = new Map<string, HeldDecision>()
let accountGeneration = 0
export const publishRelationActionDecisionStatus = statusStore.publish

export const relationActionDecisionResourceId = (
  sessionId: string,
  messageId: string,
  operationKey: string,
): string => `${sessionId}\0${messageId}\0${operationKey}`

type Runtime = typeof import('./relationActionDecisionMutationRuntime.ts')
let runtime: Runtime | null = null
let runtimePromise: Promise<Runtime> | null = null
const loadRuntime = (): Promise<Runtime> => {
  runtimePromise ??= import('./relationActionDecisionMutationRuntime.ts').then((loaded) => {
    runtime = loaded
    return loaded
  })
  return runtimePromise
}

onAccountSwitch(() => {
  accountGeneration += 1
  heldDecisions.clear()
  if (runtime) runtime.clearRelationActionDecisions()
  else statusStore.publish(IDLE_REVISIONED_MUTATION)
})

export const heldRelationActionDecisionIntent = (
  sessionId: string,
  messageId: string,
  operationKey: string,
): RelationActionDecisionIntent | null =>
  heldDecisions.get(relationActionDecisionResourceId(sessionId, messageId, operationKey))?.intent ?? null

export function enqueueRelationActionDecision(input: {
  tenantId: string
  sessionId: string
  messageId: string
  operation: RelationOp
  verdict: RelationActionVerdict
}): Promise<RevisionedMutationOutcome> {
  const operationKey = opKey(input.operation)
  const key = relationActionDecisionResourceId(input.sessionId, input.messageId, operationKey)
  const existing = heldDecisions.get(key)
  if (existing) {
    return existing.intent.verdict === input.verdict ? existing.result : Promise.resolve('discarded')
  }

  const issuedGeneration = accountGeneration
  const intent: RelationActionDecisionIntent = {
    ...input,
    operationKey,
    intentId: crypto.randomUUID(),
  }
  const result = loadRuntime().then((loaded) =>
    issuedGeneration === accountGeneration
      ? loaded.enqueueRelationActionDecisionRuntime(intent)
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

export const retryRelationActionDecision = (): void => { runtime?.retryRelationActionDecisionRuntime() }
export const discardRelationActionDecision = (): void => { runtime?.discardRelationActionDecisionRuntime() }
export const useRelationActionDecisionStatus = statusStore.useStatus
