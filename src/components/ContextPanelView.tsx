/** ── The ONE context-panel surface (universal split Phase 4) ─────────────────
 *  The panel-side twin of ConversationView: the fully-fledged view of a
 *  session's attached context — workspace / repo / connector / files / photos /
 *  the run switcher — resolved against the OWNING session's keyed live (so a
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
import { PaneChromeContext, type PaneChrome } from './paneChrome'
import { WorkspacePanel } from './WorkspacePanel'
import { ConnectorPanel } from './ConnectorPanel'
import { AttachmentPanel } from './AttachmentPanel'
import { RunsPanel } from './RunsPanel'
import { usePaneConversation } from '../controller/usePaneConversation'
import { useSessionContextCommands } from '../controller/useSessionContextCommands'
import { contextPaneId } from '../lib/mainSplit'
import type { PaneContent } from '../lib/splitFrame'

// Fill the pane, no width/motion, no per-pane X (the rail cluster closes the
// focused pane — homogeneous with every other pane; the frozen value keeps the
// embedded panels from re-rendering on unrelated tree edits).
const EMBEDDED: PaneChrome = { embedded: true }
const noop = () => {}

export function ContextPanelView({
  sessionId,
  panel,
  onOpenSession,
  onOpenSchedule,
}: {
  sessionId: string
  panel: PaneContent
  /** Global doors the run switcher hands off (open a run session / its routine)
   *  — these land on the primary surface where conversations live. */
  onOpenSession: (id: string) => void
  onOpenSchedule: (taskId: string) => void
}) {
  // Ensure the OWNING session's live is loaded (the pane's open recipe — guarded
  // and deduped, so it never stomps a conversation pane already showing it).
  const { live } = usePaneConversation(sessionId)
  const { removeContexts, removeFolder, removeAttachment } = useSessionContextCommands(sessionId)

  const body = (() => {
    switch (panel.kind) {
      case 'workspace': {
        const w = live.workspaces.find((x) => x.id === panel.id)
        return w ? <WorkspacePanel mode="workspace" workspace={w} onClose={noop} onRemoveFolder={removeFolder} /> : null
      }
      case 'repo': {
        const r = live.repos.find((x) => x.id === panel.id)
        return r ? <WorkspacePanel mode="repo" repo={r} onClose={noop} onRemoveFolder={removeFolder} /> : null
      }
      case 'connector': {
        const c = live.connectors.find((x) => x.id === panel.id)
        return c ? (
          <ConnectorPanel connector={c} onClose={noop} onDisconnect={() => removeContexts([{ kind: 'connector', id: c.id }])} />
        ) : null
      }
      case 'file':
      case 'photo':
        return (
          <AttachmentPanel
            kind={panel.kind}
            items={live.attachments.filter((a) => a.kind === panel.kind)}
            initialId={panel.id}
            onClose={noop}
            onRemove={removeAttachment}
          />
        )
      case 'runs':
        return (
          <RunsPanel
            taskId={panel.id}
            activeRunSessionId={sessionId}
            onSelectRun={onOpenSession}
            onOpenRoutine={onOpenSchedule}
            onClose={noop}
          />
        )
      default:
        return null
    }
  })()

  return (
    <PaneChromeContext.Provider value={EMBEDDED}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-context-pane={contextPaneId(sessionId, panel)}>
        {/* A pane whose content was just detached (before the tree prunes it a
            frame later) shows a quiet placeholder rather than a blank pane. */}
        {body ?? (
          <div className="flex h-full flex-col items-center justify-center bg-panel px-6 text-center text-sm text-ink-faint">
            This context is no longer attached.
          </div>
        )}
      </div>
    </PaneChromeContext.Provider>
  )
}
