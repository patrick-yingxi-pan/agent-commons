/** The "recently used / set-up" shortcut surface behind every Add-context type's
 *  quick list. One non-evicting MRU id list per type.
 *
 *  ── The concept (unchanged; only its home moved) ─────────────────────────────
 *  • Append-only recency, NEVER evict. Attaching an element promotes it to the
 *    front; the list only grows. The VIEW folds any overflow into a "More" flyout.
 *  • Connectors / MCP seed from every connected account; file-like types from a
 *    few catalog defaults. Promotion is total — every attach funnels through
 *    contextShortcuts.rememberAttached → pushRecent (see [[contextShortcuts]]).
 *
 *  Recents are **server-owned** now (per-user domain state that syncs across
 *  devices, not browser-local UI chrome): `useRecentIds` reads the server
 *  snapshot through the API cache, and `pushRecent` is an optimistic command.
 *  The public API is unchanged, so the picker + the attach funnel don't care. */
import type { ContextTypeId } from '../../contract/index.ts'
import { pushRecentId, useRecents } from '../api'

const EMPTY: string[] = []

/** Reactive read of a type's recents — re-renders when the server snapshot
 *  changes (this client's own promote, or another device's, via the event stream).
 *  The view decides how many to show. */
export function useRecentIds(type: ContextTypeId): string[] {
  return useRecents().data?.[type] ?? EMPTY
}

/** Promote `id` to the front of `type`'s list (non-evicting). Optimistic so the
 *  quick list flips at once, then POSTs the canonical write. */
export function pushRecent(type: ContextTypeId, id: string): void {
  pushRecentId(type, id)
}
