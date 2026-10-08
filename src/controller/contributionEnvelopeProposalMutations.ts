/** Eager held-state facade for acknowledgement-owned envelope proposals. */
import { onAccountSwitch } from '../api'
import type { ProposeEnvelopeRequest } from '../../contract/index.ts'
import type { ContributionEnvelopeProposalIntent } from '../api/contributionEnvelopeProposalCommands.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'
import { IDLE_REVISIONED_MUTATION, type RevisionedMutationOutcome } from './revisionedMutationCore.ts'

interface HeldProposal {
  intent: ContributionEnvelopeProposalIntent
  result: Promise<RevisionedMutationOutcome>
}

const statusStore = createMutationStatusStore()
const heldProposals = new Map<string, HeldProposal>()
let accountGeneration = 0
export const publishContributionEnvelopeProposalStatus = statusStore.publish

const contributionKey = (projectId: string, contributionId: string): string =>
  `${projectId}\0${contributionId}`

type Runtime = typeof import('./contributionEnvelopeProposalMutationRuntime.ts')
let runtime: Runtime | null = null
let runtimePromise: Promise<Runtime> | null = null
const loadRuntime = (): Promise<Runtime> => {
  runtimePromise ??= import('./contributionEnvelopeProposalMutationRuntime.ts').then((loaded) => {
    runtime = loaded
    return loaded
  })
  return runtimePromise
}

onAccountSwitch(() => {
  accountGeneration += 1
  heldProposals.clear()
  if (runtime) runtime.clearContributionEnvelopeProposals()
  else statusStore.publish(IDLE_REVISIONED_MUTATION)
})

export const heldContributionEnvelopeProposalIntent = (
  projectId: string,
  contributionId: string,
): ContributionEnvelopeProposalIntent | null =>
  heldProposals.get(contributionKey(projectId, contributionId))?.intent ?? null

export const isContributionEnvelopeProposalHeld = (
  projectId: string,
  contributionId: string,
): boolean => heldProposals.has(contributionKey(projectId, contributionId))

export function enqueueContributionEnvelopeProposal(input: {
  tenantId: string
  sourceUserId: string | null
  projectId: string
  contributionId: string
  expectedVersion: number
  lines: ProposeEnvelopeRequest['lines']
}): Promise<RevisionedMutationOutcome> {
  const key = contributionKey(input.projectId, input.contributionId)
  const existing = heldProposals.get(key)
  if (existing) return existing.result

  const issuedGeneration = accountGeneration
  const freezeDeep = <T,>(value: T): T => {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.values(value as Record<string, unknown>).forEach((child) => freezeDeep(child))
      Object.freeze(value)
    }
    return value
  }
  const lines = Object.freeze(input.lines.map((line) => freezeDeep({
    ...line,
    ...(line.mcp ? { mcp: { ...line.mcp, arguments: structuredClone(line.mcp.arguments) } } : {}),
  }))) as unknown as ProposeEnvelopeRequest['lines']
  const intent: ContributionEnvelopeProposalIntent = {
    ...input,
    lines,
    intentId: crypto.randomUUID(),
  }
  const result = loadRuntime().then((loaded) =>
    issuedGeneration === accountGeneration
      ? loaded.enqueueContributionEnvelopeProposalRuntime(intent)
      : 'discarded' as const,
  )
  heldProposals.set(key, { intent, result })
  statusStore.refresh()
  const release = (): void => {
    if (issuedGeneration !== accountGeneration) return
    if (heldProposals.get(key)?.result !== result) return
    heldProposals.delete(key)
    statusStore.refresh()
  }
  void result.then(release, release)
  return result
}

export const retryContributionEnvelopeProposal = (): void => { runtime?.retryContributionEnvelopeProposalRuntime() }
export const discardContributionEnvelopeProposal = (): void => { runtime?.discardContributionEnvelopeProposalRuntime() }
export const useContributionEnvelopeProposalStatus = statusStore.useStatus
