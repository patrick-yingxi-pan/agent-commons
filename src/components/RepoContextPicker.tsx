import { useState, type ReactNode } from 'react'
import { FolderGit2, Github } from 'lucide-react'
import type { AddedContext } from '../types'
import type { RepoCatalogOption } from '../../contract/contexts.ts'
import { GITHUB_CONNECTOR } from '../lib/connectors'
import { repoIdForLabel } from '../data/liveSession'
import { getDecision, setDecision } from '../lib/prefs'
import { SOFT_BUTTON_CLASS } from '../lib/button'
import { CheckSquare } from './Checkbox'
import { useRecentIds } from '../lib/recents'
import { useContextCatalog } from '../api/contextCatalog.ts'
import { ContextCatalogNotice } from './ContextCatalogNotice.tsx'
import { DeferredContextBrowseDialog as BrowseDialog } from './DeferredContextBrowseDialog.tsx'
import { RecentOverflowList } from './RecentOverflowList'
import { OptionRow } from './ContextOptionRow.tsx'
import { BrowseRow, MultiAddFooter, Section } from './ContextPickerParts.tsx'
import { NativeLocalGitPicker } from './LocalGitConnections.tsx'
import { localGitAvailable } from '../api/localGitCapability.ts'
import { FS_PICKER_BODY_CLASS } from '../lib/fsSourceLayout.ts'

type RepoContext = Extract<AddedContext, { kind: 'repo' }>

type RepoOption = RepoCatalogOption

const isLocalRepo = (o: RepoOption): o is Extract<RepoOption, { origin: 'local' }> => o.origin === 'local'
const isGithubRepo = (o: RepoOption): o is Extract<RepoOption, { origin: 'github' }> => o.origin === 'github'

function repoOptionToContext(o: RepoOption): RepoContext {
  if (isLocalRepo(o)) {
    return {
      kind: 'repo',
      origin: 'local',
      label: basename(o.path),
      path: o.path,
      remote: o.remote,
      branch: o.branch,
      files: o.files,
      diff: o.diff,
      terminal: o.terminal,
    }
  }
  return {
    kind: 'repo',
    origin: 'github',
    label: o.remote,
    remote: o.remote,
    branch: o.branch,
    files: o.files,
    diff: o.diff,
    terminal: o.terminal,
  }
}

/** The chip / panel name for a local repo — the trailing folder name. */
function basename(path: string) {
  const parts = path.replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] || path
}

/** A 3-choice attach confirmation shown inside the Add-context popover: Cancel
 *  aborts the whole attach; the secondary and primary buttons are the two
 *  outcomes; the ☐ remembers whichever outcome was picked. Used by both the
 *  repo connector prompt and the folder → repo / connector prompts. */
function AttachPromptCard({
  message,
  dontAsk,
  onToggleDontAsk,
  onCancel,
  secondaryLabel,
  onSecondary,
  primaryLabel,
  onPrimary,
}: {
  message: ReactNode
  dontAsk: boolean
  onToggleDontAsk: () => void
  onCancel: () => void
  secondaryLabel: string
  onSecondary: () => void
  primaryLabel: string
  onPrimary: () => void
}) {
  return (
    <div className="pb-1">
      <p className="px-1 text-[13px] leading-snug text-ink">{message}</p>
      <button
        type="button"
        onClick={onToggleDontAsk}
        className="mt-2 flex items-center gap-1.5 px-1 text-[11px] text-ink-soft transition hover:text-ink"
      >
        <CheckSquare checked={dontAsk} />
        Don’t ask again
      </button>
      <div className="mt-2.5 flex flex-wrap justify-end gap-1.5">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-2 py-1 text-[12px] font-medium text-ink-soft transition hover:bg-panel-2"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSecondary}
          className="rounded-md px-2 py-1 text-[12px] font-medium text-ink ring-1 ring-line-strong transition hover:bg-panel-2"
        >
          {secondaryLabel}
        </button>
        <button
          type="button"
          onClick={onPrimary}
          className={`${SOFT_BUTTON_CLASS} px-2 py-1 text-[12px]`}
        >
          {primaryLabel}
        </button>
      </div>
    </div>
  )
}

/** Repository picker: one merged "Recent repositories" list (local + GitHub,
 *  each row badged) plus a Browse explorer that groups the rest into Local /
 *  GitHub. Multi-add like the other pickers — a pick attaches without closing
 *  and the row flips to ✓ Added (off the live attached repos). Picking a repo
 *  that has a GitHub remote, when the connector isn't already attached, asks
 *  whether to add the connector too — Cancel returns to the list, "Just the repo"
 *  / "Add both" decide, and a remembered choice skips the prompt next time. */
