/** The single "recently used / set-up" store behind every Add-context type's
 *  quick list. One ordered id list per type — the shortcut surface for re-adding
 *  context the thread has used.
 *
 *  ── The concept (one model for all types, so behavior can't drift) ───────────
 *  • Append-only recency, NEVER evict. Picking or attaching an element promotes
 *    it to the front; the list only grows. (Eviction was wrong: it threw away
 *    things the user had just set up — see the connectors case, where the list is
 *    meant to show *every* set-up element.) When the list outgrows the space the
 *    picker can show, the VIEW folds the tail into a "More" flyout
 *    (components/RecentOverflowList) — the store never drops anything.
 *  • Seeded per type: files / photos / folders / repos start from a few catalog
 *    defaults; connectors / MCP start from everything already connected (so the
 *    quick list shows all set-up accounts, not a recency sample).
 *  • Promotion is total: any element attached to a thread — from the picker,
 *    Browse, an AI proposal, or a side-effect attach — funnels through
 *    lib/contextShortcuts.rememberAttached, which calls pushRecent here. See
 *    [[contextShortcuts]].
 *
 *  Only option *ids* are stored (one localStorage key); the picker rehydrates
 *  each id from its in-memory catalog. Reactive via useSyncExternalStore so every
 *  open picker reflects an add immediately. */
import { useSyncExternalStore } from 'react'
import { DEFAULT_RECENT_IDS, type ContextTypeId } from '../data/contextOptions'
import { CONNECTED_CONNECTOR_IDS, CONNECTED_MCP_IDS } from '../data/savedContexts'

const KEY = 'claude-ui.recents.v1'

type Store = Partial<Record<ContextTypeId, string[]>>

/** In-memory mirror of the persisted lists. It's the snapshot source for the
 *  reactive hook, so each type's array keeps a *stable identity* until
 *  `pushRecent` replaces it — without this, `useSyncExternalStore` would loop on
 *  a fresh array every render. */
const cache: Partial<Record<ContextTypeId, string[]>> = {}
const subscribers = new Set<() => void>()

/** A type's starting list before the user has touched it. Connectors / MCP show
 *  every already-connected element (requirement: the quick list is the full set,
 *  not a sample); the file-like types start from a few catalog defaults. */
function seedFor(type: ContextTypeId): string[] {
  if (type === 'connector') return [...CONNECTED_CONNECTOR_IDS]
  if (type === 'mcp') return [...CONNECTED_MCP_IDS]
  return [...DEFAULT_RECENT_IDS[type]]
}

function load(): Store {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Store) : {}
  } catch {
    return {}
  }
}

function save(store: Store) {
  try {
    localStorage.setItem(KEY, JSON.stringify(store))
  } catch {
    /* ignore quota / privacy-mode errors */
  }
}

function compute(type: ContextTypeId): string[] {
  return load()[type] ?? seedFor(type)
}

/** The most-recent-first ids for a type — a reference-stable array (cached) so it
 *  can back the reactive hook. The full list; the view decides how many to show. */
export function getRecentIds(type: ContextTypeId): string[] {
  return (cache[type] ??= compute(type))
}

/** Promote `id` to the front of `type`'s list (de-duping). The list only grows —
 *  nothing is evicted — and the view folds any overflow into a "More" flyout.
 *  Persists and notifies subscribers so every open picker reflects it at once. */
export function pushRecent(type: ContextTypeId, id: string) {
  const current = getRecentIds(type)
  const next = [id, ...current.filter((x) => x !== id)]
  cache[type] = next
  const store = load()
  store[type] = next
  save(store)
  subscribers.forEach((cb) => cb())
}

function subscribe(cb: () => void): () => void {
  subscribers.add(cb)
  return () => {
    subscribers.delete(cb)
  }
}

/** Reactive read of a type's list — re-renders the caller whenever `pushRecent`
 *  runs (from any attach path), so the quick list stays current without relying
 *  on an incidental parent re-render. */
export function useRecentIds(type: ContextTypeId): string[] {
  return useSyncExternalStore(subscribe, () => getRecentIds(type))
}
