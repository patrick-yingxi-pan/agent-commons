/** Lazy transport and authoritative reconciliation for sharing changes. */
import type { Grant } from '../../contract/index.ts'
import { apiDelete, apiGet, apiPost } from './client.ts'
import { keys, paths } from './keys.ts'
import { invalidate, peek, setData } from './cache.ts'
import {
  grantMutationRealized,
  grantMutationSubject,
  type GrantMutationBaseline,
  type GrantMutationIntent,
} from './grantRevision.ts'

export type { GrantMutationBaseline, GrantMutationIntent } from './grantRevision.ts'

export function grantMutationBaseline(intent: GrantMutationIntent): GrantMutationBaseline {
  const subject = grantMutationSubject(intent)
  const grants = peek<Grant[]>(keys.grants(subject.kind, subject.id))
  return { grants: grants ?? [], known: grants !== undefined }
}

export async function applyGrantMutation(intent: GrantMutationIntent, idempotencyKey: string): Promise<void> {
  const subject = grantMutationSubject(intent)
  const key = keys.grants(subject.kind, subject.id)
  if (intent.kind === 'upsert') {
    await apiPost<Grant>(paths.grantCreate(), intent.request, { idempotencyKey })
    // A Grant has no revision yet. Never let a delayed row acknowledgement
    // overwrite a newer cross-window rotation; ask the roster query for the
    // current complete truth instead.
    invalidate(key)
    return
  }
  await apiDelete(paths.grantRevoke(intent.grant.id), undefined, { idempotencyKey })
  invalidate(key)
}

export async function reconcileGrantMutation(
  intent: GrantMutationIntent,
  baseline: GrantMutationBaseline,
): Promise<boolean> {
  const subject = grantMutationSubject(intent)
  const incoming = await apiGet<Grant[]>(paths.grants(subject.kind, subject.id))
  setData(keys.grants(subject.kind, subject.id), incoming)
  // Heal a read that crossed a still-newer ambient grant event. The immediate
  // snapshot makes recovery coherent; this follow-up wins once it returns.
  invalidate(keys.grants(subject.kind, subject.id))
  return grantMutationRealized(intent, baseline, incoming)
}
