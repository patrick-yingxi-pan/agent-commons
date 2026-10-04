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
import { DRAFT_ID, focusValidIn, liveFromSession, unresolvedEscalation, type Live } from '../data/liveSession'
import { keys, loadEarlierSession, loadSession, onSessionPush, peek } from '../api'
import { getPanelPref } from '../lib/panelPrefs'
import { conversations, useConversation } from './conversationStore'
import { rememberPanelPreference, resolvePanelPreference } from './panelPreferences'
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

/** Apply the server/local tri-state after every authoritative read, including
 * ambient pushes from another device. A stale local/server id becomes an
 * explicit close through the same durable funnel as a context removal. */
function reconcilePanelPreference(sessionId: string, session: Session, live: Live): void {
  let focus = resolvePanelPreference(sessionId, session.viewerPreferences)
  if (focus && !focusValidIn(live, focus)) {
    focus = null
    rememberPanelPreference(sessionId, null)
  }
  conversations.setFocus(sessionId, focus !== undefined ? focus : strongestFocus(live))
}

/** The ONE server-reconcile tail shared by mount and session-push reads: load
 *  the session, refuse to stomp a mid-stream entry, land the reconciled live,
 *  and resurface a persisted-but-unresolved escalation proposal (C28 — the
 *  record is the authority; holdEscalation never stomps a held prompt). */
function reconcileNow(sessionId: string, after?: (s: Session, reconciled: Live) => void): void {
  const receipt = conversations.beginPaneRead(sessionId)
  loadSession(sessionId)
    .then((s) => {
      // A newer pane read, changed context projection, reset, or account switch
      // makes this response ineligible before it can affect either transcript
      // or panel/reattach state.
      if (!conversations.isPaneReadCurrent(sessionId, receipt)) return
      const now = conversations.get(sessionId)
      const reconciled = liveFromSession(s)
      // Presentation intent is orthogonal to transcript reconciliation: a
      // remote close/open may land while this client is streaming a turn.
      if (now.busy || now.typing) {
        reconcilePanelPreference(sessionId, s, reconciled)
        // setFocus publishes synchronously; a subscriber may reset the store.
        // Recheck before the follow-up can start a reattach.
        if (conversations.isPaneReadCurrent(sessionId, receipt)) after?.(s, reconciled)
        return
      }
      if (!conversations.reconcile(sessionId, receipt, reconciled, s.messagePage)) return
      // reconcile publishes synchronously and may trigger account disposal.
      // The receipt's context generation has intentionally advanced from the
      // accepted projection; account and read order still fence follow-ups.
      if (!conversations.isPaneReadLatest(sessionId, receipt)) return
      const landed = conversations.get(sessionId).live
      reconcilePanelPreference(sessionId, s, landed)
      if (!conversations.isPaneReadLatest(sessionId, receipt)) return
      const held = unresolvedEscalation(s, landed, peek<RelationGraph>(keys.relations))
      if (held) conversations.holdEscalation(sessionId, held)
      if (conversations.isPaneReadLatest(sessionId, receipt)) after?.(s, landed)
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
    const pristine = entry.live.messages.length === 0 && !entry.composerText && !entry.busy && !entry.typing
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

    // The initial read owns one bootstrap obligation: resume a server turn
    // already active when this pane opened. If a session push supersedes that
    // read, carry the same one-shot obligation forward to the latest read; do
    // not make later pushes discover new turns for an already-open shared pane.
    const bootstrap = {
      epoch: conversations.epoch(sessionId),
      pending: true,
      active: true,
    }
    const reattachBootstrap = (s: Session): void => {
      if (!bootstrap.pending) return
      bootstrap.pending = false
      if (
        !bootstrap.active ||
        conversations.epoch(sessionId) !== bootstrap.epoch
      ) return
      // A turn still generating server-side: resume rendering its stream
      // (replay from the top, then the live tail — invariant I1).
      if (s.activeTurnId && !conversations.get(sessionId).liveTurn) conversations.reattach(sessionId, s.activeTurnId)
    }
    // Subscribe before the first GET so a push cannot fall into the gap between
    // mount reconciliation and listener setup. A superseding read inherits the
    // still-pending bootstrap callback, but only until one eligible response
    // consumes it.
    const unsubscribe = onSessionPush((sid) => {
      if (sid !== sessionId || sessionId === DRAFT_ID) return
      reconcileNow(sessionId, bootstrap.pending ? reattachBootstrap : undefined)
    })
    reconcileNow(sessionId, reattachBootstrap)
    return () => {
      bootstrap.active = false
      bootstrap.pending = false
      unsubscribe()
    }
  }, [sessionId])

  return { ...conv, loadEarlier }
}
