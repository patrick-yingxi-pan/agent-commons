/** ── The app's conversation store instance (universal split, Phase 1) ────────
 *  The thin wiring around the pure keyed store (conversationCore.ts): the real
 *  api commands as the transport, the usage-gauge invalidation on turn settle,
 *  and the React subscription hook. Panes (and, in Phase 1, the singleton
 *  controller's active session) read conversation state ONLY through here. */
import { useCallback, useSyncExternalStore } from 'react'
import { sendMessage, reattachTurn, cancelTurn, invalidate, keys } from '../api'
import { EMPTY_LIVE } from '../data/liveSession'
import { createConversationStore, type ConversationState } from './conversationCore'

export const conversations = createConversationStore(
  {
    sendMessage: (sessionId, text, handlers) => sendMessage(sessionId, text, handlers),
    reattachTurn: (sessionId, turnId, fromSeq, handlers) => reattachTurn(sessionId, turnId, fromSeq, handlers),
    cancelTurn,
    // The turn consumed real tokens, and a persisted turn grew the thread's
    // context — refresh the usage gauge for this session.
    onTurnSettled: (sessionId) => invalidate(keys.usage(sessionId)),
  },
  // EMPTY_LIVE is shared by reference on purpose: every mutation is immutable,
  // so the blank template is never written to.
  () => EMPTY_LIVE,
)

/** Subscribe a component to one session's conversation state. */
export function useConversation(id: string): ConversationState {
  const sub = useCallback((cb: () => void) => conversations.subscribe(id, cb), [id])
  return useSyncExternalStore(sub, () => conversations.get(id))
}
