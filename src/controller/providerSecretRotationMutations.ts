/** Eager facade for restart-safe Session-secret rotation and its memory-only reveal. */
import type { ModelProvider } from '../../contract/index.ts'
import { onAccountSwitch } from '../api'
import type {
  ProviderSecretRotationIntent,
  ProviderSecretRotationResult,
} from '../api/providerSecretRotationCommands.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'
import {
  IDLE_REVISIONED_MUTATION,
  type RevisionedMutationOutcome,
} from './revisionedMutationCore.ts'
import {
  acquireProviderMutation,
  releaseProviderMutation,
  type ProviderMutationLease,
} from './providerMutationHolds.ts'
import {
  releaseProviderSecretRotationIntent,
  retainProviderSecretRotationIntent,
  retainedProviderSecretRotationIntent,
} from './providerSecretRotationIntentPersistence.ts'

interface HeldRotation {
  intent: ProviderSecretRotationIntent
  result: Promise<RevisionedMutationOutcome>
  lease: ProviderMutationLease
}

export interface ProviderSecretRotationReveal {
  identityKey: string
  provider: ModelProvider
  secret: string
}

const statusStore = createMutationStatusStore()
let heldRotation: HeldRotation | null = null
let reveal: ProviderSecretRotationReveal | null = null
let accountGeneration = 0
export const publishProviderSecretRotationStatus = statusStore.publish

type Runtime = typeof import('./providerSecretRotationMutationRuntime.ts')
let runtime: Runtime | null = null
let runtimePromise: Promise<Runtime> | null = null
const loadRuntime = (): Promise<Runtime> => {
  runtimePromise ??= import('./providerSecretRotationMutationRuntime.ts').then((loaded) => {
    runtime = loaded
    return loaded
  })
  return runtimePromise
}

function releaseHeldRotation(intent: ProviderSecretRotationIntent): void {
  if (heldRotation?.intent !== intent) return
  releaseProviderSecretRotationIntent(intent)
  releaseProviderMutation(heldRotation.lease)
  heldRotation = null
  statusStore.refresh()
}

onAccountSwitch(() => {
  accountGeneration += 1
  if (heldRotation) releaseProviderMutation(heldRotation.lease)
  heldRotation = null
  reveal = null
  if (runtime) runtime.clearProviderSecretRotations()
  else statusStore.publish(IDLE_REVISIONED_MUTATION)
})

export const heldProviderSecretRotation = (providerId: string): ProviderSecretRotationIntent | null =>
  heldRotation?.intent.providerId === providerId ? heldRotation.intent : null

export const providerSecretRotationReveal = (
  identityKey: string | null,
): ProviderSecretRotationReveal | null =>
  reveal?.identityKey === identityKey ? reveal : null

export function acceptProviderSecretRotation(
  intent: ProviderSecretRotationIntent,
  result: ProviderSecretRotationResult,
): void {
  if (heldRotation?.intent !== intent) return
  reveal = { identityKey: intent.identityKey, ...result }
}

export function acknowledgeProviderSecretRotation(providerId: string): void {
  if (!reveal || reveal.provider.id !== providerId || !heldRotation) return
  const intent = heldRotation.intent
  reveal = null
  releaseHeldRotation(intent)
}

function beginProviderSecretRotation(
  intent: ProviderSecretRotationIntent,
  recoverFirst: boolean,
): Promise<RevisionedMutationOutcome> | null {
  if (heldRotation) {
    return heldRotation.intent.providerId === intent.providerId ? heldRotation.result : null
  }
  const lease = acquireProviderMutation('connection', intent.providerId)
  if (!lease) return null
  const issuedGeneration = accountGeneration
  retainProviderSecretRotationIntent(intent)
  const result = loadRuntime().then((loaded) =>
    issuedGeneration === accountGeneration
      ? recoverFirst
        ? loaded.resumeProviderSecretRotationRuntime(intent)
        : loaded.enqueueProviderSecretRotationRuntime(intent)
      : 'discarded' as const,
  )
  heldRotation = { intent, result, lease }
  statusStore.refresh()
  void result.finally(() => {
    if (issuedGeneration !== accountGeneration || heldRotation?.result !== result) return
    // An applied bearer stays held until the user finishes its reveal. Cancellation
    // or a terminal discard can release immediately because no secret is exposed.
    if (!reveal) releaseHeldRotation(intent)
  })
  return result
}

export function enqueueProviderSecretRotation(input: {
  identityKey: string
  tenantId: string
  providerId: string
  expectedRevision: number
}): Promise<RevisionedMutationOutcome> | null {
  return beginProviderSecretRotation({ ...input, intentId: crypto.randomUUID() }, false)
}

/** Rehydrate only non-secret coordinates belonging to this verified account.
 * The first network operation is an authoritative read. */
export function resumeProviderSecretRotation(identityKey: string): void {
  if (heldRotation) return
  const retained = retainedProviderSecretRotationIntent(identityKey)
  if (retained) void beginProviderSecretRotation(retained, true)
}

export const retryProviderSecretRotation = (): void => { runtime?.retryProviderSecretRotationRuntime() }
export const cancelProviderSecretRotationRequest = (): void => { runtime?.cancelProviderSecretRotationRuntime() }
export const useProviderSecretRotationStatus = statusStore.useStatus
