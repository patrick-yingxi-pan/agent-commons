/** Tiny eager facade for acknowledgement-owned organization founding. */
import type { CreateOrgRequest, Tenant } from '../../contract/index.ts'
import { onAccountSwitch } from '../api'
import { orgCreationId } from '../api/orgCreationIdentity.ts'
import type { OrgCreationIntent } from '../api/orgCreationRevision.ts'
import {
  IDLE_REVISIONED_MUTATION,
  type RevisionedMutationOutcome,
} from './revisionedMutationCore.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'

export interface OrgCreationResult {
  outcome: RevisionedMutationOutcome
  tenant: Tenant
}

interface HeldOrgCreation {
  intent: OrgCreationIntent
  result: Promise<OrgCreationResult>
}

const statusStore = createMutationStatusStore()
let accountGeneration = 0
let held: HeldOrgCreation | null = null
export const publishOrgCreationStatus = statusStore.publish

type Runtime = typeof import('./orgCreationMutationRuntime.ts')
let runtime: Runtime | null = null
let runtimePromise: Promise<Runtime> | null = null
const loadRuntime = (): Promise<Runtime> => {
  runtimePromise ??= import('./orgCreationMutationRuntime.ts').then((loaded) => {
    runtime = loaded
    return loaded
  })
  return runtimePromise
}

onAccountSwitch(() => {
  accountGeneration += 1
  held = null
  if (runtime) runtime.clearOrgCreations()
  else statusStore.publish(IDLE_REVISIONED_MUTATION)
})

export const heldOrgCreationIntent = (): OrgCreationIntent | null => held?.intent ?? null
export const isOrgCreationHeld = (): boolean => held !== null

export function enqueueOrgCreation(input: {
  tenantId: string
  request: CreateOrgRequest
}): Promise<OrgCreationResult> {
  if (held) return held.result
  const issuedGeneration = accountGeneration
  const intent: OrgCreationIntent = {
    tenantId: input.tenantId,
    request: { name: input.request.name.trim() },
    intentId: crypto.randomUUID(),
  }
  const outcome = loadRuntime().then((loaded) =>
    issuedGeneration === accountGeneration
      ? loaded.enqueueOrgCreationRuntime(intent)
      : 'discarded' as const,
  )
  const result = Promise.all([
    outcome,
    orgCreationId(intent.tenantId, intent.intentId),
  ]).then(([settled, id]) => ({
    outcome: settled,
    tenant: { id, name: intent.request.name, kind: 'org' as const },
  }))
  held = { intent, result }
  statusStore.refresh()
  const release = (): void => {
    if (issuedGeneration !== accountGeneration || held?.result !== result) return
    held = null
    statusStore.refresh()
  }
  void result.then(release, release)
  return result
}

export const retryOrgCreation = (): void => { runtime?.retryOrgCreationRuntime() }
export const discardOrgCreation = (): void => { runtime?.discardOrgCreationRuntime() }
export const useOrgCreationStatus = statusStore.useStatus
