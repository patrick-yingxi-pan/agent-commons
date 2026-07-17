/** ── A session's escalation-approval funnel (consent, C27/C29) ───────────────
 *  The ONE place an approved escalation proposal lands — extracted from the
 *  conversation pane so the business rules live with the controllers, not in
 *  a component file. Session-parametric like its siblings
 *  (useSessionContextCommands): every host approves through the same rules.
 *
 *  A `project` escalation applies the create-project relation op and STAYS in
 *  the thread (C29 — approval never navigates away; the message's confirmed
 *  card carries the "Open project" jump link to follow at will). A workspace /
 *  repo escalation lands the panels optimistically, opens the GROWN context's
 *  panel (remembered, FWD-2), and persists BOTH server-owned facets exactly
 *  like a manual attach (C27): the binding-of-record the effect-mediation path
 *  resolves against, and the panel content — or a reload would silently drop
 *  what the user just consented to grow. */
import { useCallback } from 'react'
import { applyRelationOp, attachContext, persistWorkspace } from '../api'
import { conversations } from './conversationStore'
import { setPanelPref } from '../lib/panelPrefs'
import {
  DRAFT_ID,
  applyEscalationToLive,
  escalationBinding,
  folderLabel,
  workspaceOf,
} from '../data/liveSession'
import type { PanelFocus } from '../types'

export function useSessionEscalation(
  sessionId: string,
  /** The session's display title (labels the default workspace). */
  sessionLabel: (id: string) => string,
): (workspaceRoot?: string) => void {
  return useCallback(
    (workspaceRoot?: string) => {
      const pending = conversations.get(sessionId).pendingEscalation
      if (!pending) return
      const esc = pending.escalation
      if (esc.kind === 'project') {
        applyRelationOp({
          kind: 'create-project',
          projectId: esc.project.id,
          projectName: esc.project.name,
          projectDescription: esc.project.description,
          ...(esc.fileSession ? { sessionId, sessionTitle: sessionLabel(sessionId) } : {}),
        })
      } else {
        const label = workspaceRoot ? folderLabel(workspaceRoot) : `${sessionLabel(sessionId)} files`
        const next = applyEscalationToLive(conversations.get(sessionId).live, esc, label)
        conversations.setLive(sessionId, next)
        // The escalation's payoff: the GROWN context's panel opens (the wide
        // tier tiles it beside the conversation; the overlay tiers dock it) —
        // and the choice is remembered (FWD-2).
        const grown: PanelFocus | null =
          esc.kind === 'workspace'
            ? { kind: 'workspace', id: 'ws-demo' }
            : esc.kind === 'repo'
              ? { kind: 'repo', id: 'repo-demo' }
              : null
        if (grown) {
          conversations.setFocus(sessionId, grown)
          if (sessionId !== DRAFT_ID) setPanelPref(sessionId, grown)
        }
        const binding = escalationBinding(esc, label, workspaceRoot)
        if (binding) void attachContext(sessionId, binding).catch(() => {})
        void persistWorkspace(sessionId, workspaceOf(next)).catch(() => {})
      }
      conversations.patch(sessionId, { pendingEscalation: null })
    },
    [sessionId, sessionLabel],
  )
}
