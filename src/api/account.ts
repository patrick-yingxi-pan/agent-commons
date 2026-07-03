/** ── The active account (multi-account design §6.1–6.2) ─────────────────────
 *  One active identity per client, switched in place; null = no override
 *  (today's behavior — the backend's default identity). The two transport seams
 *  (`client.ts` fetch wrapper, `events.ts` stream URL) read it here; nothing
 *  else knows how identity rides the wire.
 *
 *  Framework-free (no React, no import.meta.env) so `node --test` can lock the
 *  policy helpers directly. Storage access is guarded — under node (tests)
 *  there is no localStorage and the module degrades to in-memory state.
 *
 *  Two guards make switching safe (invariant I5 — no cross-account contamination):
 *  • the GENERATION counter: every request captures it at issue time; a response
 *    landing after a switch is dropped on the floor;
 *  • the IDENTITY ECHO: the server names the tenant it resolved on every
 *    response (`x-resolved-tenant`); a mismatch is dropped loudly. */

export interface Account {
  userId: string
  tenantId: string
}

const STORAGE_KEY = 'account.active'

/** Browser-only storage: under node (tests) even TOUCHING the experimental
 *  global localStorage warns, so gate on `window` before any access. */
const hasStorage = typeof window !== 'undefined'

function readStored(): Account | null {
  if (!hasStorage) return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Account
    return parsed && typeof parsed.userId === 'string' && typeof parsed.tenantId === 'string' ? parsed : null
  } catch {
    return null // no localStorage (node) or corrupt value — no override
  }
}

let account: Account | null = readStored()
let generation = 0
const listeners = new Set<() => void>()

/** The identity this client is currently acting as (null = backend default). */
export function activeAccount(): Account | null {
  return account
}

/** Bumped on every switch — the staleness fence for in-flight responses. */
export function accountGeneration(): number {
  return generation
}

/** Switch the active account. The single choreography point: bump the
 *  generation (in-flight responses become droppable), persist the choice, then
 *  notify subscribers — events.ts reopens its stream as the new identity and
 *  the app layer resets the cache. Idempotent for a same-account no-op. */
export function switchAccount(next: Account | null): void {
  if (account?.userId === next?.userId && account?.tenantId === next?.tenantId) return
  account = next
  generation += 1
  if (hasStorage) {
    try {
      if (next) localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      else localStorage.removeItem(STORAGE_KEY)
    } catch {
      /* private mode / quota: in-memory only */
    }
  }
  for (const fn of listeners) fn()
}

/** Subscribe to switches (events.ts stream reconnect; the controller's reset).
 *  Doubles as the `useSyncExternalStore` subscribe for the chip UI. */
export function onAccountSwitch(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// ── Pure policy helpers (locked by tests/account-guard.test.ts) ──────────────

/** The identity headers a request carries for an account (none = no override —
 *  the backend resolves its default, exactly as before this layer existed). */
export function accountHeaders(acct: Account | null): Record<string, string> {
  return acct ? { 'x-user-id': acct.userId, 'x-tenant-id': acct.tenantId } : {}
}

/** The identity query params the events stream carries (EventSource can't set
 *  headers — design §5.5). Returns [] when no override is active. */
export function accountQuery(acct: Account | null): Array<[string, string]> {
  return acct
    ? [
        ['user', acct.userId],
        ['tenant', acct.tenantId],
      ]
    : []
}

/** Whether a response that just landed must be DROPPED (invariant I5):
 *  - the account generation moved while it was in flight (switched away), or
 *  - the server's identity echo names a different tenant than the account this
 *    client believes it's acting as (an identity-routing bug — loud, not silent).
 *  `echoedTenant` null/undefined = header absent (an older server): no echo
 *  assertion possible, generation still guards. No active account = nothing to
 *  assert against (the backend default is whatever the server says it is). */
export function shouldDropResponse(
  issuedGeneration: number,
  currentGeneration: number,
  acct: Account | null,
  echoedTenant: string | null | undefined,
): { drop: boolean; reason?: 'switched' | 'echo-mismatch' } {
  if (issuedGeneration !== currentGeneration) return { drop: true, reason: 'switched' }
  if (acct && echoedTenant && echoedTenant !== acct.tenantId) return { drop: true, reason: 'echo-mismatch' }
  return { drop: false }
}
