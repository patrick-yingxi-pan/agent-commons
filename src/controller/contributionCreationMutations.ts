/** Tiny eager facade for acknowledgement-owned Contribution creation. */
import type { OpenContributionRequest } from '../../contract/index.ts'
import { onAccountSwitch } from '../api/account.ts'
import { contributionCreationId } from '../api/contributionCreationIdentity.ts'
import type { ContributionCreationIntent } from '../api/contributionCreationRevision.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'
import {
  IDLE_REVISIONED_MUTATION,
  type RevisionedMutationOutcome,
} from './revisionedMutationCore.ts'

const statusStore = createMutationStatusStore()
const heldProjects = new Map<string, number>()
const heldIntents = new Map<string, ContributionCreationIntent[]>()
export interface ContributionCreationDraft {
  readonly title: string
  readonly summary: string
  readonly intentId?: string
}
const drafts = new Map<string, Map<string, ContributionCreationDraft>>()
const appliedListeners = new Set<(event: ContributionCreationApplied) => void>()
let accountGeneration = 0
export const publishContributionCreationStatus = statusStore.publish

type Runtime = typeof import('./contributionCreationMutationRuntime.ts')
let runtime: Runtime | null = null
let runtimePromise: Promise<Runtime> | null = null
const loadRuntime = (): Promise<Runtime> => {
  runtimePromise ??= import('./contributionCreationMutationRuntime.ts').then((loaded) => {
    runtime = loaded
    return loaded
  })
  return runtimePromise
}

onAccountSwitch(() => {
  accountGeneration += 1
  heldProjects.clear()
  heldIntents.clear()
  drafts.clear()
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
}

export const contributionCreationDraft = (
  projectId: string,
  workItemId: string,
): ContributionCreationDraft | null => drafts.get(projectId)?.get(workItemId) ?? null

export function rememberContributionCreationDraft(
  projectId: string,
  workItemId: string,
  draft: Pick<ContributionCreationDraft, 'title' | 'summary'>,
): void {
  const existing = drafts.get(projectId) ?? new Map<string, ContributionCreationDraft>()
  if (existing.get(workItemId)?.intentId) return
  existing.set(workItemId, { title: draft.title, summary: draft.summary })
  drafts.set(projectId, existing)
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
    request: Object.freeze({ ...input.request }),
    intentId: crypto.randomUUID(),
  })
  heldProjects.set(input.projectId, (heldProjects.get(input.projectId) ?? 0) + 1)
  const projectIntents = heldIntents.get(input.projectId) ?? []
  projectIntents.push(intent)
  heldIntents.set(input.projectId, projectIntents)
  if (intent.request.workItemId) {
    const workItemId = intent.request.workItemId
    const projectDrafts = drafts.get(input.projectId) ?? new Map<string, ContributionCreationDraft>()
    projectDrafts.set(workItemId, {
      title: intent.request.title,
      summary: intent.request.summary ?? '',
      intentId: intent.intentId,
    })
    drafts.set(input.projectId, projectDrafts)
  }
  statusStore.refresh()
  const outcome = loadRuntime().then((loaded) =>
    issuedGeneration === accountGeneration
      ? loaded.enqueueContributionCreationRuntime(intent)
      : 'discarded' as const,
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
          }
          for (const listener of appliedListeners) {
            try { listener(event) } catch { /* Observers cannot alter the mutation outcome. */ }
          }
        } else {
          projectDrafts!.set(workItemId, {
            title: draft.title,
            summary: draft.summary,
          })
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
