/** ── A pane's session-context commands (universal split Phase 4) ─────────────
 *  The session-parametric attach / detach funnels shared by every pane that can
 *  change a session's context — a conversation pane's composer (add context,
 *  remove a chip / folder) and a context-panel pane's remove affordances
 *  (disconnect a connector, drop an attachment / folder) alike. Each command is
 *  the exact building block the singleton controller composes: the persistent
 *  binding-of-record (Primitive 1) written through, the optimistic `live` as the
 *  instant driver, and the workspace persisted so a runtime change survives a
 *  reload. A pane session is always real, so there is no draft-buffering branch.
 *  One hook, so the mapping can't fork per host (the "one door" rule). */
import { useCallback } from 'react'
import { attachContext, detachContext, persistWorkspace } from '../api'
import { conversations } from './conversationStore'
import { rememberAttached } from '../lib/contextShortcuts'
import {
  addContextToLive,
  bindingsFor,
  removeAttachmentFromLive,
  removeContextsFromLive,
  removeFolderFromLive,
  workspaceOf,
} from '../data/liveSession'
import type { AddedContext, PanelFocus } from '../types'

export interface SessionContextCommands {
  addContext: (ctx: AddedContext) => void
  removeContexts: (focuses: PanelFocus[]) => void
  removeFolder: (sourceId: string) => void
  removeAttachment: (attId: string) => void
}

export function useSessionContextCommands(sessionId: string): SessionContextCommands {
  const addContext = useCallback(
    (ctx: AddedContext) => {
      rememberAttached(ctx)
      for (const b of bindingsFor(ctx)) void attachContext(sessionId, b).catch(() => {})
      const next = addContextToLive(conversations.get(sessionId).live, ctx)
      conversations.setLive(sessionId, next)
      void persistWorkspace(sessionId, workspaceOf(next)).catch(() => {})
    },
    [sessionId],
  )
  const removeContexts = useCallback(
    (focuses: PanelFocus[]) => {
      for (const f of focuses) void detachContext(sessionId, f.id).catch(() => {})
      const next = removeContextsFromLive(conversations.get(sessionId).live, focuses)
      conversations.setLive(sessionId, next)
      void persistWorkspace(sessionId, workspaceOf(next)).catch(() => {})
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
    },
    [sessionId],
  )
  const removeAttachment = useCallback(
    (attId: string) => {
      void detachContext(sessionId, attId).catch(() => {})
      const next = removeAttachmentFromLive(conversations.get(sessionId).live, attId)
      conversations.setLive(sessionId, next)
      void persistWorkspace(sessionId, workspaceOf(next)).catch(() => {})
    },
    [sessionId],
  )
  return { addContext, removeContexts, removeFolder, removeAttachment }
}
