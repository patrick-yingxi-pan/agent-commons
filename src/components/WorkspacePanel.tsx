import type { ReactNode } from 'react'
import { FolderGit2, GitBranch, Github, PanelsTopLeft } from 'lucide-react'
import type { Repo, Workspace } from '../types'
import { PanelShell } from './PanelShell'
import { ArtifactPanel } from './panels/ArtifactPanel'
import { CodePanel } from './panels/CodePanel'

/** A repo's origin shown in the panel header — a property of the repo itself
 *  (where it lives / its remote), not the account-level GitHub connector. */
function OriginBadge({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex max-w-[190px] items-center gap-1 rounded-full bg-cap-repo-tint px-1.5 py-0.5 text-[11px] font-medium text-cap-repo">
      {icon}
      <span className="truncate">{children}</span>
    </span>
  )
}

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
  // The repo header shows its own origin — a local path and/or a GitHub remote.
  const originBadges =
    mode === 'repo' && repo ? (
      repo.origin === 'local' ? (
        <>
          <OriginBadge icon={<FolderGit2 size={11} />}>{repo.path ?? repo.label}</OriginBadge>
          {repo.remote && <OriginBadge icon={<Github size={11} />}>{repo.remote}</OriginBadge>}
        </>
      ) : (
        <OriginBadge icon={<Github size={11} />}>{repo.remote ?? repo.label}</OriginBadge>
      )
    ) : null
  return (
    <PanelShell
      icon={mode === 'repo' ? <GitBranch size={15} /> : <PanelsTopLeft size={15} />}
      title={mode === 'repo' ? 'Repository' : 'Workspace'}
      onClose={onClose}
      headerRight={originBadges}
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
