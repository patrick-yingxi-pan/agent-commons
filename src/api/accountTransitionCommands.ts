import type { ApiError, AuthAccount, Identity } from '../../contract/index.ts'
import { API_BASE, ApiRequestError } from './client.ts'
import { paths } from './keys.ts'
import {
  accountTransitionTerminal,
  type AccountTransitionIntent,
  type AccountTransitionTerminal,
  type AccountTransitionTruth,
} from './accountTransitionRevision.ts'

const transitionSource = (userId: string | null): string => userId ? `session:${userId}` : 'unsigned'

async function rawRequest(run: () => Promise<Response>): Promise<Response> {
  let response: Response
  try {
    response = await run()
  } catch (error) {
    throw new ApiRequestError('internal', error instanceof Error ? error.message : 'Network error', 0)
  }
  if (response.ok) return response
  const payload = await response.json().catch(() => undefined) as ApiError | undefined
  throw new ApiRequestError(
    payload?.error.code ?? 'internal',
    payload?.error.message ?? (response.statusText || `Request failed (${response.status})`),
    response.status,
  )
}

async function rawJson<T>(response: Response): Promise<T> {
  if (response.status !== 200) {
    throw new ApiRequestError('internal', 'The server did not return exact identity truth.', 0)
  }
  try {
    return await response.json() as T
  } catch {
    throw new ApiRequestError('internal', 'The server returned an unreadable identity response.', 0)
  }
}

/** Credential forms can mount while an identity reset is still replacing the
 * query cache. Read the cookie authority directly immediately before binding
 * the command; the route precondition closes any later cross-tab race. */
export async function readAccountTransitionSource(): Promise<string | null> {
  const identity = await rawJson<Identity>(await rawRequest(() => fetch(`${API_BASE}${paths.me}`)))
  return identity.via === 'session' ? identity.user.id : null
}

async function credentialIdentity(response: Response, expectedEmail: string): Promise<AccountTransitionTerminal> {
  if (response.status !== 200) {
    throw new ApiRequestError('internal', 'The server did not acknowledge credential entry.', 0)
  }
  const identity = await response.json().catch(() => undefined) as Identity | undefined
  if (
    identity?.via !== 'session' ||
    identity.user.email?.trim().toLowerCase() !== expectedEmail.trim().toLowerCase()
  ) {
    throw new ApiRequestError('internal', 'The server did not confirm the signed-in account.', 0)
  }
  return { kind: 'identity', identity, reason: 'desired' }
}

export async function applyAccountTransition(
  intent: AccountTransitionIntent,
): Promise<AccountTransitionTerminal> {
  if (intent.kind === 'credential-sign-in' || intent.kind === 'credential-sign-up') {
    const signup = intent.kind === 'credential-sign-up'
    const response = await rawRequest(() => fetch(`${API_BASE}${signup ? paths.authSignup : paths.authLogin}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Account-Transition-Source': transitionSource(intent.sourceUserId),
        ...(signup ? { 'Idempotency-Key': intent.intentId } : {}),
      },
      body: JSON.stringify(signup
        ? { name: intent.name, email: intent.email, password: intent.password }
        : { email: intent.email, password: intent.password }),
    }))
    return credentialIdentity(response, intent.email)
  }
  if (intent.kind === 'switch-account') {
    const response = await rawRequest(() => fetch(`${API_BASE}${paths.authSession}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Account-Transition-Source': transitionSource(intent.sourceUserId),
      },
      body: JSON.stringify({ userId: intent.targetUserId }),
    }))
    if (response.status !== 200) {
      throw new ApiRequestError('internal', 'The server did not acknowledge the selected account.', 0)
    }
    const identity = await response.json().catch(() => undefined) as Identity | undefined
    if (identity?.via !== 'session' || identity.user.id !== intent.targetUserId) {
      throw new ApiRequestError('internal', 'The server did not confirm the selected account.', 0)
    }
    return { kind: 'identity', identity, reason: 'desired' }
  }
  if (intent.kind === 'sign-out') {
    const response = await rawRequest(() => fetch(`${API_BASE}${paths.authSession}${intent.all ? '?all=1' : ''}`, {
      method: 'DELETE',
      headers: { 'X-Account-Transition-Source': transitionSource(intent.sourceUserId) },
    }))
    if (response.status !== 204) {
      throw new ApiRequestError('internal', 'The server did not acknowledge sign-out.', 0)
    }
    return { kind: 'identity', identity: null, reason: 'desired' }
  }
  const response = await rawRequest(() => fetch(`${API_BASE}${paths.authAccount(intent.targetUserId)}`, {
    method: 'DELETE',
    headers: { 'X-Account-Transition-Source': transitionSource(intent.sourceUserId) },
  }))
  if (response.status !== 204) {
    throw new ApiRequestError('internal', 'The server did not acknowledge forgetting that account.', 0)
  }
  return { kind: 'forgotten', userId: intent.targetUserId, reason: 'desired' }
}

/** Read the two browser-private authorities directly. Generic API requests are
 * intentionally unsuitable here: this command is repairing the identity
 * generation they guard, and replaying an idempotency cache could restore an
 * obsolete Set-Cookie header. */
export async function reconcileAccountTransition(
  intent: AccountTransitionIntent,
): Promise<AccountTransitionTerminal | null> {
  const identityResponse = await rawRequest(() => fetch(`${API_BASE}${paths.me}`))
  const accountsResponse = await rawRequest(() => fetch(`${API_BASE}${paths.authAccounts}`))
  const truth: AccountTransitionTruth = {
    identity: await rawJson<Identity>(identityResponse),
    accounts: await rawJson<AuthAccount[]>(accountsResponse),
  }
  const currentRows = truth.accounts.filter((account) => account.current)
  const sessionUserId = truth.identity.via === 'session' ? truth.identity.user.id : null
  const consistent = sessionUserId === null
    ? currentRows.length === 0
    : currentRows.length === 1 && currentRows[0]?.user.id === sessionUserId
  if (!consistent) {
    throw new ApiRequestError('internal', 'Identity changed while it was being confirmed.', 0)
  }
  return accountTransitionTerminal(intent, truth)
}
