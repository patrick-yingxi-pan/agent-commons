/** ── A pane's session-context commands (universal split Phase 4) ─────────────
 *  The session-parametric attach / detach funnels shared by every pane that can
 *  change a session's context — a conversation pane's composer (add context,
 *  remove a chip / folder), a context-panel pane's remove affordances
 *  (disconnect a connector, drop an attachment / folder), and a relation card's
 *  confirmed attach-context op alike. Each command is the exact building block
 *  the pre-split controller composed: the persistent binding-of-record
 *  (Primitive 1) written through, the optimistic `live` as the instant driver,
 *  and the workspace persisted so a runtime change survives a reload. A pane
 *  session is always real, so there is no draft-buffering branch (a DRAFT
 *  host routes to the draft funnel instead — draft.addSeed).
 *  One hook, so the mapping can't fork per host (the "one door" rule).
 *
 *  Two session-panel side effects ride the funnels (they are part of the
 *  command, not per-host decoration):
 *   • attach OPENS the added context's panel (focusForAdded) and remembers the
 *     choice (FWD-2) — "you see what you added", every host;
 *   • every remove CLEARS the session's focus if it pointed at what was
 *     removed (focusValidIn) — an open panel never dangles on a detached
 *     context. */
import { useCallback } from 'react'
import { attachContext, detachContext, persistWorkspace } from '../api'
import { conversations } from './conversationStore'
import { rememberAttached } from '../lib/contextShortcuts'
import { setPanelPref } from '../lib/panelPrefs'
import {
  addContextToLive,
  bindingsFor,
  focusForAdded,
  focusValidIn,
  removeAttachmentFromLive,
  removeContextsFromLive,
  removeFolderFromLive,
  workspaceOf,
  type Live,
} from '../data/liveSession'
import type { AddedContext, PanelFocus } from '../types'

export interface SessionContextCommands {
  addContext: (ctx: AddedContext) => void
  removeContexts: (focuses: PanelFocus[]) => void
  removeFolder: (sourceId: string) => void
  removeAttachment: (attId: string) => void
}

/** Post-remove guard: a focus pointing at a context no longer in `next` clears
 *  (and the cleared state is remembered, FWD-2 — reopening must not resurrect
 *  a panel whose subject is gone). */
function clearDanglingFocus(sessionId: string, next: Live) {
  const focus = conversations.get(sessionId).focus
  if (focus && !focusValidIn(next, focus)) {
    conversations.setFocus(sessionId, null)
    setPanelPref(sessionId, null)
  }
}

export function useSessionContextCommands(sessionId: string): SessionContextCommands {
  const addContext = useCallback(
    (ctx: AddedContext) => {
      rememberAttached(ctx)
      for (const b of bindingsFor(ctx)) void attachContext(sessionId, b).catch(() => {})
      const next = addContextToLive(conversations.get(sessionId).live, ctx)
      conversations.setLive(sessionId, next)
      void persistWorkspace(sessionId, workspaceOf(next)).catch(() => {})
      // Open the newly attached context's panel so you see what you added —
      // and remember it (FWD-2). The wide tier tiles it beside the
      // conversation (the focus projection); the overlay tiers dock it.
      const f = focusForAdded(ctx, next)
      if (f) {
        conversations.setFocus(sessionId, f)
        setPanelPref(sessionId, f)
      }
    },
    [sessionId],
  )
  const removeContexts = useCallback(
    (focuses: PanelFocus[]) => {
      for (const f of focuses) void detachContext(sessionId, f.id).catch(() => {})
      const next = removeContextsFromLive(conversations.get(sessionId).live, focuses)
      conversations.setLive(sessionId, next)
      void persistWorkspace(sessionId, workspaceOf(next)).catch(() => {})
      clearDanglingFocus(sessionId, next)
    },
    [sessionId],
  )
  const removeFolder = useCallback(
    (sourceId: string) => {
      // Detach this folder's own binding-of-record — keyed by its source id, the
      // same id attach used — so it goes away even when other folders remain.
      void detachContext(sessionId, sourceId).catch(() => {})
      const next = removeFolderFromLive(conversations.get(sessionId).live, sourceId)
      conversations.setLive(sessionId, next)
      void persistWorkspace(sessionId, workspaceOf(next)).catch(() => {})
      clearDanglingFocus(sessionId, next)
    },
    [sessionId],
  )
  const removeAttachment = useCallback(
    (attId: string) => {
      void detachContext(sessionId, attId).catch(() => {})
      const next = removeAttachmentFromLive(conversations.get(sessionId).live, attId)
      conversations.setLive(sessionId, next)
      void persistWorkspace(sessionId, workspaceOf(next)).catch(() => {})
      clearDanglingFocus(sessionId, next)
    },
    [sessionId],
  )
  return { addContext, removeContexts, removeFolder, removeAttachment }
}
