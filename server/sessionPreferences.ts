/** Viewer-scoped conversation presentation preferences.
 *
 * This is intentionally separate from the shared Session row: two readers of a
 * granted conversation may keep different panels open, and neither choice may
 * mutate the resource they are viewing. The store owns persistence + events;
 * this leaf owns only the nested user/session map and its validation. */
import type { PanelFocus, SessionPreferences, SessionWorkspace } from '../contract/index.ts'
import { isPanelFocus, panelFocusInWorkspace } from '../contract/index.ts'

export type PersistedSessionPreferences = [string, [string, SessionPreferences][]][]

const byUser = new Map<string, Map<string, SessionPreferences>>()
export function getSessionPreferences(userId: string, sessionId: string): SessionPreferences {
  const stored = byUser.get(userId)?.get(sessionId)
  return stored ? structuredClone(stored) : {}
}

export function setSessionPreferences(
  userId: string,
  sessionId: string,
  panelFocus: PanelFocus | null,
  workspace: SessionWorkspace,
): SessionPreferences {
  if (panelFocus && !panelFocusInWorkspace(workspace, panelFocus)) {
    throw new Error(`Panel focus '${panelFocus.kind}:${panelFocus.id}' is not attached to session '${sessionId}'`)
  }
  let sessions = byUser.get(userId)
  if (!sessions) {
    sessions = new Map()
    byUser.set(userId, sessions)
  }
  const next: SessionPreferences = { panelFocus: panelFocus ? { ...panelFocus } : null }
  sessions.set(sessionId, next)
  return structuredClone(next)
}

/** A detached context cannot remain a durable open target. Preserve the user's
 * intent as an explicit close instead of falling back to a different panel. */
export function pruneSessionPreferences(sessionId: string, workspace: SessionWorkspace): boolean {
  let changed = false
  for (const sessions of byUser.values()) {
    const prefs = sessions.get(sessionId)
    if (prefs?.panelFocus && !panelFocusInWorkspace(workspace, prefs.panelFocus)) {
      sessions.set(sessionId, { panelFocus: null })
      changed = true
    }
  }
  return changed
}

export function removeSessionPreferences(sessionId: string): void {
  for (const [userId, sessions] of byUser) {
    sessions.delete(sessionId)
    if (sessions.size === 0) byUser.delete(userId)
  }
}

export function persistedSessionPreferences(): PersistedSessionPreferences {
  return [...byUser.entries()].map(([userId, sessions]) => [
    userId,
    [...sessions.entries()].map(([sessionId, prefs]) => [sessionId, structuredClone(prefs)]),
  ])
}

/** Restore additive state defensively. Unknown users/sessions are discarded by
 * the resolver; malformed rows are ignored; a focus made stale by a workspace
 * change becomes an explicit close. */
export function rehydrateSessionPreferences(
  rows: PersistedSessionPreferences | undefined,
  resolveWorkspace: (userId: string, sessionId: string) => SessionWorkspace | undefined,
): void {
  byUser.clear()
  for (const userRow of rows ?? []) {
    if (!Array.isArray(userRow) || typeof userRow[0] !== 'string' || !Array.isArray(userRow[1])) continue
    const [userId, sessionRows] = userRow
    for (const sessionRow of sessionRows) {
      if (!Array.isArray(sessionRow) || typeof sessionRow[0] !== 'string') continue
      const [sessionId, candidate] = sessionRow
      const workspace = resolveWorkspace(userId, sessionId)
      if (!workspace || !candidate || typeof candidate !== 'object') continue
      const raw = candidate as SessionPreferences
      if (!Object.prototype.hasOwnProperty.call(raw, 'panelFocus')) continue
      if (raw.panelFocus === null) {
        setSessionPreferences(userId, sessionId, null, workspace)
      } else if (isPanelFocus(raw.panelFocus)) {
        setSessionPreferences(
          userId,
          sessionId,
          panelFocusInWorkspace(workspace, raw.panelFocus) ? raw.panelFocus : null,
          workspace,
        )
      }
    }
  }
}
