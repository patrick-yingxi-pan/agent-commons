/** Tiny eager facade for acknowledgement-gated one-off Dispatch creation. */
import { onAccountSwitch } from '../api/account.ts'
import type { DispatchIntent } from '../api/dispatchCommands'
import type { ProjectWorkDraftSource } from '../../contract/projectWorkDraft.ts'
import type { ProjectWorkMcpDraftSelection } from '../../contract/projectWorkMcpDraft.ts'
import {
  IDLE_REVISIONED_MUTATION,
  type RevisionedMutationOutcome,
} from './revisionedMutationCore'
import { createMutationStatusStore } from './mutationStatusStore'

const statusStore = createMutationStatusStore()
let heldCount = 0
let accountGeneration = 0
const heldIntents = new Map<string, DispatchIntent>()
export const publishDispatchMutationStatus = statusStore.publish

type Runtime = typeof import('./dispatchMutationRuntime')
let runtime: Runtime | null = null
let runtimePromise: Promise<Runtime> | null = null
const loadRuntime = (): Promise<Runtime> => {
  runtimePromise ??= import('./dispatchMutationRuntime').then((loaded) => {
    runtime = loaded
    return loaded
  })
  return runtimePromise
}

onAccountSwitch(() => {
  accountGeneration += 1
  heldCount = 0
  heldIntents.clear()
  if (runtime) runtime.clearDispatchMutations()
  else statusStore.publish(IDLE_REVISIONED_MUTATION)
})

export const isDispatchHeld = (): boolean => heldCount > 0

/** Reconstruct only the acknowledged-queue source for this exact Project item.
 * The private session id and unrelated Dispatch fields never leave the queue. */
export function heldProjectWorkDraftSelection(projectId: string, itemId: string): {
  projectWork: ProjectWorkDraftSource
  execution: DispatchIntent['execution']
  labels?: DispatchIntent['projectWorkLabels']
  mcpProposal?: ProjectWorkMcpDraftSelection
  mcpLabels?: DispatchIntent['mcpProposalLabels']
} | null {
  for (const intent of heldIntents.values()) {
    const source = intent.projectWork
    if (source?.projectId === projectId && source.itemId === itemId) {
      return {
        projectWork: { ...source },
        execution: { ...intent.execution },
        labels: intent.projectWorkLabels ? { ...intent.projectWorkLabels } : undefined,
        mcpProposal: intent.mcpProposal ? { ...intent.mcpProposal } : undefined,
        mcpLabels: intent.mcpProposalLabels ? { ...intent.mcpProposalLabels } : undefined,
      }
    }
  }
  return null
}

export function enqueueDispatch(
  input: Omit<DispatchIntent, 'intentId'>,
): Promise<RevisionedMutationOutcome> {
  const issuedGeneration = accountGeneration
  const intent: DispatchIntent = {
    ...input,
    execution: { ...input.execution },
    projectWork: input.projectWork ? { ...input.projectWork } : undefined,
    projectWorkLabels: input.projectWorkLabels ? { ...input.projectWorkLabels } : undefined,
    mcpProposal: input.mcpProposal ? { ...input.mcpProposal } : undefined,
    mcpProposalLabels: input.mcpProposalLabels ? { ...input.mcpProposalLabels } : undefined,
    intentId: crypto.randomUUID(),
  }
  heldIntents.set(intent.intentId, intent)
  heldCount += 1
  statusStore.refresh()
  const outcome = loadRuntime().then((loaded) =>
    issuedGeneration === accountGeneration
      ? loaded.enqueueDispatchMutationRuntime(intent)
      : 'discarded' as const,
  )
  void outcome.finally(() => {
    if (issuedGeneration !== accountGeneration) return
    heldIntents.delete(intent.intentId)
    heldCount = Math.max(0, heldCount - 1)
    statusStore.refresh()
  })
  return outcome
}

export const retryDispatchMutation = (): void => { runtime?.retryDispatchMutationRuntime() }
export const discardDispatchMutation = (): void => { runtime?.discardDispatchMutationRuntime() }
export const useDispatchMutationStatus = statusStore.useStatus
