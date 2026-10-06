/** Eager, account-scoped facade for acknowledged Delegation policy edits. */
import type { PatchDelegationRequest } from '../../contract/index.ts'
import { onAccountSwitch } from '../api'
import type { DelegationPolicyIntent } from '../api/delegationPolicyRevision.ts'
import { clearDelegationPolicyDrafts, settleDelegationPolicyDraft } from './delegationPolicyDrafts.ts'
import {
  clearDelegationPolicyHolds,
  holdDelegationPolicy,
  isDelegationPolicyHeld,
  releaseDelegationPolicy,
} from './delegationPolicyHolds.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'
import {
  IDLE_REVISIONED_MUTATION,
  type RevisionedMutationOutcome,
} from './revisionedMutationCore.ts'

const statusStore = createMutationStatusStore()
let accountGeneration = 0
export const publishDelegationPolicyStatus = statusStore.publish

type Runtime = typeof import('./delegationPolicyMutationRuntime.ts')
let runtime: Runtime | null = null
let runtimePromise: Promise<Runtime> | null = null
const loadRuntime = (): Promise<Runtime> => {
  if (!runtimePromise) {
    const pending = import('./delegationPolicyMutationRuntime.ts').then((loaded) => {
      runtime = loaded
      return loaded
    }).catch((error: unknown) => {
      runtimePromise = null
      throw error
    })
    runtimePromise = pending
  }
  return runtimePromise
}

export async function prepareDelegationPolicyRuntime(): Promise<void> {
  await loadRuntime()
}

export const delegationPolicyAccountGeneration = (): number => accountGeneration

onAccountSwitch(() => {
  accountGeneration += 1
  clearDelegationPolicyHolds()
  clearDelegationPolicyDrafts()
  if (runtime) runtime.clearDelegationPolicies()
  else statusStore.publish(IDLE_REVISIONED_MUTATION)
})

export { isDelegationPolicyHeld }

export function enqueueDelegationPolicy(input: {
  tenantId: string
  projectId: string
  delegationId: string
  request: PatchDelegationRequest
}): Promise<RevisionedMutationOutcome> {
  const issuedGeneration = accountGeneration
  const intent: DelegationPolicyIntent = {
    ...input,
    intentId: crypto.randomUUID(),
    request: { ...input.request, escalation: [...input.request.escalation] },
  }
  holdDelegationPolicy(input.delegationId)
  statusStore.refresh()
  const outcome = loadRuntime().then((loaded) =>
    issuedGeneration === accountGeneration
      ? loaded.enqueueDelegationPolicyRuntime(intent)
      : 'discarded' as const,
  )
  const releaseHold = () => {
    if (issuedGeneration !== accountGeneration) return
    releaseDelegationPolicy(input.delegationId)
    statusStore.refresh()
  }
  void outcome.then((result) => {
    if (issuedGeneration === accountGeneration) {
      settleDelegationPolicyDraft({ id: input.delegationId, projectId: input.projectId }, result === 'applied')
    }
    releaseHold()
  }, releaseHold)
  return outcome
}

export const retryDelegationPolicy = (): void => { runtime?.retryDelegationPolicyRuntime() }
export const discardDelegationPolicy = (): void => { runtime?.discardDelegationPolicyRuntime() }
export const useDelegationPolicyStatus = statusStore.useStatus
