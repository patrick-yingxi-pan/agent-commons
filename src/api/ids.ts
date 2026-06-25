/** ── Client-side id helpers ─────────────────────────────────────────────────
 *  The one place the *optimistic* id scheme is defined. `save-artifact` mints its
 *  artifact id through an injected minter: the client uses a TEMPORARY id with the
 *  prefix below while the POST is in flight, and the server's authoritative
 *  `art-live-*` id replaces it on reconcile. Because that temp id is unstable —
 *  and is one the server's graph never knows about — the UI must not act on it
 *  (open, or re-file, an artifact still carrying it). Centralizing the prefix here
 *  keeps the minter (api/commands) and the guards (the gallery) in agreement.
 *
 *  Zero imports on purpose, so it is safe to unit-test under `node --test`. */

/** Prefix of an optimistically-minted (not-yet-reconciled) artifact id. */
export const OPTIMISTIC_ID_PREFIX = 'art-opt-'

/** Whether an id is a not-yet-reconciled optimistic one. */
export function isOptimisticId(id: string): boolean {
  return id.startsWith(OPTIMISTIC_ID_PREFIX)
}
