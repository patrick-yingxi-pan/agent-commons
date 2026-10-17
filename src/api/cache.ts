/** ── The client query cache ────────────────────────────────────────────────
 *  A tiny normalized read-through cache, one entry per query key (`sessions`,
 *  `session:auth-refactor`, `capabilities`, …). Components read through
 *  `useQuery`, which subscribes via `useSyncExternalStore` — the same reactive
 *  primitive the prototype already uses for recents, generalized.
 *
 *  Two things write to it: a query's own `fetch` (first read), and the SSE event
 *  router (`mutate`/`invalidate`) when the server pushes a change. So the UI stays
 *  in sync with state that changed *outside* any request — a scheduled run firing,
 *  a standing approval acting — without polling. Each entry keeps a stable object
 *  identity until it actually changes, so the external-store snapshot never loops. */
import { useCallback, useEffect } from 'react'
import { useSyncExternalStore } from 'react'
import { ApiRequestError } from './client.ts'

export type QueryStatus = 'idle' | 'loading' | 'success' | 'error'

export interface QueryState<T> {
  status: QueryStatus
  data: T | undefined
  error: Error | undefined
}

/** Only an explicit, typed API not-found response proves cached data is no
 * longer readable; authentication/authorization denials also evict private data.
 * Network, server, and misclassified not-found errors retain stale data
 * so a transient failure cannot turn a usable page into a false absence. */
export function queryFailureState(error: unknown): 'evict' | 'retain' {
  return error instanceof ApiRequestError && (
    error.status === 401 || error.status === 403 ||
    error.code === 'not_found' && error.status === 404
  ) ? 'evict' : 'retain'
}

interface Entry {
  state: QueryState<unknown>
  subs: Set<() => void>
  inFlight?: Promise<void>
  fetcher?: () => Promise<unknown>
  /** Bumped on every write (a started fetch, an optimistic mutate, a setData). A
   *  fetch only applies its result if the generation is still its own — so a
   *  stale in-flight fetch can't clobber a newer optimistic/authoritative write
   *  or a more recent refetch (epoch reset, rapid invalidations). */
  gen: number
}

const entries = new Map<string, Entry>()
const IDLE: QueryState<unknown> = { status: 'idle', data: undefined, error: undefined }

function getEntry(key: string): Entry {
  let e = entries.get(key)
  if (!e) {
    e = { state: IDLE, subs: new Set(), gen: 0 }
    entries.set(key, e)
  }
  return e
}

function setState(key: string, next: QueryState<unknown>): void {
  const e = getEntry(key)
  e.state = next
  for (const cb of e.subs) cb()
}

/** Kick off a fetch for `key` if it isn't already loaded or loading. Stores the
 *  fetcher so an event can later `invalidate` (refetch) the same key. With `force`,
 *  a loaded key refetches anyway (stale-while-revalidate: the cached data keeps
 *  rendering while the fresh copy is in flight — `run` preserves `data`). */
function ensure(key: string, fetcher: () => Promise<unknown>, force = false): void {
  const e = getEntry(key)
  e.fetcher = fetcher
  if (e.inFlight || (e.state.status === 'success' && !force)) return
  run(key, fetcher)
}

function run(key: string, fetcher: () => Promise<unknown>): void {
  const e = getEntry(key)
  const myGen = (e.gen += 1)
  setState(key, { status: 'loading', data: e.state.data, error: undefined })
  e.inFlight = fetcher()
    .then(
      (data) => {
        if (e.gen === myGen) setState(key, { status: 'success', data, error: undefined })
      },
      (error) => {
        if (e.gen === myGen) {
          const failureState = queryFailureState(error)
          setState(key, {
            status: 'error',
            data: failureState === 'evict' ? undefined : e.state.data,
            error: error as Error,
          })
        }
      },
    )
    .finally(() => {
      if (e.gen === myGen) e.inFlight = undefined
    })
}

/** Refetch a key (used by the event router when a push means "your copy is
 *  stale"). No-op if the key was never queried. */
export function invalidate(key: string): void {
  const e = entries.get(key)
  if (e?.fetcher) run(key, e.fetcher)
}

/** Refetch every key under a prefix — for parameterized families where any variant
 *  may be live (e.g. the D17 directory's per-search keys: `directory-projects` +
 *  `directory-projects:<q>`). Same no-op semantics as `invalidate` per key.
 *  Frequent account-wide changes opt into observedOnly: dormant variants are
 *  discarded and late reads fenced, then read fresh on their next mount rather
 *  than issuing a request per previously visited conversation. */
