/** ── The full-screen auth flow's view state (multi-account §12) ──────────────
 *  Which auth surface is showing, if any: the sign-in form, the sign-up wizard,
 *  or the remembered-accounts picker. A tiny external store (same pattern as
 *  src/api/account.ts) so ANY component — the sidebar account menu, the App
 *  shell, a sign-out handler — can open/close it without prop-drilling through
 *  the workspace tree. The AUTH GATE itself (AUTH_GATE=require → the workspace
 *  never renders unsigned) lives in App.tsx off `capabilities.features.authGate`
 *  + `me.via`; this store only carries the user-opened state. */
import { useSyncExternalStore } from 'react'

export type AuthScreenView =
  /** The sign-in form. `addAccount` re-titles it ("Add another account") when
   *  opened from the switcher while already signed in — same flow, the server
   *  simply stacks the new sign-in alongside the current one. */
  | { kind: 'signin'; addAccount?: boolean }
  /** The stepped sign-up wizard. */
  | { kind: 'signup' }
  /** "Choose an account" — the remembered-accounts picker (post-sign-out, or
   *  the gate's landing view when accounts are already stacked here). */
  | { kind: 'picker' }

let view: AuthScreenView | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const fn of listeners) fn()
}

export function openAuthScreen(next: AuthScreenView): void {
  view = next
  emit()
}

export function closeAuthScreen(): void {
  if (view === null) return
  view = null
  emit()
}

/** The currently-open auth view (null = the workspace is showing). */
export function useAuthScreen(): AuthScreenView | null {
  return useSyncExternalStore(subscribe, () => view)
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
