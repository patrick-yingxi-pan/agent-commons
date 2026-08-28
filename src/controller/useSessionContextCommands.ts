/** ── A pane's session-context commands (universal split Phase 4) ─────────────
 *  The session-parametric attach / detach funnels shared by every pane that can
 *  change a session's context — a conversation pane's composer (add context,
 *  remove a chip / folder), a context-panel pane's remove affordances
 *  (disconnect a connector, drop an attachment / folder), and a relation card's
 *  confirmed attach-context op alike. Every command enters the per-session FIFO
 *  and commits the binding-of-record + visible workspace through one atomic
 *  server mutation before projecting it locally. A pane
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
import { rememberAttached } from '../lib/contextShortcuts'
import { enqueueContextMutation } from './contextMutations'
import type { ContextMutationOutcome } from './contextMutationsCore'
import {
  addContextToLive,
  bindingsFor,
  detachOperationsForFocuses,
  focusForAdded,
  focusValidIn,
  removeAttachmentFromLive,
  removeContextsFromLive,
  removeFolderFromLive,
} from '../data/liveSession'
import type { AddedContext, PanelFocus } from '../types'

export interface SessionContextCommands {
  addContext: (ctx: AddedContext) => Promise<ContextMutationOutcome>
  removeContexts: (focuses: PanelFocus[]) => Promise<ContextMutationOutcome>
  removeFolder: (sourceId: string) => Promise<ContextMutationOutcome>
  removeAttachment: (attId: string) => Promise<ContextMutationOutcome>
}

export function useSessionContextCommands(sessionId: string): SessionContextCommands {
  const addContext = useCallback(
    (ctx: AddedContext) => {
      return enqueueContextMutation(sessionId, {
        plan: (snapshot) => {
          const live = addContextToLive(snapshot.live, ctx)
          return {
            live,
            focus: focusForAdded(ctx, live) ?? snapshot.focus,
            operations: bindingsFor(ctx).map((context) => ({ action: 'attach' as const, context })),
          }
        },
        afterCommit: () => rememberAttached(ctx),
      })
    },
    [sessionId],
  )
  const removeContexts = useCallback(
    (focuses: PanelFocus[]) => {
      return enqueueContextMutation(sessionId, {
        plan: (snapshot) => {
          const live = removeContextsFromLive(snapshot.live, focuses)
          return {
            live,
            focus: snapshot.focus && !focusValidIn(live, snapshot.focus) ? null : snapshot.focus,
            operations: detachOperationsForFocuses(snapshot.live, focuses),
          }
        },
      })
    },
    [sessionId],
  )
  const removeFolder = useCallback(
    (sourceId: string) => {
      return enqueueContextMutation(sessionId, {
        plan: (snapshot) => {
          const live = removeFolderFromLive(snapshot.live, sourceId)
          return {
            live,
            focus: snapshot.focus && !focusValidIn(live, snapshot.focus) ? null : snapshot.focus,
            operations: [{ action: 'detach', contextId: sourceId }],
          }
        },
      })
    },
    [sessionId],
  )
  const removeAttachment = useCallback(
    (attId: string) => {
      return enqueueContextMutation(sessionId, {
        plan: (snapshot) => {
          const live = removeAttachmentFromLive(snapshot.live, attId)
          return {
            live,
            focus: snapshot.focus && !focusValidIn(live, snapshot.focus) ? null : snapshot.focus,
            operations: [{ action: 'detach', contextId: attId }],
          }
        },
      })
    },
    [sessionId],
  )
  return { addContext, removeContexts, removeFolder, removeAttachment }
}
