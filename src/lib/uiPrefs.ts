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

/** Subscribers to "the stored prefs may have changed" — i.e. a WRITE. Most
 *  consumers read once on mount and own their value in component state, so they
 *  need none of this; a preference read by TWO trees at once (a section's facet:
 *  the rail's menu and the section page) does — it has to be one live value, not
 *  two copies that drift. `src/lib/sectionFilter.ts` is that consumer.
 *
 *  A SCOPE switch is deliberately NOT on this channel — see `setUiPrefScope`. */
const listeners = new Set<() => void>()

export function subscribeLayout(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** The ONE notify. Every listener is a live reader's setState, so this is
 *  forbidden during React's render phase — the whole render-phase rule below
 *  (and in `setLayout`) exists to keep the only callers writes from handlers. */
function notifyLayout() {
  for (const fn of [...listeners]) fn()
}

/** Which account's blob every key resolves against. Exported so a derived memo
 *  can make the scope part of its OWN identity, rather than needing an
 *  invalidation event that cannot be delivered safely (see `setUiPrefScope`). */
export const uiPrefScope = (): string | null => scope

/** Point the store at an account's blob. App.tsx sets this DURING RENDER — it
 *  has to land before the keyed `<Workspace>` mounts, because every mount-time
 *  `getLayout` read (rail width, pane folds/heights, panel width, the section
 *  facets) must resolve against the new account's blob.
 *
 *  So this is a pure module set with NO notify. `notifyLayout` is synchronously
 *  a setState on every live reader, and firing it mid-render is exactly the
 *  "Cannot update a component (SectionFilterMenu) while rendering a different
 *  component (App)" error this shipped with until 2026-08-08 — the same hazard
 *  `setLayout` documents, reached by the other door: not from inside a setState
 *  updater, but from a component body directly.
 *
 *  Staying quiet costs nothing. React re-renders the readers anyway, because the
 *  Workspace is KEYED by the account — a scope switch remounts the whole subtree
 *  that holds them. What a remount does NOT fix is a memo built under the old
 *  scope, so derived snapshots key on `uiPrefScope()` and notice the switch
 *  instead of waiting to be told (`sectionFilterSnapshot`). `setMainSplitScope`
 *  (lib/mainSplit.ts), set on the very next line of App.tsx, has always worked
 *  this way. Locked by src/lib/pure-updaters.test.ts. */
export function setUiPrefScope(next: string | null): void {
  scope = next
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
 *  event handler, beside the setState. Locked by src/lib/pure-updaters.test.ts. */
export function setLayout(key: string, value: number | boolean | string) {
  try {
    localStorage.setItem(storageKey(), JSON.stringify({ ...load(), [key]: value }))
  } catch {
    /* ignore quota / privacy-mode errors */
  }
  notifyLayout()
}

export const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
