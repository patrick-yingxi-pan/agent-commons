/** App wiring for the serialized atomic context-state queue. */
import { onAccountSwitch, updateSessionContextState } from '../api'
import type { Live } from '../data/liveSession'
import { conversations } from './conversationStore'
import { contextFocusAfterCommit, createContextMutationController, type ContextMutationIntent } from './contextMutationsCore'
import { rememberPanelPreference } from './panelPreferences'

const controller = createContextMutationController({
  snapshot: (sessionId) => {
    const state = conversations.get(sessionId)
    return { live: state.live, focus: state.focus }
  },
  mutate: updateSessionContextState,
  commit: (sessionId, before, planned, returned) => {
    const current = conversations.get(sessionId)
    const live: Live = { ...current.live, ...returned.workspace }
    conversations.setLive(sessionId, live)

    // The acknowledgement may arrive after the user deliberately picked a
    // different panel. Apply the intent's focus only when it is still based on
    // the same focus the request saw; always clear a focus the committed
    // workspace made invalid.
    const decision = contextFocusAfterCommit(current.focus, before.focus, planned.focus, live)
    if (decision.focus !== current.focus) conversations.setFocus(sessionId, decision.focus)
    // An own SSE echo can project the planned focus before the HTTP
    // acknowledgement. Still persist it: otherwise an auto-opened repo/folder
    // looks right now but silently reverts on reopen. A genuinely different,
    // still-valid user focus remains theirs and its own focus door persists it.
    if (decision.remember) rememberPanelPreference(sessionId, decision.focus)
  },
  setStatus: (sessionId, contextMutation) => conversations.patch(sessionId, { contextMutation }),
})

// The conversation store is account-scoped; its mutation queue must cross the
// same staleness fence or a late acknowledgement could resurrect old-account UI.
onAccountSwitch(() => controller.clearAll())

export function enqueueContextMutation(sessionId: string, intent: ContextMutationIntent): void {
  controller.enqueue(sessionId, intent)
}

export function retryContextMutation(sessionId: string): void {
  controller.retry(sessionId)
}
