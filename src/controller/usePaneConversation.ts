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
import { liveFromSession, unresolvedEscalation } from '../data/liveSession'
import { keys, loadSession, peek } from '../api'
import { conversations, useConversation } from './conversationStore'
import type { ConversationState } from './conversationCore'
import type { RelationGraph } from '../types'

export function usePaneConversation(sessionId: string): ConversationState {
  const conv = useConversation(sessionId)

  useEffect(() => {
    const entry = conversations.get(sessionId)
    const pristine = entry.live.messages.length === 0 && !entry.busy && !entry.typing
    // Seed a pristine entry from the local mirror so the thread paints at once
    // (the primary's exact recipe); a lived-in entry is shared as-is.
    if (pristine) {
      const seed = SESSIONS.find((s) => s.id === sessionId)
      if (seed) conversations.reset(sessionId, liveFromSession(seed))
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
        const held = unresolvedEscalation(s, reconciled, peek<RelationGraph>(keys.relations))
        if (held) conversations.holdEscalation(sessionId, held)
        if (s.activeTurnId && !conversations.get(sessionId).liveTurn) conversations.reattach(sessionId, s.activeTurnId)
      })
      .catch(() => {})
  }, [sessionId])

  return conv
}
