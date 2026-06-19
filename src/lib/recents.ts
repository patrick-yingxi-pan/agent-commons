/** A tiny persisted "recently used" store for each Add-context type. The picker
 *  shows these as the type's "Recent …" list; the "Browse…" explorer pulls from
 *  everything *not* in here. Picking anything (recent or freshly browsed) calls
 *  `pushRecent`, which moves it to the front and evicts the least-recently-used
 *  tail once the list is full — a classic MRU-front / LRU-evict cache.
 *
 *  Only option *ids* are stored (under one localStorage key), so the heavy repo
 *  / folder code payloads never hit storage — the picker rehydrates each id from
 *  its in-memory catalog. */
import { DEFAULT_RECENT_IDS, type ContextTypeId } from '../data/contextOptions'

/** How many entries each type's recents list holds before LRU eviction kicks in.
 *  Deliberately small so the demo can show eviction after a couple of browses. */
export const MAX_RECENTS = 3

const KEY = 'claude-ui.recents.v1'

type Store = Partial<Record<ContextTypeId, string[]>>

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

/** The most-recent-first ids for a type. Falls back to the seeded defaults until
 *  the user has picked something, then reflects their own history. */
export function getRecentIds(type: ContextTypeId): string[] {
  const stored = load()[type]
  return (stored ?? DEFAULT_RECENT_IDS[type]).slice(0, MAX_RECENTS)
}

/** Promote `id` to the front of `type`'s recents (de-duping), then evict the
 *  least-recently-used tail beyond MAX_RECENTS. */
export function pushRecent(type: ContextTypeId, id: string) {
  const current = getRecentIds(type)
  const next = [id, ...current.filter((x) => x !== id)].slice(0, MAX_RECENTS)
  const store = load()
  store[type] = next
  save(store)
}
