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

/** Set by App.tsx before the (account-keyed) Workspace renders. */
export function setUiPrefScope(next: string | null): void {
  scope = next
}

const storageKey = () => (scope ? `${KEY}.${scope}` : KEY)

type Store = Record<string, number | boolean>

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
export function getLayout<T extends number | boolean>(key: string, fallback: T): T {
  const v = load()[key]
  return typeof v === typeof fallback ? (v as T) : fallback
}

export function setLayout(key: string, value: number | boolean) {
  try {
    localStorage.setItem(storageKey(), JSON.stringify({ ...load(), [key]: value }))
  } catch {
    /* ignore quota / privacy-mode errors */
  }
}

export const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
