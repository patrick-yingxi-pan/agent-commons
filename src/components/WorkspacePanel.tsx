import { GitBranch, PanelsTopLeft } from 'lucide-react'
import type { Connector, Repo, Workspace } from '../types'
import { connectorIconFor } from '../lib/connectors'
import { PanelShell } from './PanelShell'
import { ArtifactPanel } from './panels/ArtifactPanel'
import { CodePanel } from './panels/CodePanel'

/** The workspace ⇄ repo sidebar. `mode` is supplied by the focused chip, so the
 *  same panel can show artifacts (workspace) or code (repo); switching mode
 *  morphs the body. The focused entity supplies the content. */
export function WorkspacePanel({
  mode,
  workspace,
  repo,
  onClose,
}: {
  mode: 'workspace' | 'repo'
  workspace?: Workspace
  repo?: Repo
  onClose: () => void
}) {
  const connectors: Connector[] = repo?.connector ? [repo.connector] : []
  return (
    <PanelShell
      icon={mode === 'repo' ? <GitBranch size={15} /> : <PanelsTopLeft size={15} />}
      title={mode === 'repo' ? 'Repository' : 'Workspace'}
      onClose={onClose}
      headerRight={connectors.map((c) => {
        const Icon = connectorIconFor(c.kind)
        return (
          <span
            key={c.id}
            className="inline-flex items-center gap-1 rounded-full bg-[#e9f0f3] px-1.5 py-0.5 text-[11px] font-medium text-cap-repo"
          >
            <Icon size={11} />
            {c.label}
          </span>
        )
      })}
    >
      {/* Morphing body. A keyed plain element (CSS-animated) rather than
          AnimatePresence mode="wait" — the latter can deadlock on a key swap
          and leave the panel stuck at opacity 0. Here the resting state is
          always visible. */}
      <div className="relative flex-1 overflow-hidden">
        <div key={mode} className="panel-morph absolute inset-0">
          {mode === 'repo' ? (
            <CodePanel
              files={repo?.files ?? []}
              diff={repo?.diff ?? []}
              terminal={repo?.terminal ?? []}
              branch={repo?.branch ?? 'main'}
            />
          ) : (
            <ArtifactPanel
              artifacts={workspace?.artifacts ?? []}
              workspaceName={workspace?.label ?? 'Workspace'}
            />
          )}
        </div>
      </div>
    </PanelShell>
  )
}
