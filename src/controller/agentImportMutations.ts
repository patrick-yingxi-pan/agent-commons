/** Tiny eager facade for acknowledgement-owned remote Agent Card imports. */
import type { ImportAgentCardRequest } from '../../contract/index.ts'
import { onAccountSwitch } from '../api'
import { agentImportCreationId } from '../api/agentCreationIdentity.ts'
import type { AgentImportIntent } from '../api/agentImportCommands.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'
import {
  IDLE_REVISIONED_MUTATION,
  type RevisionedMutationOutcome,
} from './revisionedMutationCore.ts'

export interface AgentImportResult {
  outcome: RevisionedMutationOutcome
  agentId: string
}

const statusStore = createMutationStatusStore()
const heldImports = new Map<string, Promise<AgentImportResult>>()
let accountGeneration = 0
export const publishAgentImportStatus = statusStore.publish

type Runtime = typeof import('./agentImportMutationRuntime.ts')
let runtime: Runtime | null = null
let runtimePromise: Promise<Runtime> | null = null
const loadRuntime = (): Promise<Runtime> => {
  runtimePromise ??= import('./agentImportMutationRuntime.ts').then((loaded) => {
    runtime = loaded
    return loaded
  })
  return runtimePromise
}

onAccountSwitch(() => {
  accountGeneration += 1
  heldImports.clear()
  if (runtime) runtime.clearAgentImports()
  else statusStore.publish(IDLE_REVISIONED_MUTATION)
})

export function heldAgentImportUrl(): string | null {
  return heldImports.keys().next().value ?? null
}

export function enqueueAgentImport(input: {
  tenantId: string
  request: ImportAgentCardRequest
}): Promise<AgentImportResult> {
  const frozenUrl = input.request.url.trim()
  const existing = heldImports.get(frozenUrl)
  if (existing) return existing

  const issuedGeneration = accountGeneration
  const intent: AgentImportIntent = {
    tenantId: input.tenantId,
    request: { url: frozenUrl },
    intentId: crypto.randomUUID(),
  }
  const outcome = loadRuntime().then((loaded) =>
    issuedGeneration === accountGeneration
      ? loaded.enqueueAgentImportRuntime(intent)
      : 'discarded' as const,
  )
  const result = Promise.all([outcome, agentImportCreationId(input.tenantId, intent.intentId)])
    .then(([settled, agentId]) => ({ outcome: settled, agentId }))
  heldImports.set(frozenUrl, result)
  statusStore.refresh()
  const release = (): void => {
    if (issuedGeneration !== accountGeneration) return
    if (heldImports.get(frozenUrl) !== result) return
    heldImports.delete(frozenUrl)
    statusStore.refresh()
  }
  void result.then(release, release)
  return result
}

export const retryAgentImport = (): void => { runtime?.retryAgentImportRuntime() }
export const discardAgentImport = (): void => { runtime?.discardAgentImportRuntime() }
export const useAgentImportStatus = statusStore.useStatus
