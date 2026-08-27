/** ── A split pane's conversation (universal split Phase 3) ───────────────────
 *  Subscribes a pane to one session's keyed conversation state and runs the
 *  same open-time recipe the primary's selectSession runs — seed from the
 *  local mirror, reconcile from the server (the system of record), resurface a
 *  held escalation (C28), reattach to a still-generating turn (invariant I1) —
 *  WITHOUT touching the singleton's navigation. A pane on the session the
 *  primary already holds finds a non-pristine entry and simply shares it (the
 *  store dedupes by key); mounting never resets an entry that has state, so a
 *  duplicate pane can't stale its twin's stream. */
import { useCallback, useEffect } from 'react'
import { SESSIONS } from '../data/sessions'
import { DRAFT_ID, liveFromSession, unresolvedEscalation, type Live } from '../data/liveSession'
import { keys, loadEarlierSession, loadSession, onSessionPush, peek } from '../api'
import { getPanelPref } from '../lib/panelPrefs'
import { conversations, useConversation } from './conversationStore'
import type { ConversationState } from './conversationCore'
import type { PanelFocus, RelationGraph, Session } from '../types'

/** The strongest attached context — the auto-open target when a session has
 *  no remembered panel choice (FWD-2's fallback). */
function strongestFocus(l: Live): PanelFocus | null {
  return l.repos[0]
    ? { kind: 'repo', id: l.repos[0].id }
    : l.workspaces[0]
      ? { kind: 'workspace', id: l.workspaces[0].id }
      : null
}

/** The ONE server-reconcile tail both effects below share: load the session,
 *  refuse to stomp a mid-stream entry, land the reconciled live, and resurface
 *  a persisted-but-unresolved escalation proposal (C28 — the record is the
 *  authority; holdEscalation never stomps a prompt already held). The two
 *  callers differ only in their `after` follow-up — extracting the tail is
 *  what keeps them from diverging (before the Phase 6 hardening, a
 *  hand-copied push tail silently missed the C28 resurface). */
function reconcileNow(sessionId: string, after?: (s: Session, reconciled: Live) => void): void {
  const since = conversations.epoch(sessionId)
  loadSession(sessionId)
    .then((s) => {
      const now = conversations.get(sessionId)
      if (now.busy || now.typing) return
      const reconciled = liveFromSession(s)
      if (!conversations.reconcile(sessionId, since, reconciled, s.messagePage)) return
      const landed = conversations.get(sessionId).live
      const held = unresolvedEscalation(s, landed, peek<RelationGraph>(keys.relations))
      if (held) conversations.holdEscalation(sessionId, held)
      after?.(s, landed)
    })
    .catch(() => {})
}

export function usePaneConversation(sessionId: string): ConversationState & { loadEarlier: () => Promise<string | null> } {
  const conv = useConversation(sessionId)

  const loadEarlier = useCallback(async (): Promise<string | null> => {
    const current = conversations.get(sessionId)
    const cursor = current.history.olderCursor
    if (!cursor || current.history.loading || sessionId === DRAFT_ID) return null
    const since = conversations.epoch(sessionId)
    conversations.setHistoryLoading(sessionId, true)
    try {
      const page = await loadEarlierSession(sessionId, cursor)
      if (!page.messagePage) throw new Error('The server did not return a message page')
      const older = liveFromSession(page)
      if (!conversations.prependHistory(sessionId, since, older, page.messagePage)) return null
      const held = unresolvedEscalation(page, conversations.get(sessionId).live, peek<RelationGraph>(keys.relations))
      if (held) conversations.holdEscalation(sessionId, held)
      return older.messages[0]?.id ?? null
    } catch (error) {
      if (conversations.epoch(sessionId) !== since) return null
      conversations.setHistoryLoading(
        sessionId,
        false,
        error instanceof Error && error.message ? error.message : 'Could not load earlier messages',
      )
      return null
    }
  }, [sessionId])

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
    reconcileNow(sessionId, (s, reconciled) => {
      // The reconciled live may reveal contexts the seed lacked — re-run the
      // panel restore ONLY while nothing is open (a user toggle mid-load, or
      // the seed restore above, must not be clobbered).
      if (pristine && !conversations.get(sessionId).focus) {
        const pref = getPanelPref(sessionId)
        conversations.setFocus(sessionId, pref !== undefined ? pref : strongestFocus(reconciled))
      }
      // A turn still generating server-side: resume rendering its stream
      // (replay from the top, then the live tail — invariant I1).
      if (s.activeTurnId && !conversations.get(sessionId).liveTurn) conversations.reattach(sessionId, s.activeTurnId)
    })
  }, [sessionId])

  // Cross-client freshness: another client's change to THIS session (a context
  // attached, a turn persisted) re-reconciles the open pane through the SAME
  // tail as the mount-time read. Every visible pane subscribes for its own
  // session (the singleton used to cover only the one active thread).
  useEffect(
    () =>
      onSessionPush((sid) => {
        if (sid !== sessionId || sessionId === DRAFT_ID) return
        reconcileNow(sessionId)
      }),
    [sessionId],
  )

  return { ...conv, loadEarlier }
}
