/** Tiny eager facade for acknowledgement-owned open-work posting. */
import { OPEN_WORK_FIELD_MAX, type PostOpenSubGoalRequest } from '../../contract/index.ts'
import { onAccountSwitch } from '../api'
import type { OpenWorkCreationIntent } from '../api/openWorkCreationCommands.ts'
import { openWorkCreationId } from '../api/openWorkCreationIdentity.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'
import {
  IDLE_REVISIONED_MUTATION,
  type RevisionedMutationOutcome,
} from './revisionedMutationCore.ts'

export interface OpenWorkCreationResult {
  outcome: RevisionedMutationOutcome
  workItemId: string
}

interface HeldOpenWork {
  intent: OpenWorkCreationIntent
  result: Promise<OpenWorkCreationResult>
}

const statusStore = createMutationStatusStore()
const heldProjects = new Map<string, HeldOpenWork>()
let accountGeneration = 0
export const publishOpenWorkCreationStatus = statusStore.publish

type Runtime = typeof import('./openWorkCreationMutationRuntime.ts')
let runtime: Runtime | null = null
let runtimePromise: Promise<Runtime> | null = null
const loadRuntime = (): Promise<Runtime> => {
  runtimePromise ??= import('./openWorkCreationMutationRuntime.ts').then((loaded) => {
    runtime = loaded
    return loaded
  })
  return runtimePromise
}

onAccountSwitch(() => {
  accountGeneration += 1
  heldProjects.clear()
  if (runtime) runtime.clearOpenWorkCreations()
  else statusStore.publish(IDLE_REVISIONED_MUTATION)
})

export const heldOpenWorkIntent = (projectId: string): OpenWorkCreationIntent | null =>
  heldProjects.get(projectId)?.intent ?? null

export function enqueueOpenWorkCreation(input: {
  tenantId: string
  projectId: string
  request: PostOpenSubGoalRequest
}): Promise<OpenWorkCreationResult> {
  const existing = heldProjects.get(input.projectId)
  if (existing) return existing.result

  const request: PostOpenSubGoalRequest = {
    subGoal: input.request.subGoal.trim().slice(0, OPEN_WORK_FIELD_MAX),
    type: input.request.type,
    target: input.request.target.trim().slice(0, OPEN_WORK_FIELD_MAX),
    ...(input.request.note?.trim()
      ? { note: input.request.note.trim().slice(0, OPEN_WORK_FIELD_MAX) }
      : {}),
  }
  const issuedGeneration = accountGeneration
  const intent: OpenWorkCreationIntent = {
    tenantId: input.tenantId,
    projectId: input.projectId,
    request,
    intentId: crypto.randomUUID(),
  }
  const outcome = loadRuntime().then((loaded) =>
    issuedGeneration === accountGeneration
      ? loaded.enqueueOpenWorkCreationRuntime(intent)
      : 'discarded' as const,
  )
  const result = Promise.all([
    outcome,
    openWorkCreationId(input.tenantId, input.projectId, intent.intentId),
  ]).then(([settled, workItemId]) => ({ outcome: settled, workItemId }))
  heldProjects.set(input.projectId, { intent, result })
  statusStore.refresh()
  const release = (): void => {
    if (issuedGeneration !== accountGeneration) return
    if (heldProjects.get(input.projectId)?.result !== result) return
    heldProjects.delete(input.projectId)
    statusStore.refresh()
  }
  void result.then(release, release)
  return result
}

export const retryOpenWorkCreation = (): void => { runtime?.retryOpenWorkCreationRuntime() }
export const discardOpenWorkCreation = (): void => { runtime?.discardOpenWorkCreationRuntime() }
export const useOpenWorkCreationStatus = statusStore.useStatus
