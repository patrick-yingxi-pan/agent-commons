/** Eager held-state facade for owner-issued invitation actions. */
import type { OrgInviteRow } from '../../contract/index.ts'
import { onAccountSwitch } from '../api'
import type {
  OrgInviteIssueIntent,
  OrgInviteOwnerIntent,
  OrgInviteRevokeIntent,
} from '../api/orgInviteOwnerRevision.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'
import {
  IDLE_REVISIONED_MUTATION,
  type RevisionedMutationOutcome,
} from './revisionedMutationCore.ts'

interface HeldAction {
  intent: OrgInviteOwnerIntent
  result: Promise<RevisionedMutationOutcome>
}

const issueKey = (orgId: string): string => `issue:${orgId}`
const revokeKey = (inviteId: string): string => `revoke:${inviteId}`
const statusStore = createMutationStatusStore()
const heldActions = new Map<string, HeldAction>()
let accountGeneration = 0
export const publishOrgInviteOwnerStatus = statusStore.publish

type Runtime = typeof import('./orgInviteOwnerMutationRuntime.ts')
let runtime: Runtime | null = null
let runtimePromise: Promise<Runtime> | null = null
const loadRuntime = (): Promise<Runtime> => {
  runtimePromise ??= import('./orgInviteOwnerMutationRuntime.ts').then((loaded) => {
    runtime = loaded
    return loaded
  })
  return runtimePromise
}

onAccountSwitch(() => {
  accountGeneration += 1
  heldActions.clear()
  if (runtime) runtime.clearOrgInviteOwnerActions()
  else statusStore.publish(IDLE_REVISIONED_MUTATION)
})

function enqueueHeld(key: string, intent: OrgInviteOwnerIntent): Promise<RevisionedMutationOutcome> {
  const existing = heldActions.get(key)
  if (existing) return existing.result
  const issuedGeneration = accountGeneration
  const result = loadRuntime().then((loaded) =>
    issuedGeneration === accountGeneration
      ? loaded.enqueueOrgInviteOwnerRuntime(intent)
      : 'discarded' as const,
  )
  heldActions.set(key, { intent, result })
  statusStore.refresh()
  const release = (): void => {
    if (issuedGeneration !== accountGeneration) return
    if (heldActions.get(key)?.result !== result) return
    heldActions.delete(key)
    statusStore.refresh()
  }
  void result.then(release, release)
  return result
}

export function enqueueOrgInviteIssue(input: {
  orgId: string
  ownerUserId: string
  email: string
  baselineInvites: OrgInviteRow[]
}): Promise<RevisionedMutationOutcome> {
  const intent: OrgInviteIssueIntent = {
    kind: 'issue',
    orgId: input.orgId,
    ownerUserId: input.ownerUserId,
    request: { email: input.email.trim() },
    baselineInviteIds: input.baselineInvites.map((invitation) => invitation.id),
    intentId: crypto.randomUUID(),
  }
  return enqueueHeld(issueKey(input.orgId), intent)
}

export function enqueueOrgInviteRevoke(
  orgId: string,
  invitation: OrgInviteRow,
): Promise<RevisionedMutationOutcome> {
  const intent: OrgInviteRevokeIntent = {
    kind: 'revoke',
    orgId,
    invitation: { ...invitation },
    intentId: crypto.randomUUID(),
  }
  return enqueueHeld(revokeKey(invitation.id), intent)
}

export function heldOrgInviteIssue(orgId: string): OrgInviteIssueIntent | undefined {
  const intent = heldActions.get(issueKey(orgId))?.intent
  return intent?.kind === 'issue' ? intent : undefined
}

export function heldOrgInviteRevoke(inviteId: string): OrgInviteRevokeIntent | undefined {
  const intent = heldActions.get(revokeKey(inviteId))?.intent
  return intent?.kind === 'revoke' ? intent : undefined
}

export const heldOrgInviteRevokes = (orgId: string): OrgInviteRevokeIntent[] =>
  [...heldActions.values()]
    .map((held) => held.intent)
    .filter((intent): intent is OrgInviteRevokeIntent => intent.kind === 'revoke' && intent.orgId === orgId)

export const isOrgInviteOwnerActionHeld = (orgId: string): boolean =>
  [...heldActions.values()].some((held) => held.intent.orgId === orgId)

export const retryOrgInviteOwnerAction = (): void => { runtime?.retryOrgInviteOwnerRuntime() }
export const discardOrgInviteOwnerAction = (): void => { runtime?.discardOrgInviteOwnerRuntime() }
export const useOrgInviteOwnerStatus = statusStore.useStatus
