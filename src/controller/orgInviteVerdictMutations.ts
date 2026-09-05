/** Eager held-state facade for acknowledgement-owned invitation decisions. */
import type { MyInvite } from '../../contract/index.ts'
import { onAccountSwitch } from '../api'
import type {
  OrgInviteVerdict,
  OrgInviteVerdictIntent,
} from '../api/orgInviteVerdictRevision.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'
import {
  IDLE_REVISIONED_MUTATION,
  type RevisionedMutationOutcome,
} from './revisionedMutationCore.ts'

interface HeldVerdict {
  intent: OrgInviteVerdictIntent
  result: Promise<RevisionedMutationOutcome>
}

const statusStore = createMutationStatusStore()
const heldVerdicts = new Map<string, HeldVerdict>()
let accountGeneration = 0
export const publishOrgInviteVerdictStatus = statusStore.publish

type Runtime = typeof import('./orgInviteVerdictMutationRuntime.ts')
let runtime: Runtime | null = null
let runtimePromise: Promise<Runtime> | null = null
const loadRuntime = (): Promise<Runtime> => {
  runtimePromise ??= import('./orgInviteVerdictMutationRuntime.ts').then((loaded) => {
    runtime = loaded
    return loaded
  })
  return runtimePromise
}

onAccountSwitch(() => {
  accountGeneration += 1
  heldVerdicts.clear()
  if (runtime) runtime.clearOrgInviteVerdicts()
  else statusStore.publish(IDLE_REVISIONED_MUTATION)
})

export const heldOrgInviteVerdictIntents = (): OrgInviteVerdictIntent[] =>
  [...heldVerdicts.values()].map((held) => held.intent)

export const heldOrgInviteVerdict = (inviteId: string): OrgInviteVerdictIntent | undefined =>
  heldVerdicts.get(inviteId)?.intent

export function enqueueOrgInviteVerdict(
  invitation: MyInvite,
  verdict: OrgInviteVerdict,
): Promise<RevisionedMutationOutcome> {
  const existing = heldVerdicts.get(invitation.id)
  if (existing) return existing.result
  const issuedGeneration = accountGeneration
  const intent: OrgInviteVerdictIntent = {
    invitation: { ...invitation },
    verdict,
    intentId: crypto.randomUUID(),
  }
  const result = loadRuntime().then((loaded) =>
    issuedGeneration === accountGeneration
      ? loaded.enqueueOrgInviteVerdictRuntime(intent)
      : 'discarded' as const,
  )
  heldVerdicts.set(invitation.id, { intent, result })
  statusStore.refresh()
  const release = (): void => {
    if (issuedGeneration !== accountGeneration) return
    if (heldVerdicts.get(invitation.id)?.result !== result) return
    heldVerdicts.delete(invitation.id)
    statusStore.refresh()
  }
  void result.then(release, release)
  return result
}

export const retryOrgInviteVerdict = (): void => { runtime?.retryOrgInviteVerdictRuntime() }
export const discardOrgInviteVerdict = (): void => { runtime?.discardOrgInviteVerdictRuntime() }
export const useOrgInviteVerdictStatus = statusStore.useStatus
