/** Eager held-form facade for restart-safe hosted access-token minting. */
import type { BearerSession } from '../../contract/index.ts'
import { onAccountSwitch } from '../api'
import type { ApiTokenMintIntent } from '../api/apiTokenMintCommands.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'
import {
  IDLE_REVISIONED_MUTATION,
  type RevisionedMutationOutcome,
} from './revisionedMutationCore.ts'
import {
  releaseApiTokenMintIntent,
  retainApiTokenMintIntent,
  retainedApiTokenMintIntent,
} from './apiTokenMintIntentPersistence.ts'

interface HeldMint {
  intent: ApiTokenMintIntent
  result: Promise<RevisionedMutationOutcome>
}

export interface ApiTokenMintReveal {
  identityKey: string
  session: BearerSession
}

const statusStore = createMutationStatusStore()
let heldMint: HeldMint | null = null
let reveal: ApiTokenMintReveal | null = null
let accountGeneration = 0
export const publishApiTokenMintStatus = statusStore.publish

type Runtime = typeof import('./apiTokenMintMutationRuntime.ts')
let runtime: Runtime | null = null
let runtimePromise: Promise<Runtime> | null = null
const loadRuntime = (): Promise<Runtime> => {
  runtimePromise ??= import('./apiTokenMintMutationRuntime.ts').then((loaded) => {
    runtime = loaded
    return loaded
  })
  return runtimePromise
}

onAccountSwitch(() => {
  accountGeneration += 1
  heldMint = null
  reveal = null
  if (runtime) runtime.clearApiTokenMints()
  else statusStore.publish(IDLE_REVISIONED_MUTATION)
})

export const heldApiTokenMint = (identityKey: string | null): ApiTokenMintIntent | null =>
  heldMint?.intent.identityKey === identityKey ? heldMint.intent : null

export const apiTokenMintReveal = (identityKey: string | null): ApiTokenMintReveal | null =>
  reveal?.identityKey === identityKey ? reveal : null

export function acceptApiTokenMint(
  intent: ApiTokenMintIntent,
  session: BearerSession,
): void {
  if (heldMint?.intent !== intent) return
  reveal = { identityKey: intent.identityKey, session }
}

export function clearApiTokenMintReveal(tokenId?: string): void {
  if (!reveal) return
  if (tokenId && reveal.session.tokenId !== tokenId) return
  reveal = null
  statusStore.refresh()
}

function beginApiTokenMint(
  intent: ApiTokenMintIntent,
  recoverFirst: boolean,
): Promise<RevisionedMutationOutcome> {
  if (heldMint) return heldMint.result
  const issuedGeneration = accountGeneration
  retainApiTokenMintIntent(intent)
  const result = loadRuntime().then((loaded) =>
    issuedGeneration === accountGeneration
      ? recoverFirst
        ? loaded.resumeApiTokenMintRuntime(intent)
        : loaded.enqueueApiTokenMintRuntime(intent)
      : 'discarded' as const,
  )
  heldMint = { intent, result }
  statusStore.refresh()
  void result.finally(() => {
    if (issuedGeneration !== accountGeneration || heldMint?.result !== result) return
    releaseApiTokenMintIntent(intent)
    heldMint = null
    statusStore.refresh()
  })
  return result
}

export function enqueueApiTokenMint(input: {
  identityKey: string
  label?: string
}): Promise<RevisionedMutationOutcome> {
  return beginApiTokenMint({ ...input, intentId: crypto.randomUUID() }, false)
}

/** Rehydrate only recovery coordinates for this verified account. The first
 * request is a read; an absent receipt remains held for an explicit Retry. */
export function resumeApiTokenMint(identityKey: string): void {
  if (heldMint) return
  const retained = retainedApiTokenMintIntent(identityKey)
  if (retained) void beginApiTokenMint(retained, true)
}

export const retryApiTokenMint = (): void => { runtime?.retryApiTokenMintRuntime() }
export const cancelApiTokenMintRequest = (): void => { runtime?.cancelApiTokenMintRuntime() }
export const useApiTokenMintStatus = statusStore.useStatus
