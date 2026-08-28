/** ── A session's escalation-approval funnel (consent, C27/C29) ───────────────
 *  The ONE place an approved escalation proposal lands — extracted from the
 *  conversation pane so the business rules live with the controllers, not in
 *  a component file. Session-parametric like its siblings
 *  (useSessionContextCommands): every host approves through the same rules.
 *
 *  A `project` escalation applies the create-project relation op and STAYS in
 *  the thread (C29 — approval never navigates away; the message's confirmed
 *  card carries the "Open project" jump link to follow at will). A workspace /
 *  repo escalation plans the grown panels, then publishes them only after the
 *  server acknowledges both facets; it opens the GROWN context's panel
 *  (remembered, FWD-2), and persists BOTH server-owned facets exactly
 *  like a manual attach (C27): the binding-of-record the effect-mediation path
 *  resolves against, and the panel content — or a reload would silently drop
 *  what the user just consented to grow. */
import { useCallback } from 'react'
import { conversations } from './conversationStore'
import { enqueueContextMutation } from './contextMutations'
import { useRelations } from './useRelations'
import {
  applyEscalationToLive,
  escalationBinding,
  folderLabel,
} from '../data/liveSession'
import type { PanelFocus } from '../types'

export function useSessionEscalation(
  sessionId: string,
  /** The session's display title (labels the default workspace). */
  sessionLabel: (id: string) => string,
): (workspaceRoot?: string) => void {
  const { applyOp } = useRelations()
  return useCallback(
    (workspaceRoot?: string) => {
      const pending = conversations.get(sessionId).pendingEscalation
      if (!pending) return
      const esc = pending.escalation
      let result: Promise<'applied' | 'discarded'>
      if (esc.kind === 'project') {
        result = applyOp({
          kind: 'create-project',
          projectId: esc.project.id,
          projectName: esc.project.name,
          projectDescription: esc.project.description,
          ...(esc.fileSession ? { sessionId, sessionTitle: sessionLabel(sessionId) } : {}),
        })
      } else {
        const label = workspaceRoot ? folderLabel(workspaceRoot) : `${sessionLabel(sessionId)} files`
        // The escalation's payoff: the GROWN context's panel opens (the wide
        // tier tiles it beside the conversation; the overlay tiers dock it) —
        // and the choice is remembered (FWD-2).
        const grown: PanelFocus | null =
          esc.kind === 'workspace'
            ? { kind: 'workspace', id: 'ws-demo' }
            : esc.kind === 'repo'
              ? { kind: 'repo', id: 'repo-demo' }
              : null
        const binding = escalationBinding(esc, label, workspaceRoot)
        result = enqueueContextMutation(sessionId, {
          plan: (snapshot) => ({
            live: applyEscalationToLive(snapshot.live, esc, label),
            focus: grown ?? snapshot.focus,
            operations: binding ? [{ action: 'attach', context: binding }] : [],
          }),
        })
      }
      void result.then((outcome) => {
        if (outcome !== 'applied') return
        conversations.update(sessionId, (current) =>
          current.pendingEscalation?.messageId === pending.messageId
            ? { ...current, pendingEscalation: null }
            : current,
        )
      })
    },
    [sessionId, sessionLabel, applyOp],
  )
}
