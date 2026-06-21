/** A tiny persisted "recently used" store for each Add-context type. The picker
 *  shows these as the type's "Recent …" list; the "Browse…" explorer pulls from
 *  everything *not* in here.
 *
 *  ── The concept (so the update rule is deducible, not incidental) ────────────
 *  The Recent list is the *shortcut surface* for re-adding context: it exists so
 *  anything the thread has used is one click away next time. The invariant that
 *  follows from that purpose: **every element newly attached to a thread must be
 *  promoted here** — whether it came from this picker, the Browse explorer, an
 *  AI proposal, or a side-effect attach (a repo pulling in its GitHub connector).
 *  Promotion is therefore done once, at the single attach funnel
 *  (`lib/contextShortcuts.ts` → `controller/handleAddContext`), not scattered
 *  across click handlers — see [[../lib/contextShortcuts]]. `pushRecent` moves an
 *  id to the front and evicts the least-recently-used tail once the list is full
 *  (a classic MRU-front / LRU-evict cache), and notifies subscribers so every
 *  open picker re-renders to reflect the new entry.
 *
 *  Only option *ids* are stored (under one localStorage key), so the heavy repo
 *  / folder code payloads never hit storage — the picker rehydrates each id from
 *  its in-memory catalog. */
import { useSyncExternalStore } from 'react'
import { DEFAULT_RECENT_IDS, type ContextTypeId } from '../data/contextOptions'

/** How many entries each type's recents list holds before LRU eviction kicks in.
 *  Deliberately small so the demo can show eviction after a couple of browses. */
export const MAX_RECENTS = 3

const KEY = 'claude-ui.recents.v1'

type Store = Partial<Record<ContextTypeId, string[]>>

/** In-memory mirror of the persisted lists. It's the snapshot source for the
 *  reactive hook, so each type's array keeps a *stable identity* until
 *  `pushRecent` replaces it — without this, `useSyncExternalStore` would loop on
 *  a freshly-sliced array every render. */
const cache: Partial<Record<ContextTypeId, string[]>> = {}
const subscribers = new Set<() => void>()

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

/** Compute a type's list from storage, falling back to the seeded defaults until
 *  the user has picked something. */
function compute(type: ContextTypeId): string[] {
  const stored = load()[type]
  return (stored ?? DEFAULT_RECENT_IDS[type]).slice(0, MAX_RECENTS)
}

/** The most-recent-first ids for a type — a reference-stable array (cached) so it
 *  can back the reactive hook. */
export function getRecentIds(type: ContextTypeId): string[] {
  return (cache[type] ??= compute(type))
}

/** Promote `id` to the front of `type`'s recents (de-duping), evict the
 *  least-recently-used tail beyond MAX_RECENTS, persist, and notify subscribers
 *  so any open picker reflects it immediately. */
export function pushRecent(type: ContextTypeId, id: string) {
  const current = getRecentIds(type)
  const next = [id, ...current.filter((x) => x !== id)].slice(0, MAX_RECENTS)
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

/** Reactive read of a type's recents — re-renders the caller whenever
 *  `pushRecent` runs (from any attach path), so the shortcut list stays current
 *  without relying on an incidental parent re-render. */
export function useRecentIds(type: ContextTypeId): string[] {
  return useSyncExternalStore(subscribe, () => getRecentIds(type))
}
