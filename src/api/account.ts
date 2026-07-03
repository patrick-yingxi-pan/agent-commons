/** ── The active account (multi-account design §6.1–6.2; P6: verified) ───────
 *  Since P6 the identity ON THE WIRE is the server-issued session cookie
 *  (HttpOnly — script can't even read it): fetch, `EventSource`, and `<img>`
 *  requests all carry it automatically, so NO transport seam injects identity
 *  anymore. What this module tracks is the account the user PICKED — the
 *  client's belief about who it's acting as — which powers the two guards that
 *  make switching safe (invariant I5 — no cross-account contamination):
 *  • the GENERATION counter: every request captures it at issue time; a response
 *    landing after a switch is dropped on the floor;
 *  • the IDENTITY ECHO: the server names the tenant it resolved on every
 *    response (`x-resolved-tenant`); a mismatch against the picked account is
 *    dropped loudly.
 *  Persistence is the cookie itself (a reload stays signed in); the in-memory
 *  pick starts null — no assertion until the first switch, and the chip label
 *  is always /v1/me (server truth) regardless.
 *
 *  Framework-free (no React, no import.meta.env) so `node --test` can lock the
 *  policy directly. */

export interface Account {
  userId: string
  tenantId: string
}

let account: Account | null = null
let generation = 0
const listeners = new Set<() => void>()

/** The identity this client believes it's acting as (null = never switched —
 *  whatever the session cookie / backend default resolves). */
export function activeAccount(): Account | null {
  return account
}

/** Bumped on every switch — the staleness fence for in-flight responses. */
export function accountGeneration(): number {
  return generation
}

/** Record an account switch that has ALREADY been established server-side (the
 *  auth endpoint set the cookie — see hooks.switchActiveAccount, which owns the
 *  ordering). The single choreography point: bump the generation (in-flight
 *  responses become droppable), then notify subscribers — events.ts reopens its
 *  stream (now riding the new cookie) and the app layer resets the cache.
 *  Idempotent for a same-account no-op. */
export function switchAccount(next: Account | null): void {
  if (account?.userId === next?.userId && account?.tenantId === next?.tenantId) return
  refreshAccount(next)
}

/** Like switchAccount but WITHOUT the same-account no-op guard — for operations
 *  that changed the SERVER-side session regardless of the client's belief. The
 *  load-bearing case: sign-out after a page RELOAD, where the in-memory pick is
 *  null (the cookie carried the identity) — `switchAccount(null)` would no-op
 *  and the world would keep rendering the signed-out account from cache. */
export function refreshAccount(next: Account | null): void {
  account = next
  generation += 1
  for (const fn of listeners) fn()
}

/** Subscribe to switches (events.ts stream reconnect; the controller's reset).
 *  Doubles as the `useSyncExternalStore` subscribe for the chip UI. */
export function onAccountSwitch(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// ── Pure policy helpers (locked by tests/account-guard.test.ts) ──────────────
// (The old accountHeaders/accountQuery injectors died with P6: identity rides
//  the HttpOnly session cookie, which no client code can — or should — build.)

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