export function RepoPicker({
  maxRows,
  onAdd,
  onClose,
  addedRepoIds,
  addedLocalGitIds,
  hasGitHubConnector,
}: {
  maxRows: number
  onAdd: (ctx: AddedContext) => void
  onClose: () => void
  /** Live-repo ids already attached — rows for these read ✓ Added. */
  addedRepoIds: readonly string[]
  /** Source-qualified native Git folders already attached to the workspace. */
  addedLocalGitIds: readonly string[]
  hasGitHubConnector: boolean
}) {
  const [pending, setPending] = useState<{ ctx: RepoContext; id: string } | null>(null)
  const [dontAsk, setDontAsk] = useState(false)
  const [browsing, setBrowsing] = useState(false)

  const labelOf = (o: RepoOption) => (o.origin === 'local' ? basename(o.path) : o.remote)
  const isAdded = (o: RepoOption) => addedRepoIds.includes(repoIdForLabel(labelOf(o)))

  const recentIds = useRecentIds('repo')
  const catalog = useContextCatalog()
  const options = catalog.data?.repos ?? []
  const byId = new Map(options.map((o) => [o.id, o]))
  const recent = recentIds.map((id) => byId.get(id)).filter(Boolean) as RepoOption[]
  // Browse lists what's neither recent nor already attached — so re-selecting an
  // attached repo can't re-fire its attach (and re-attach the GitHub connector).
  const rest = options.filter((o) => !recentIds.includes(o.id) && !isAdded(o))

  // Attach without closing and return to the list (clears any prompt). The
  // attach funnel promotes the repo into Recent (mapping it back by path/remote),
  // which this list reads reactively — so a browsed-in repo joins it at once.
  const finalize = (ctx: RepoContext, _id: string) => {
    onAdd(ctx)
    setPending(null)
  }

  const select = (o: RepoOption) => {
    const ctx = repoOptionToContext(o)
    // No GitHub remote, or the connector is already present → nothing to ask.
    if (!ctx.remote || hasGitHubConnector) return finalize(ctx, o.id)
    const decision = getDecision('linkOnAttach')
    if (decision === 'always') {
      onAdd({ kind: 'connector', connector: GITHUB_CONNECTOR })
      return finalize(ctx, o.id)
    }
    if (decision === 'never') return finalize(ctx, o.id)
    setDontAsk(false)
    setPending({ ctx, id: o.id })
  }

  if (pending) {
    return (
      <AttachPromptCard
        message={
          <>
            <span className="font-medium">{pending.ctx.label}</span> has a demo GitHub remote. Add the{' '}
            <span className="font-medium">demo GitHub connector</span> too? Sample data only; no code is pushed and no PR is opened.
          </>
        }
        dontAsk={dontAsk}
        onToggleDontAsk={() => setDontAsk((v) => !v)}
        onCancel={() => setPending(null)}
        secondaryLabel="Just the repo"
        onSecondary={() => {
          if (dontAsk) setDecision('linkOnAttach', 'never')
          finalize(pending.ctx, pending.id)
        }}
        primaryLabel="Add both"
        onPrimary={() => {
          if (dontAsk) setDecision('linkOnAttach', 'always')
          onAdd({ kind: 'connector', connector: GITHUB_CONNECTOR })
          finalize(pending.ctx, pending.id)
        }}
      />
    )
  }

  const repoRow = (o: RepoOption) => (
    <OptionRow
      key={o.id}
      icon={o.origin === 'local' ? <FolderGit2 size={16} /> : <Github size={16} />}
      label={o.origin === 'local' ? o.path : o.remote}
      meta={
        o.origin === 'local'
          ? `local · ${o.remote ?? 'local only'} · ${o.branch}`
          : `github · ${o.branch} · ${o.meta}`
      }
      added={isAdded(o)}
      onClick={() => select(o)}
    />
  )

  return (
    <>
      <div data-fs-picker-body className={FS_PICKER_BODY_CLASS}>
      {localGitAvailable() && <NativeLocalGitPicker onAdd={onAdd} addedIds={addedLocalGitIds} onClose={onClose} />}
      <ContextCatalogNotice query={catalog} />
      {browsing && (
        <BrowseDialog
          title="Open Repository"
          developmentFixtures={catalog.data?.developmentFixtures}
          location={['Repositories']}
          groups={[
            {
              label: 'Local',
              items: rest.filter(isLocalRepo).map((o) => ({
                id: o.id,
                name: basename(o.path),
                meta: `${o.remote ?? 'local only'} · ${o.branch}`,
                icon: <FolderGit2 size={15} />,
              })),
            },
            {
              label: 'GitHub',
              items: rest.filter(isGithubRepo).map((o) => ({
                id: o.id,
                name: o.remote,
                meta: `${o.branch} · ${o.meta}`,
                icon: <Github size={15} />,
              })),
            },
          ]}
          onCancel={() => setBrowsing(false)}
          onConfirm={(id) => {
            setBrowsing(false)
            const o = byId.get(id)
            if (o) select(o)
          }}
        />
      )}
      {options.length > 0 ? <Section label="Recent repositories">
        <RecentOverflowList
          maxRows={maxRows}
          moreLabel="More recent repositories"
          rows={recent.map((o) => ({ key: o.id, node: repoRow(o) }))}
        />
        <BrowseRow label="Browse repositories…" onClick={() => setBrowsing(true)} />
      </Section> : catalog.data && !localGitAvailable() ? <p className="px-1 py-3 text-[12px] text-ink-soft">Local repository connections require the macOS desktop app. Add files or a folder instead.</p> : null}
      </div>
      <MultiAddFooter count={addedRepoIds.length + addedLocalGitIds.length} onDone={onClose} />
    </>
  )
}
