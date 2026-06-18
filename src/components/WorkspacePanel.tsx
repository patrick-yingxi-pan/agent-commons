import { GitBranch, PanelsTopLeft } from 'lucide-react'
import type { Artifact, Capability, Connector, DiffLine, FileNode } from '../types'
import { connectorIconFor } from '../lib/connectors'
import { PanelShell } from './PanelShell'
import { ArtifactPanel } from './panels/ArtifactPanel'
import { CodePanel } from './panels/CodePanel'

export interface PanelState {
  caps: Capability[]
  artifacts: Artifact[]
  files: FileNode[]
  diff: DiffLine[]
  terminal: string[]
  connectors: Connector[]
  branch: string
  workspaceName: string
}

/** The workspace ⇄ repo sidebar. `mode` is supplied by the focused chip, so the
 *  same panel can show artifacts (workspace) or code (repo); switching mode
 *  morphs the body. */
export function WorkspacePanel({
  mode,
  state,
  onClose,
}: {
  mode: 'workspace' | 'repo'
  state: PanelState
  onClose: () => void
}) {
  return (
    <PanelShell
      icon={mode === 'repo' ? <GitBranch size={15} /> : <PanelsTopLeft size={15} />}
      title={mode === 'repo' ? 'Repository' : 'Workspace'}
      onClose={onClose}
      headerRight={state.connectors.map((c) => {
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
              files={state.files}
              diff={state.diff}
              terminal={state.terminal}
              branch={state.branch}
            />
          ) : (
            <ArtifactPanel artifacts={state.artifacts} workspaceName={state.workspaceName} />
          )}
        </div>
      </div>
    </PanelShell>
  )
}
