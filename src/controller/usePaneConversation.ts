/** ── A split pane's conversation (universal split Phase 3) ───────────────────
 *  Subscribes a pane to one session's keyed conversation state and runs the
 *  same open-time recipe the primary's selectSession runs — seed from the
 *  account-scoped API cache, reconcile from the server, resurface a
 *  held escalation (C28), reattach to a still-generating turn (invariant I1) —
 *  WITHOUT touching the singleton's navigation. A pane on the session the
 *  primary already holds finds a non-pristine entry and simply shares it (the
 *  store dedupes by key); mounting never resets an entry that has state, so a
 *  duplicate pane can't stale its twin's stream. */
import { useCallback, useEffect } from 'react'
import { DRAFT_ID, focusValidIn, liveFromSession, unresolvedEscalation, type Live } from '../data/liveSession'
import { keys, loadEarlierSession, loadSession, onSessionPush, peek } from '../api'
import { getPanelPref } from '../lib/panelPrefs'
import { conversations, useConversation } from './conversationStore'
import { rememberPanelPreference, resolvePanelPreference } from './panelPreferences'
import { canSeedConversationFromCache, type ConversationState, type PaneReadReceipt } from './conversationCore'
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
function reconcileNow(sessionId: string, after?: (s: Session, receipt: PaneReadReceipt) => void): void {
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
        if (conversations.isPaneReadCurrent(sessionId, receipt)) after?.(s, receipt)
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
      if (conversations.isPaneReadLatest(sessionId, receipt)) after?.(s, receipt)
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
    // Only this account's previously read detail can seed an initial paint.
    // Bundled demo transcripts are never evidence of access or saved content.
    if (canSeedConversationFromCache(entry)) {
      const seed = peek<Session>(keys.session(sessionId))
      if (seed?.id === sessionId) conversations.reset(sessionId, liveFromSession(seed))
      // Restore the session's remembered panel (FWD-2): a stored focus, or
      // null (explicitly closed) — both honoured over the auto-open; with no
      // stored choice, the strongest present context opens.
      const pref = getPanelPref(sessionId)
      conversations.setFocus(sessionId, pref !== undefined ? pref : strongestFocus(conversations.get(sessionId).live))
    }

    // Every eligible read can discover a newly started remote turn. The pane
    // owns only this subscription lease; the shared store owns stream dedupe.
    const observation = {
      epoch: conversations.epoch(sessionId),
      active: true,
    }
    const observeActiveTurn = (s: Session, receipt: PaneReadReceipt): void => {
      if (
        !observation.active ||
        conversations.epoch(sessionId) !== observation.epoch
      ) return
      // A turn still generating server-side: resume rendering its stream
      // (replay from the top, then the live tail — invariant I1).
      if (s.activeTurnId) void conversations.observeTurn(sessionId, s.activeTurnId, receipt)
    }
    // Subscribe before the first GET so a push cannot fall into the gap between
    // mount reconciliation and listener setup. Both paths use the same fences.
    const unsubscribe = onSessionPush((sid) => {
      if (sid !== sessionId || sessionId === DRAFT_ID) return
      reconcileNow(sessionId, observeActiveTurn)
    })
    // A fast next turn can start while this client's previous stream is still
    // settling. Its push must not overwrite the old stream, but it also cannot
    // be lost: refresh once at the busy→idle boundary to discover current truth.
    let wasBusy = conversations.get(sessionId).busy || conversations.get(sessionId).typing
    const unsubscribeIdle = conversations.subscribe(sessionId, () => {
      const state = conversations.get(sessionId)
      const busy = state.busy || state.typing
      const becameIdle = wasBusy && !busy
      wasBusy = busy
      if (becameIdle && observation.active && conversations.epoch(sessionId) === observation.epoch) {
        reconcileNow(sessionId, observeActiveTurn)
      }
    })
    reconcileNow(sessionId, observeActiveTurn)
    return () => {
      observation.active = false
      unsubscribe()
      unsubscribeIdle()
    }
  }, [sessionId])

  return { ...conv, loadEarlier }
}
