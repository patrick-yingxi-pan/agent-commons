/** Tiny eager facade for acknowledgement-owned Contribution creation. */
import type { OpenContributionRequest } from '../../contract/index.ts'
import { onAccountSwitch } from '../api/account.ts'
import { contributionCreationId } from '../api/contributionCreationIdentity.ts'
import type { ContributionCreationIntent } from '../api/contributionCreationRevision.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'
import { createRetryableRuntimeLoader } from './retryableRuntimeLoader.ts'
import {
  editableContributionDraft,
  snapshotContributionCreation,
  submittedContributionDraft,
  type ContributionCreationDraft,
} from './contributionCreationSnapshot.ts'
import {
  IDLE_REVISIONED_MUTATION,
  type RevisionedMutationOutcome,
} from './revisionedMutationCore.ts'

const statusStore = createMutationStatusStore()
const heldProjects = new Map<string, number>()
const heldIntents = new Map<string, ContributionCreationIntent[]>()
export type { ContributionCreationDraft } from './contributionCreationSnapshot.ts'
const drafts = new Map<string, Map<string, ContributionCreationDraft>>()
const appliedListeners = new Set<(event: ContributionCreationApplied) => void>()
const appliedByItem = new Map<string, Map<string, ContributionCreationApplied>>()
let accountGeneration = 0
export const publishContributionCreationStatus = statusStore.publish

type Runtime = typeof import('./contributionCreationMutationRuntime.ts')
let runtime: Runtime | null = null
const loadRuntime = createRetryableRuntimeLoader<Runtime>(
  () => import('./contributionCreationMutationRuntime.ts'),
  (loaded) => { runtime = loaded },
)

onAccountSwitch(() => {
  accountGeneration += 1
  heldProjects.clear()
  heldIntents.clear()
  drafts.clear()
  appliedByItem.clear()
  if (runtime) runtime.clearContributionCreations()
  else statusStore.publish(IDLE_REVISIONED_MUTATION)
})

export const isContributionCreationHeld = (projectId: string): boolean =>
  (heldProjects.get(projectId) ?? 0) > 0

/** The exact work declaration remains available while its acknowledgement is
 * held, so a remounted work page can restore the submitted fields. */
export const heldContributionCreationIntent = (
  projectId: string,
  workItemId: string,
): ContributionCreationIntent | null =>
  heldIntents.get(projectId)?.find((intent) => intent.request.workItemId === workItemId) ?? null

export interface ContributionCreationApplied {
  tenantId: string
  projectId: string
  workItemId: string
  intentId: string
  title: string
  summary: string
  contributionId: string
  initialMcpProposal?: true
}

/** An acknowledged navigation receipt, not a second Contribution registry.
 * Returning after completion may offer this exact door without matching titles
 * or unexpectedly navigating away from the work item. */
export const latestAppliedContributionCreation = (
  projectId: string,
  workItemId: string,
): ContributionCreationApplied | null => appliedByItem.get(projectId)?.get(workItemId) ?? null

export const contributionCreationDraft = (
  projectId: string,
  workItemId: string,
): ContributionCreationDraft | null => drafts.get(projectId)?.get(workItemId) ?? null

export function rememberContributionCreationDraft(
  projectId: string,
  workItemId: string,
  draft: Omit<ContributionCreationDraft, 'intentId'>,
): void {
  const existing = drafts.get(projectId) ?? new Map<string, ContributionCreationDraft>()
  if (existing.get(workItemId)?.intentId) return
  existing.set(workItemId, snapshotContributionCreation(draft))
  drafts.set(projectId, existing)
  statusStore.refresh()
}

/** Explicit local cancellation never dismisses a submitted request or another
 * editor's form. Model history and server Contributions are unaffected. */
export function clearContributionCreationDraft(projectId: string, workItemId: string, kind: 'manual' | 'mcp'): boolean {
  const projectDrafts = drafts.get(projectId)
  const draft = projectDrafts?.get(workItemId)
  if (isContributionCreationHeld(projectId) || draft?.intentId) return false
  if (draft && Boolean(draft.mcpDraft || draft.initialMcpProposal) !== (kind === 'mcp')) return false
  projectDrafts?.delete(workItemId)
  if (projectDrafts?.size === 0) drafts.delete(projectId)
  statusStore.refresh()
  return true
}

