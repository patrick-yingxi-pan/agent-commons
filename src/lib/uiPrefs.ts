/** Persisted layout preferences — the resizable side-panel widths and whether
 *  the left rail is collapsed. Kept in one small localStorage blob, separate
 *  from the dependency-prompt decisions (prefs.ts) and the recents (recents.ts).
 *  Values are read once on mount and written back as the user drags / toggles.
 *
 *  Scoped PER ACCOUNT (multi-account): switching back to an account must find
 *  its chrome exactly as it was left, so each account keeps its own blob.
 *  App.tsx sets the scope to the resolved account BEFORE the keyed Workspace
 *  mounts — every mount-time getLayout read (rail width/collapse, pane heights,
 *  folds, panel width) then resolves against that account's blob, and the
 *  per-account remount re-runs those reads on every switch. Null scope (boot,
 *  the auth surface) reads the legacy unscoped blob; a scope's first read
 *  falls through to the legacy blob (and the first write copies it), so an
 *  account starts from the layout the user already shaped, then diverges. */
const KEY = 'claude-ui.layout.v1'

let scope: string | null = null

/** Subscribers to "the stored prefs may have changed" — a write, or a SCOPE
 *  switch (which changes what every key resolves to). Most consumers read once
 *  on mount and own their value in component state, so they need none of this;
 *  a preference read by TWO trees at once (a section's facet: the rail's menu
 *  and the section page) does — it has to be one live value, not two copies
 *  that drift. `src/lib/useSectionFilter.ts` is that consumer. */
const listeners = new Set<() => void>()

export function subscribeLayout(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function notifyLayout() {
  for (const fn of [...listeners]) fn()
}

/** Set by App.tsx before the (account-keyed) Workspace renders. */
export function setUiPrefScope(next: string | null): void {
  if (next === scope) return
  scope = next
  // Every key now resolves against a different blob — a live reader holding the
  // previous account's value must re-read rather than keep showing it.
  notifyLayout()
}

const storageKey = () => (scope ? `${KEY}.${scope}` : KEY)

/** Strings ride alongside numbers/booleans: a facet id ('doc', 'shared') is a
 *  layout preference of exactly the same nature as a pane height — per account,
 *  clamped at render, never worth its own blob. */
type Store = Record<string, number | boolean | string>

function load(): Store {
  try {
    const raw = localStorage.getItem(storageKey())
    if (raw) return JSON.parse(raw) as Store
    // First read under this account: seed from the unscoped legacy blob.
    const legacy = scope ? localStorage.getItem(KEY) : null
    return legacy ? (JSON.parse(legacy) as Store) : {}
  } catch {
    return {}
  }
}

/** Read a stored layout value, falling back when absent or the wrong type. */
export function getLayout<T extends number | boolean | string>(key: string, fallback: T): T {
  const v = load()[key]
  return typeof v === typeof fallback ? (v as T) : fallback
}

/** Write one value and notify live readers. The notify is SYNCHRONOUS, so this
 *  must never run during React's render phase — not from a component body, a
 *  useState initializer, or a setState UPDATER (updaters replay during render
 *  when the queue is busy; Sidebar's rail toggles once persisted from inside
 *  theirs and drew the "cannot update while rendering" error). Call it from the
 *  event handler, beside the setState. Locked by tests/pure-updaters.test.ts. */
export function setLayout(key: string, value: number | boolean | string) {
  try {
    localStorage.setItem(storageKey(), JSON.stringify({ ...load(), [key]: value }))
  } catch {
    /* ignore quota / privacy-mode errors */
  }
  notifyLayout()
}

export const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
