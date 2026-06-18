import { motion } from 'framer-motion'
import { GitBranch, PanelsTopLeft, PanelRightClose, PanelRightOpen } from 'lucide-react'
import type { Artifact, Capability, Connector, DiffLine, FileNode } from '../types'
import { connectorIconFor } from '../lib/connectors'
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

export function WorkspacePanel({
  state,
  collapsed,
  onToggle,
}: {
  state: PanelState
  collapsed: boolean
  onToggle: () => void
}) {
  const mode: 'repo' | 'workspace' = state.caps.includes('repo') ? 'repo' : 'workspace'

  if (collapsed) {
    return (
      <div className="flex h-full w-11 shrink-0 flex-col items-center gap-3 border-l border-line bg-panel py-2">
        <button
          onClick={onToggle}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-soft transition hover:bg-surface hover:text-ink"
          title="Expand workspace panel"
        >
          <PanelRightOpen size={17} />
        </button>
        <div className="flex flex-col items-center gap-2 pt-1 text-ink-faint">
          {mode === 'repo' ? <GitBranch size={15} /> : <PanelsTopLeft size={15} />}
        </div>
      </div>
    )
  }

  return (
    <motion.div
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: 388, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 30 }}
      className="flex h-full shrink-0 flex-col overflow-hidden border-l border-line bg-panel"
    >
      <div className="flex w-[388px] flex-1 flex-col">
        {/* Slim header strip */}
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-2 py-1.5">
          <button
            onClick={onToggle}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-soft transition hover:bg-surface hover:text-ink"
            title="Collapse panel"
          >
            <PanelRightClose size={17} />
          </button>
          <span className="flex items-center gap-1.5 text-sm font-semibold text-ink">
            {mode === 'repo' ? <GitBranch size={15} /> : <PanelsTopLeft size={15} />}
            {mode === 'repo' ? 'Repository' : 'Workspace'}
          </span>
          <div className="ml-auto flex items-center gap-1">
            {state.connectors.map((c) => {
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
          </div>
        </div>

        {/* Morphing body. A keyed plain element (CSS-animated) rather than
            AnimatePresence mode="wait" — the latter can deadlock on a key swap
            (StrictMode re-render / throttled rAF) and leave the panel stuck at
            opacity 0. Here the resting state is always visible. */}
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
      </div>
    </motion.div>
  )
}
