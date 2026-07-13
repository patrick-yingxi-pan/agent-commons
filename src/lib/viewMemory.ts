/** ── Per-account view memory (multi-account) ─────────────────────────────────
 *  Each account's LAST LOCATION — the open thread, or the open section page
 *  (with its sub-view / detail focus) — remembered per account on this browser
 *  and restored when that account's Workspace next mounts: a switch-back, a
 *  reload, a re-sign-in. The DATA a location shows is never stored (the pages
 *  re-read the server as the account); this is only "where you were".
 *
 *  Companion to the account-scoped layout blob (uiPrefs.ts) — together they
 *  make a switch-back land in the account's world exactly as it was left.
 *  Storage is one keyed blob; a defect degrades to "no memory", never a guess. */
import type { SectionId } from '../types'

export type ViewLocation =
  | { kind: 'session'; sessionId: string }
  | {
      kind: 'section'
      section: SectionId
      subview: string | null
      projectId: string | null
      scheduleId: string | null
      ownerName: string | null
      /** A work item's page under its project. Optional so blobs saved before the
       *  field existed stay loadable; absent ≡ null. */
      workItemId?: string | null
      /** A published definition's page (same back-compat rule). */
      agentId?: string | null
      /** A saved context's detail page (same back-compat rule). */
      contextId?: string | null
    }

const KEY = 'claude-ui.view.v1'

type Store = Record<string, ViewLocation>

function load(): Store {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Store) : {}
  } catch {
    return {}
  }
}

export function loadViewLocation(scope: string): ViewLocation | undefined {
  const loc = load()[scope]
  // Shape-check the one field every consumer branches on; anything else is
  // validated by the restore path itself (a stale session id 404s server-side).
  return loc && (loc.kind === 'session' || loc.kind === 'section') ? loc : undefined
}

export function saveViewLocation(scope: string, loc: ViewLocation): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...load(), [scope]: loc }))
  } catch {
    /* ignore quota / privacy-mode errors */
  }
}
