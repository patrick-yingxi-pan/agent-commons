/** ── A split pane's conversation (universal split Phase 3) ───────────────────
 *  Subscribes a pane to one session's keyed conversation state and runs the
 *  same open-time recipe the primary's selectSession runs — seed from the
 *  local mirror, reconcile from the server (the system of record), resurface a
 *  held escalation (C28), reattach to a still-generating turn (invariant I1) —
 *  WITHOUT touching the singleton's navigation. A pane on the session the
 *  primary already holds finds a non-pristine entry and simply shares it (the
 *  store dedupes by key); mounting never resets an entry that has state, so a
 *  duplicate pane can't stale its twin's stream. */
import { useEffect } from 'react'
import { SESSIONS } from '../data/sessions'
import { DRAFT_ID, liveFromSession, unresolvedEscalation, type Live } from '../data/liveSession'
import { keys, loadSession, peek } from '../api'
import { getPanelPref } from '../lib/panelPrefs'
import { conversations, useConversation } from './conversationStore'
import type { ConversationState } from './conversationCore'
import type { PanelFocus, RelationGraph } from '../types'

/** The strongest attached context — the auto-open target when a session has
 *  no remembered panel choice (FWD-2's fallback). */
function strongestFocus(l: Live): PanelFocus | null {
  return l.repos[0]
    ? { kind: 'repo', id: l.repos[0].id }
    : l.workspaces[0]
      ? { kind: 'workspace', id: l.workspaces[0].id }
      : null
}

export function usePaneConversation(sessionId: string): ConversationState {
  const conv = useConversation(sessionId)

  useEffect(() => {
    // The DRAFT has no server row (it materializes on first send through the
    // draft funnel) — nothing to seed or reconcile; the pane just renders the
    // store entry the New-session door reset.
    if (sessionId === DRAFT_ID) return
    const entry = conversations.get(sessionId)
    const pristine = entry.live.messages.length === 0 && !entry.busy && !entry.typing
    // Seed a pristine entry from the local mirror so the thread paints at once
    // (the primary's exact recipe); a lived-in entry is shared as-is.
    if (pristine) {
      const seed = SESSIONS.find((s) => s.id === sessionId)
      if (seed) conversations.reset(sessionId, liveFromSession(seed))
      // Restore the session's remembered panel (FWD-2): a stored focus, or
      // null (explicitly closed) — both honoured over the auto-open; with no
      // stored choice, the strongest present context opens.
      const pref = getPanelPref(sessionId)
      conversations.setFocus(sessionId, pref !== undefined ? pref : strongestFocus(conversations.get(sessionId).live))
    }
    const since = conversations.epoch(sessionId)
    loadSession(sessionId)
      .then((s) => {
        // Never stomp a mid-stream entry (the primary may be streaming this
        // very session) — the push-reconcile guard, applied here too.
        const now = conversations.get(sessionId)
        if (now.busy || now.typing) return
        const reconciled = liveFromSession(s)
        if (!conversations.reconcile(sessionId, since, reconciled)) return
        // The reconciled live may reveal contexts the seed lacked — re-run the
        // panel restore ONLY while nothing is open (a user toggle mid-load, or
        // the seed restore above, must not be clobbered).
        if (pristine && !conversations.get(sessionId).focus) {
          const pref = getPanelPref(sessionId)
          conversations.setFocus(sessionId, pref !== undefined ? pref : strongestFocus(reconciled))
        }
        const held = unresolvedEscalation(s, reconciled, peek<RelationGraph>(keys.relations))
        if (held) conversations.holdEscalation(sessionId, held)
        if (s.activeTurnId && !conversations.get(sessionId).liveTurn) conversations.reattach(sessionId, s.activeTurnId)
      })
      .catch(() => {})
  }, [sessionId])

  return conv
}
