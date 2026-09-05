/** Eager held-state facade for acknowledgement-owned Agent proposal verdicts. */
import { onAccountSwitch } from '../api'
import type {
  AgentProposalVerdict,
  AgentProposalVerdictIntent,
} from '../api/agentProposalVerdictCommands.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'
import { IDLE_REVISIONED_MUTATION, type RevisionedMutationOutcome } from './revisionedMutationCore.ts'

interface HeldVerdict {
  intent: AgentProposalVerdictIntent
  result: Promise<RevisionedMutationOutcome>
}

const statusStore = createMutationStatusStore()
const heldVerdicts = new Map<string, HeldVerdict>()
let accountGeneration = 0
export const publishAgentProposalVerdictStatus = statusStore.publish

const proposalKey = (agentId: string, proposalId: string): string => `${agentId}\0${proposalId}`

type Runtime = typeof import('./agentProposalVerdictMutationRuntime.ts')
let runtime: Runtime | null = null
let runtimePromise: Promise<Runtime> | null = null
const loadRuntime = (): Promise<Runtime> => {
  runtimePromise ??= import('./agentProposalVerdictMutationRuntime.ts').then((loaded) => {
    runtime = loaded
    return loaded
  })
  return runtimePromise
}

onAccountSwitch(() => {
  accountGeneration += 1
  heldVerdicts.clear()
  if (runtime) runtime.clearAgentProposalVerdicts()
  else statusStore.publish(IDLE_REVISIONED_MUTATION)
})

export const heldAgentProposalVerdictIntent = (
  agentId: string,
  proposalId: string,
): AgentProposalVerdictIntent | null => heldVerdicts.get(proposalKey(agentId, proposalId))?.intent ?? null

export function enqueueAgentProposalVerdict(input: {
  tenantId: string
  agentId: string
  proposalId: string
  action: AgentProposalVerdict
  note?: string
}): Promise<RevisionedMutationOutcome> {
  const key = proposalKey(input.agentId, input.proposalId)
  const existing = heldVerdicts.get(key)
  if (existing) return existing.intent.action === input.action ? existing.result : Promise.resolve('discarded')

  const issuedGeneration = accountGeneration
  const intent: AgentProposalVerdictIntent = {
    ...input,
    note: input.action === 'decline' ? (input.note ?? '').trim().slice(0, 2000) : '',
    intentId: crypto.randomUUID(),
  }
  const result = loadRuntime().then((loaded) =>
    issuedGeneration === accountGeneration
      ? loaded.enqueueAgentProposalVerdictRuntime(intent)
      : 'discarded' as const,
  )
  heldVerdicts.set(key, { intent, result })
  statusStore.refresh()
  const release = (): void => {
    if (issuedGeneration !== accountGeneration) return
    if (heldVerdicts.get(key)?.result !== result) return
    heldVerdicts.delete(key)
    statusStore.refresh()
  }
  void result.then(release, release)
  return result
}

export const retryAgentProposalVerdict = (): void => { runtime?.retryAgentProposalVerdictRuntime() }
export const discardAgentProposalVerdict = (): void => { runtime?.discardAgentProposalVerdictRuntime() }
export const useAgentProposalVerdictStatus = statusStore.useStatus
