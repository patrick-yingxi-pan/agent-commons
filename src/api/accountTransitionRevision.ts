import type { AuthAccount, Identity } from '../../contract/index.ts'

export type AccountTransitionTarget =
  | { kind: 'switch-account'; sourceUserId: string | null; targetUserId: string; targetName: string }
  | { kind: 'sign-out'; sourceUserId: string; sourceName: string; all: boolean }
  | { kind: 'forget-account'; sourceUserId: string | null; targetUserId: string; targetName: string }

export type AccountTransitionIntent = AccountTransitionTarget & { intentId: string }

export interface AccountTransitionTruth {
  identity: Identity
  accounts: AuthAccount[]
}

export type AccountTransitionTerminal =
  | { kind: 'identity'; identity: Identity | null; reason: 'desired' | 'superseded' }
  | { kind: 'forgotten'; userId: string; reason: 'desired' }

const currentSessionUserId = (identity: Identity): string | null =>
  identity.via === 'session' ? identity.user.id : null

/** Classify only exact server truth. `null` means the original source still
 * owns the transition and the requested effect is absent, so Retry is safe.
 * Any other current identity supersedes the intent and must never receive it. */
export function accountTransitionTerminal(
  intent: AccountTransitionIntent,
  truth: AccountTransitionTruth,
): AccountTransitionTerminal | null {
  const currentUserId = currentSessionUserId(truth.identity)
  const hasAccount = (userId: string): boolean => truth.accounts.some((account) => account.user.id === userId)

  if (intent.kind === 'switch-account') {
    if (currentUserId === intent.targetUserId) {
      return { kind: 'identity', identity: truth.identity, reason: 'desired' }
    }
    if (currentUserId === intent.sourceUserId) return null
    return { kind: 'identity', identity: currentUserId ? truth.identity : null, reason: 'superseded' }
  }

  if (intent.kind === 'sign-out') {
    if (currentUserId === intent.sourceUserId) return null
    if (currentUserId !== null) {
      return { kind: 'identity', identity: truth.identity, reason: 'superseded' }
    }
    const desired = !hasAccount(intent.sourceUserId) && (!intent.all || truth.accounts.length === 0)
    return { kind: 'identity', identity: null, reason: desired ? 'desired' : 'superseded' }
  }

  if (currentUserId !== intent.sourceUserId) {
    return { kind: 'identity', identity: currentUserId ? truth.identity : null, reason: 'superseded' }
  }
  return hasAccount(intent.targetUserId)
    ? null
    : { kind: 'forgotten', userId: intent.targetUserId, reason: 'desired' }
}

export function accountTransitionResourceId(intent: AccountTransitionTarget): string {
  if (intent.kind === 'sign-out') return `account-transition:sign-out:${intent.sourceUserId}:${intent.all}`
  return `account-transition:${intent.kind}:${intent.sourceUserId ?? 'signed-out'}:${intent.targetUserId}`
}
