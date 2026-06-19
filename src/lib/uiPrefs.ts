/** Persisted layout preferences — the resizable side-panel widths and whether
 *  the left rail is collapsed. Kept in one small localStorage blob, separate
 *  from the dependency-prompt decisions (prefs.ts) and the recents (recents.ts).
 *  Values are read once on mount and written back as the user drags / toggles. */
const KEY = 'claude-ui.layout.v1'

type Store = Record<string, number | boolean>

function load(): Store {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Store) : {}
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
    localStorage.setItem(KEY, JSON.stringify({ ...load(), [key]: value }))
  } catch {
    /* ignore quota / privacy-mode errors */
  }
}

export const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
