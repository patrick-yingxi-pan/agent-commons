/** Eager held-state facade for acknowledgement-owned Agent proposal comments. */
import { WORK_ITEM_COMMENT_MAX } from '../../contract/index.ts'
import { onAccountSwitch } from '../api'
import type { AgentProposalCommentCreationIntent } from '../api/agentProposalCommentCreationCommands.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'
import { IDLE_REVISIONED_MUTATION, type RevisionedMutationOutcome } from './revisionedMutationCore.ts'

interface HeldComment {
  intent: AgentProposalCommentCreationIntent
  result: Promise<RevisionedMutationOutcome>
}

const statusStore = createMutationStatusStore()
const heldComments = new Map<string, HeldComment>()
let accountGeneration = 0
export const publishAgentProposalCommentCreationStatus = statusStore.publish

const proposalKey = (agentId: string, proposalId: string): string => `${agentId}\0${proposalId}`

type Runtime = typeof import('./agentProposalCommentCreationMutationRuntime.ts')
let runtime: Runtime | null = null
let runtimePromise: Promise<Runtime> | null = null
const loadRuntime = (): Promise<Runtime> => {
  runtimePromise ??= import('./agentProposalCommentCreationMutationRuntime.ts').then((loaded) => {
    runtime = loaded
    return loaded
  })
  return runtimePromise
}

onAccountSwitch(() => {
  accountGeneration += 1
  heldComments.clear()
  if (runtime) runtime.clearAgentProposalCommentCreations()
  else statusStore.publish(IDLE_REVISIONED_MUTATION)
})

export const heldAgentProposalCommentIntent = (
  agentId: string,
  proposalId: string,
): AgentProposalCommentCreationIntent | null =>
  heldComments.get(proposalKey(agentId, proposalId))?.intent ?? null

export function enqueueAgentProposalCommentCreation(input: {
  tenantId: string
  agentId: string
  proposalId: string
  body: string
}): Promise<RevisionedMutationOutcome> {
  const key = proposalKey(input.agentId, input.proposalId)
  const existing = heldComments.get(key)
  if (existing) return existing.result

  const issuedGeneration = accountGeneration
  const intent: AgentProposalCommentCreationIntent = {
    ...input,
    body: input.body.trim().slice(0, WORK_ITEM_COMMENT_MAX),
    intentId: crypto.randomUUID(),
  }
  const result = loadRuntime().then((loaded) =>
    issuedGeneration === accountGeneration
      ? loaded.enqueueAgentProposalCommentCreationRuntime(intent)
      : 'discarded' as const,
  )
  heldComments.set(key, { intent, result })
  statusStore.refresh()
  const release = (): void => {
    if (issuedGeneration !== accountGeneration) return
    if (heldComments.get(key)?.result !== result) return
    heldComments.delete(key)
    statusStore.refresh()
  }
  void result.then(release, release)
  return result
}

export const retryAgentProposalCommentCreation = (): void => { runtime?.retryAgentProposalCommentCreationRuntime() }
export const discardAgentProposalCommentCreation = (): void => { runtime?.discardAgentProposalCommentCreationRuntime() }
export const useAgentProposalCommentCreationStatus = statusStore.useStatus
