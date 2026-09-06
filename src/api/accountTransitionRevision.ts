import type { AuthAccount, Identity } from '../../contract/index.ts'

export type AccountTransitionTarget =
  | { kind: 'switch-account'; sourceUserId: string | null; targetUserId: string; targetName: string }
  | { kind: 'sign-out'; sourceUserId: string; sourceName: string; all: boolean }
  | { kind: 'forget-account'; sourceUserId: string | null; targetUserId: string; targetName: string }
  | { kind: 'credential-sign-in'; sourceUserId: string | null; email: string; password: string }
  | { kind: 'credential-sign-up'; sourceUserId: string | null; name: string; email: string; password: string }

export type AccountTransitionIntent = AccountTransitionTarget & { intentId: string }
export type CredentialAccountTransitionTarget = Extract<
  AccountTransitionTarget,
  { kind: 'credential-sign-in' | 'credential-sign-up' }
>
export type CredentialAccountTransitionRequest =
  | { kind: 'credential-sign-in'; email: string; password: string }
  | { kind: 'credential-sign-up'; name: string; email: string; password: string }
export type VisibleAccountTransition = Exclude<
  AccountTransitionTarget,
  CredentialAccountTransitionTarget
> | { kind: CredentialAccountTransitionTarget['kind'] }

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

  if (intent.kind === 'credential-sign-in' || intent.kind === 'credential-sign-up') {
    const desired = truth.identity.via === 'session' &&
      truth.identity.user.email?.trim().toLowerCase() === intent.email.trim().toLowerCase()
    if (desired) return { kind: 'identity', identity: truth.identity, reason: 'desired' }
    if (currentUserId === intent.sourceUserId) return null
    return { kind: 'identity', identity: currentUserId ? truth.identity : null, reason: 'superseded' }
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
  if (intent.kind === 'credential-sign-in' || intent.kind === 'credential-sign-up') {
    return `account-transition:${intent.kind}:${intent.sourceUserId ?? 'signed-out'}`
  }
  return `account-transition:${intent.kind}:${intent.sourceUserId ?? 'signed-out'}:${intent.targetUserId}`
}

/** Credential transition details remain private to the in-memory command. UI
 * consumers can identify the held form without receiving email or password. */
export function visibleAccountTransition(intent: AccountTransitionIntent): VisibleAccountTransition {
  if (intent.kind === 'credential-sign-in' || intent.kind === 'credential-sign-up') {
    return { kind: intent.kind }
  }
  const { intentId: _intentId, ...visible } = intent
  return visible
}
