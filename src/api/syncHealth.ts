/** Ambient-sync health — the small client-side state machine behind the one
 * global recovery notice.
 *
 * "Live" is deliberately earned by the stream's `hello` frame, not by
 * `EventSource.onopen` or `navigator.onLine`: hello is where the server proves
 * both identity and replay continuity. Cached pages remain usable while the
 * stream recovers, but the UI must not silently present them as live.
 *
 * Kept framework-free so the transition policy and notification behavior can
 * be locked exactly under node:test. `events.ts` writes; `hooks.ts` is the
 * component read door. */

export type AmbientSyncHealth = 'connecting' | 'live' | 'recovering'
export type AmbientSyncSignal = 'connect' | 'hello' | 'error' | 'account-switch'

export function nextAmbientSyncHealth(
  current: AmbientSyncHealth,
  signal: AmbientSyncSignal,
): AmbientSyncHealth {
  switch (signal) {
    case 'hello':
      return 'live'
    case 'error':
      return 'recovering'
    case 'account-switch':
      // Rebinding is expected during an account switch, so do not carry an old
      // account's warning into the new account. A real failure will immediately
      // move this fresh connection to `recovering`.
      return 'connecting'
    case 'connect':
      // A manual reconnect after CLOSED must keep the warning visible until a
      // validated hello arrives; constructing another EventSource is not proof.
      return current === 'recovering' ? 'recovering' : 'connecting'
  }
}

export interface AmbientSyncHealthStore {
  getSnapshot(): AmbientSyncHealth
  subscribe(listener: () => void): () => void
  signal(signal: AmbientSyncSignal): void
}

export function createAmbientSyncHealthStore(
  initial: AmbientSyncHealth = 'connecting',
): AmbientSyncHealthStore {
  let health = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => health,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    signal(signal) {
      const next = nextAmbientSyncHealth(health, signal)
      if (next === health) return
      health = next
      for (const listener of [...listeners]) listener()
    },
  }
}

/** The one process-local projection. Account switches reset its posture; the
 * server remains the authority for the account and the underlying data. */
export const ambientSyncHealth = createAmbientSyncHealthStore()
