import type { Delegation, EscalationTrigger } from '../../contract/index.ts'

export interface DelegationPolicyDraft {
  expectedRevision: number
  policy: string
  mode: 'draft' | 'decide'
  escalation: EscalationTrigger[]
  expiryInput: string
  expiryAt?: number
  expiryChanged: boolean
  needsReview: boolean
}

const drafts = new Map<string, DelegationPolicyDraft>()
const listeners = new Set<() => void>()
let generation = 0
const publish = () => { generation += 1; for (const listener of listeners) listener() }
export const delegationPolicyDraftGeneration = (): number => generation
export function subscribeDelegationPolicyDrafts(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
const key = (delegation: Pick<Delegation, 'projectId' | 'id'>): string =>
  JSON.stringify([delegation.projectId, delegation.id])

function localExpiryInput(expiresAt?: number): string {
  if (expiresAt == null || !Number.isFinite(expiresAt)) return ''
  const date = new Date(expiresAt)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function readDelegationPolicyDraft(delegation: Delegation): DelegationPolicyDraft {
  const saved = drafts.get(key(delegation))
  return saved ? { ...saved, escalation: [...saved.escalation] } : {
    expectedRevision: delegation.revision ?? 0,
    policy: delegation.policy ?? '',
    mode: delegation.mode,
    escalation: [...new Set<EscalationTrigger>(['effectful', ...delegation.escalation])],
    expiryInput: localExpiryInput(delegation.expiresAt),
    ...(delegation.expiresAt === undefined ? {} : { expiryAt: delegation.expiresAt }),
    expiryChanged: false,
    needsReview: false,
  }
}

export function hasDelegationPolicyDraft(delegation: Pick<Delegation, 'projectId' | 'id'>): boolean {
  return drafts.has(key(delegation))
}

export function writeDelegationPolicyDraft(
  delegation: Pick<Delegation, 'projectId' | 'id'>,
  draft: DelegationPolicyDraft,
): void {
  drafts.set(key(delegation), { ...draft, escalation: [...draft.escalation] })
  publish()
}

export function clearDelegationPolicyDraft(delegation: Pick<Delegation, 'projectId' | 'id'>): void {
  drafts.delete(key(delegation))
  publish()
}

export function clearDelegationPolicyDrafts(): void {
  drafts.clear()
  publish()
}

/** Settlement lives outside a mounted editor: navigation must not strand a
 * saved draft, and dismissal must retain review intent in the returning pane. */
export function settleDelegationPolicyDraft(
  delegation: Pick<Delegation, 'projectId' | 'id'>,
  applied: boolean,
): void {
  if (applied) return clearDelegationPolicyDraft(delegation)
  const saved = drafts.get(key(delegation))
  if (saved) {
    drafts.set(key(delegation), { ...saved, needsReview: true })
    publish()
  }
}