export function invalidatePrefix(prefix: string, observedOnly = false): void {
  for (const [key, e] of entries) {
    if (!(key === prefix || key.startsWith(`${prefix}:`))) continue
    if (observedOnly && e.subs.size === 0) {
      e.gen += 1
      entries.delete(key)
    } else if (e.fetcher) run(key, e.fetcher)
  }
}

/** Patch a key's cached data in place (used by the event router when a push
 *  carries the new value, so no refetch is needed). No-op if never queried. */
export function mutate<T>(key: string, updater: (prev: T | undefined) => T): void {
  const e = entries.get(key)
  if (!e) return
  e.gen += 1 // an optimistic write supersedes any in-flight fetch
  setState(key, { status: 'success', data: updater(e.state.data as T | undefined), error: undefined })
}

/** Seed/replace a key's data directly (e.g. a command's authoritative result). */
export function setData<T>(key: string, data: T): void {
  getEntry(key).gen += 1 // an authoritative write supersedes any in-flight fetch
  setState(key, { status: 'success', data, error: undefined })
}

/** Remove one authoritative row without leaving stale data in an error/SWR
 * state. A later mount starts a fresh read, while any crossed response is
 * fenced by the entry generation. */
export function evict(key: string): void {
  const entry = entries.get(key)
  if (!entry) return
  const fetcher = entry.fetcher
  entry.gen += 1
  entry.inFlight = undefined
  entry.state = IDLE
  for (const cb of entry.subs) cb()
  // A mounted query must not be stranded in idle after eviction. Start its
  // saved fetcher again; the generation bump above fences the crossed request.
  if (fetcher) run(key, fetcher)
}

/** Drop every cached variant in a resource family before refetching. Unlike
 *  invalidation, eviction is for authorization or permanent-removal changes:
 *  stale bodies must not remain visible while the fresh read is pending. */
export function evictPrefix(prefix: string): void {
  for (const key of entries.keys()) {
    if (key === prefix || key.startsWith(`${prefix}:`)) evict(key)
  }
}

/** Read a key's cached data without subscribing — for imperative lookups outside
 *  React (e.g. the controller resolving a run session from the recent-runs feed).
 *  Returns undefined if the key was never queried / hasn't loaded. */
export function peek<T>(key: string): T | undefined {
  return entries.get(key)?.state.data as T | undefined
}

/** Drop every cached entry and notify — used when the server's epoch changes
 *  (it restarted and reseeded), so the UI refetches everything fresh. */
export function resetAll(): void {
  for (const [key, e] of entries) {
    e.state = IDLE
    e.inFlight = undefined
    for (const cb of e.subs) cb()
    if (e.fetcher) run(key, e.fetcher)
  }
}

/** Refetch every query that has been read while retaining its current data.
 * Use for a world WIDENING that does not change identity (accepting an org
 * seat): every projection may gain rows, but the current shell and account are
 * still truthful. Identity/session/epoch transitions use `resetAll` instead —
 * their old data is no longer safe to render even briefly. */
export function revalidateAll(): void {
  for (const [key, e] of entries) {
    if (e.fetcher) run(key, e.fetcher)
  }
}

/** Read a query reactively: triggers the fetch on first use, re-renders when the
 *  data changes (whether from the fetch or an SSE push). Pass `enabled: false` to
 *  hold off the fetch (e.g. a source-keyed query whose source is client-side / not
 *  yet chosen) — the hook still runs (rules of hooks), it just doesn't fetch.
 *  Pass `revalidate: true` for reads that COMPOSE many other reads (global search,
 *  a workspace profile — D21/D22): no per-entity invalidation can cover them, so
 *  every mount refetches while the cached copy keeps rendering (SWR). */
export function useQuery<T>(key: string, fetcher: () => Promise<T>, enabled = true, revalidate = false): QueryState<T> {
  const subscribe = useCallback(
    (cb: () => void) => {
      const e = getEntry(key)
      e.subs.add(cb)
      return () => {
        e.subs.delete(cb)
      }
    },
    [key],
  )
  const getSnapshot = useCallback(() => getEntry(key).state as QueryState<T>, [key])
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  useEffect(() => {
    if (enabled) ensure(key, fetcher as () => Promise<unknown>, revalidate)
    // Re-run only when the key (or enablement) changes; the fetcher is keyed by the
    // same inputs, and revalidate is constant per call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled])
  return state
}
