/** ── The ONE context-panel surface (universal split Phase 4) ─────────────────
 *  The panel-side twin of ConversationView: the fully-fledged view of a
 *  session's attached context — workspace / repo / connector / files / photos
 *  — resolved against the OWNING session's keyed live (so a
 *  context pane tracks ITS session's attaches, not the primary's) and rendered
 *  edge to edge in its pane. It is a FULL pane in the one main split tree, no
 *  longer a separate right frame that split its own inner view (ADAPT-16,
 *  retired): closed and split by the rail cluster like every other pane, so the
 *  embedded PanelShell drops its own X (paneChrome `embedded`, no `onClosePane`).
 *
 *  MVC per pane (mirrors ConversationView): model = the owning session's keyed
 *  live + shared api hooks; view = this component + the existing panel bodies;
 *  controller = the session-parametric mutation funnels (useSessionContextCommands,
 *  the same the composer's chip-remove uses — one funnel, no fork). */
import { useEffect } from 'react'
import { workspaceInputAttachments } from '../../contract/attachmentInput.ts'
import { PaneChromeContext, type PaneChrome } from './paneChrome'
import { DeferredWorkspacePanel as WorkspacePanel } from './DeferredWorkspacePanel'
import { DeferredConnectorContextPanel as ConnectorPanel } from './DeferredConnectorContextPanel'
import { DeferredAttachmentPanel } from './DeferredAttachmentPanel'
import { DeferredDiscussionContextPanel } from './DeferredDiscussionContextPanel'
import { DeferredArtifactContextPanel } from './DeferredArtifactContextPanel'
import { usePaneConversation } from '../controller/usePaneConversation'
import { focusValidIn } from '../data/liveSession'
import { useSessionContextCommands } from '../controller/useSessionContextCommands'
import { useContextWritable } from '../controller/useContextWritable'
import { dismissContextMutation, retryContextMutation } from '../controller/contextMutations'
import { isContextMutationHeld } from '../controller/conversationCore'
import { ContextMutationNotice } from './ContextMutationNotice'
import { contextPaneId } from '../lib/mainSplit'
import type { PaneContent } from '../lib/splitFrame'

const noop = () => {}

export function ContextPanelView({
  sessionId,
  panel,
  onGone,
}: {
  sessionId: string
  panel: PaneContent
  /** LIVE PRUNE: called once the panel's subject is DEFINITIVELY gone — the
   *  owning session's entry reflects a server read (`reconciled`, the
   *  authority latch) and the panel no longer resolves in it. The tree host
   *  closes this pane; hosts without a tree omit it and keep the quiet
   *  placeholder. */
  onGone?: () => void
}) {
  // Ensure the OWNING session's live is loaded (the pane's open recipe — guarded
  // and deduped, so it never stomps a conversation pane already showing it).
  const { live, reconciled, contextMutation } = usePaneConversation(sessionId)
  const { removeContexts, removeFolder, removeAttachment } = useSessionContextCommands(sessionId)
  const inputAttachments = workspaceInputAttachments(live)
  const writable = useContextWritable(sessionId)

  const body = (() => {
    switch (panel.kind) {
      case 'workspace': {
        const w = live.workspaces.find((x) => x.id === panel.id)
        return w ? <WorkspacePanel mode="workspace" workspace={w} inputAttachments={inputAttachments} onClose={noop} onRemoveFolder={writable ? removeFolder : undefined} refreshSessionId={writable ? sessionId : undefined} refreshDisabled={isContextMutationHeld(contextMutation)} /> : null
      }
      case 'repo': {
        const r = live.repos.find((x) => x.id === panel.id)
        return r ? <WorkspacePanel mode="repo" repo={r} onClose={noop} onRemoveFolder={writable ? removeFolder : undefined} /> : null
      }
      case 'connector': {
        const c = live.connectors.find((x) => x.id === panel.id)
        return c ? (
          <ConnectorPanel connector={c} onClose={noop} onDisconnect={writable ? () => removeContexts([{ kind: 'connector', id: c.id }]) : undefined} />
        ) : null
      }
      case 'artifact': {
        const attachment = live.attachments.find((item) => item.kind === 'artifact' && item.id === panel.id)
        return attachment ? <DeferredArtifactContextPanel sessionId={sessionId} attachment={attachment} /> : null
      }
      case 'discussion': {
        const attachment = live.attachments.find((item) => item.kind === 'discussion' && item.id === panel.id)
        return attachment ? <DeferredDiscussionContextPanel sessionId={sessionId} attachment={attachment} /> : null
      }
      case 'file':
      case 'photo': {
        if (!focusValidIn(live, panel)) return null
        return (
          <DeferredAttachmentPanel
            kind={panel.kind}
            items={live.attachments.filter((a) => a.kind === panel.kind)}
            allAttachments={inputAttachments}
            initialId={panel.id}
            onClose={noop}
            onRemove={writable ? removeAttachment : undefined}
            refreshSessionId={writable ? sessionId : undefined}
            refreshDisabled={isContextMutationHeld(contextMutation)}
          />
        )
      }
      default:
        return null
    }
  })()

  // LIVE PRUNE: an unresolvable panel is only DEFINITIVELY gone once the
  // session's entry reflects a server read (`reconciled` — the authority
  // latch; a mirror-seeded live missing a runtime attach is a transient
  // unknown, never a prune signal).
  const gone = !body && reconciled
  useEffect(() => {
    if (gone) onGone?.()
  }, [gone, onGone])

  const chrome: PaneChrome = {
    embedded: true,
    footer: (
      <ContextMutationNotice
        state={contextMutation}
        onRetry={() => retryContextMutation(sessionId)}
        onDismiss={() => dismissContextMutation(sessionId)}
        panel
      />
    ),
  }

  return (
    <PaneChromeContext.Provider value={chrome}>
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col" data-context-pane={contextPaneId(sessionId, panel)}>
        {/* A pane whose content was just detached (before the tree prunes it a
            frame later) shows a quiet placeholder rather than a blank pane. */}
        {body ?? (
          <div className="flex h-full flex-col items-center justify-center bg-panel px-6 text-center text-[13px] text-ink-faint">
            This context is no longer attached.
          </div>
        )}
      </div>
    </PaneChromeContext.Provider>
  )
}