export function subscribeContributionCreationApplied(
  listener: (event: ContributionCreationApplied) => void,
): () => void {
  appliedListeners.add(listener)
  return () => appliedListeners.delete(listener)
}

export interface ContributionCreationResult {
  outcome: RevisionedMutationOutcome
  contributionId: string
  intentId: string
}

export function enqueueContributionCreation(input: {
  tenantId: string
  projectId: string
  request: OpenContributionRequest
}): Promise<ContributionCreationResult> {
  const issuedGeneration = accountGeneration
  const intent: ContributionCreationIntent = Object.freeze({
    ...input,
    request: snapshotContributionCreation(input.request),
    intentId: crypto.randomUUID(),
  })
  heldProjects.set(input.projectId, (heldProjects.get(input.projectId) ?? 0) + 1)
  const projectIntents = heldIntents.get(input.projectId) ?? []
  projectIntents.push(intent)
  heldIntents.set(input.projectId, projectIntents)
  if (intent.request.workItemId) {
    const workItemId = intent.request.workItemId
    appliedByItem.get(input.projectId)?.delete(workItemId)
    const projectDrafts = drafts.get(input.projectId) ?? new Map<string, ContributionCreationDraft>()
    projectDrafts.set(workItemId, submittedContributionDraft(intent.request, intent.intentId, projectDrafts.get(workItemId)))
    drafts.set(input.projectId, projectDrafts)
  }
  statusStore.refresh()
  const outcome = loadRuntime().then((loaded) =>
    issuedGeneration === accountGeneration
      ? loaded.enqueueContributionCreationRuntime(intent)
      : 'discarded' as const,
    // Failed module admission did not send a request. Release only that local
    // hold and retain the complete editable form; another click may load again.
    () => 'discarded' as const,
  )
  const result = Promise.all([
    outcome,
    contributionCreationId(input.tenantId, input.projectId, intent.intentId),
  ]).then(([settled, contributionId]) => {
    const workItemId = intent.request.workItemId
    if (issuedGeneration === accountGeneration && workItemId) {
      const projectDrafts = drafts.get(input.projectId)
      const draft = projectDrafts?.get(workItemId)
      if (draft?.intentId === intent.intentId) {
        if (settled === 'applied') {
          projectDrafts!.delete(workItemId)
          if (projectDrafts!.size === 0) drafts.delete(input.projectId)
          const event: ContributionCreationApplied = {
            tenantId: intent.tenantId,
            projectId: intent.projectId,
            workItemId,
            intentId: intent.intentId,
            title: intent.request.title,
            summary: intent.request.summary ?? '',
            contributionId,
            ...(intent.request.initialMcpProposal ? { initialMcpProposal: true as const } : {}),
          }
          const appliedItems = appliedByItem.get(intent.projectId) ?? new Map<string, ContributionCreationApplied>()
          appliedItems.set(workItemId, Object.freeze(event))
          appliedByItem.set(intent.projectId, appliedItems)
          for (const listener of appliedListeners) {
            try { listener(event) } catch { /* Observers cannot alter the mutation outcome. */ }
          }
        } else {
          projectDrafts!.set(workItemId, editableContributionDraft(draft))
        }
      }
    }
    return { outcome: settled, contributionId, intentId: intent.intentId }
  })
  void result.finally(() => {
    if (issuedGeneration !== accountGeneration) return
    const remaining = Math.max(0, (heldProjects.get(input.projectId) ?? 0) - 1)
    if (remaining === 0) heldProjects.delete(input.projectId)
    else heldProjects.set(input.projectId, remaining)
    const activeIntents = (heldIntents.get(input.projectId) ?? []).filter((candidate) => candidate !== intent)
    if (activeIntents.length === 0) heldIntents.delete(input.projectId)
    else heldIntents.set(input.projectId, activeIntents)
    statusStore.refresh()
  })
  return result
}

export const retryContributionCreation = (): void => { runtime?.retryContributionCreationRuntime() }
export const discardContributionCreation = (): void => { runtime?.discardContributionCreationRuntime() }
export const useContributionCreationStatus = statusStore.useStatus
