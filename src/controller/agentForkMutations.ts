/** Tiny eager facade for acknowledgement-owned Agent definition forking. */
import { onAccountSwitch } from '../api'
import { agentForkCreationId } from '../api/agentCreationIdentity.ts'
import type { AgentForkIntent } from '../api/agentForkCommands.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'
import {
  IDLE_REVISIONED_MUTATION,
  type RevisionedMutationOutcome,
} from './revisionedMutationCore.ts'

export interface AgentForkResult {
  outcome: RevisionedMutationOutcome
  agentId: string
}

const statusStore = createMutationStatusStore()
const heldSources = new Map<string, Promise<AgentForkResult>>()
let accountGeneration = 0
export const publishAgentForkStatus = statusStore.publish

type Runtime = typeof import('./agentForkMutationRuntime.ts')
let runtime: Runtime | null = null
let runtimePromise: Promise<Runtime> | null = null
const loadRuntime = (): Promise<Runtime> => {
  runtimePromise ??= import('./agentForkMutationRuntime.ts').then((loaded) => {
    runtime = loaded
    return loaded
  })
  return runtimePromise
}

onAccountSwitch(() => {
  accountGeneration += 1
  heldSources.clear()
  if (runtime) runtime.clearAgentForks()
  else statusStore.publish(IDLE_REVISIONED_MUTATION)
})

export function isAgentForkHeld(sourceAgentId: string): boolean {
  return heldSources.has(sourceAgentId)
}

export function enqueueAgentFork(input: {
  tenantId: string
  sourceAgentId: string
}): Promise<AgentForkResult> {
  const existing = heldSources.get(input.sourceAgentId)
  if (existing) return existing

  const issuedGeneration = accountGeneration
  const intent: AgentForkIntent = { ...input, intentId: crypto.randomUUID() }
  const outcome = loadRuntime().then((loaded) =>
    issuedGeneration === accountGeneration
      ? loaded.enqueueAgentForkRuntime(intent)
      : 'discarded' as const,
  )
  const result = Promise.all([outcome, agentForkCreationId(input.tenantId, intent.intentId)])
    .then(([settled, agentId]) => ({ outcome: settled, agentId }))
  heldSources.set(input.sourceAgentId, result)
  statusStore.refresh()
  const release = (): void => {
    if (issuedGeneration !== accountGeneration) return
    if (heldSources.get(input.sourceAgentId) !== result) return
    heldSources.delete(input.sourceAgentId)
    statusStore.refresh()
  }
  void result.then(release, release)
  return result
}

export const retryAgentFork = (): void => { runtime?.retryAgentForkRuntime() }
export const discardAgentFork = (): void => { runtime?.discardAgentForkRuntime() }
export const useAgentForkStatus = statusStore.useStatus
