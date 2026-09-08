import { useEffect, useRef, useState, type ReactNode } from 'react'
import { accountGeneration, onAccountSwitch } from '../api/account.ts'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Cloud,
  FileText,
  FolderGit2,
  FolderOpen,
  FolderSearch,
  GitBranch,
  Github,
  Image as ImageIcon,
  Laptop,
  Paperclip,
  Plug,
  Plus,
  Server,
} from 'lucide-react'
import type {
  AddedContext,
  Attachment,
  Connector,
  FsFileEntry,
  FsFolderContents,
  FsFolderEntry,
  FsPhotoEntry,
  FsSource,
  Repo,
  Workspace,
} from '../types'
import { AddTrigger } from './AddTrigger'
import { SectionAction } from './SectionAction'
import { PhotoThumb } from './PhotoThumb'
import { GITHUB_CONNECTOR, GITHUB_CONNECTOR_ID } from '../lib/connectors'
import { repoIdForLabel } from '../data/liveSession'
import { getDecision, setDecision } from '../lib/prefs'
import { useFocusTrap } from '../lib/useFocusTrap'
import { useDismissable } from '../lib/useDismissable'
import { POPOVER_SURFACE } from '../lib/popover'
import { CheckSquare } from './Checkbox'
import { usePopoverShift } from '../lib/usePopoverShift'
import { useRecentIds } from '../lib/recents'
import { UI_HOST_SOURCE, DEFAULT_FS_SOURCE_ID, useFsSourceList } from '../lib/fsSources'
import type { UiHostFile } from '../lib/uiHostFs'
import { useUiHostFs, type UiHostFsLoadState, type UiHostFsModule } from '../lib/useUiHostFs'
import { prepareUiHostFiles } from '../controller/imageAttachments'
import { SCRIM_CLASS } from '../lib/scrim'
import { DIALOG_SURFACE_CLASS } from '../lib/dialog'
import { SOFT_BUTTON_CLASS } from '../lib/button'
import { useFsCatalog, useSavedContexts, fsContentUrl } from '../api/hooks'
import { apiGet } from '../api/client'
import { paths } from '../api/keys'
import { fsRecentKey, parseFsRecentKey } from '../../contract/index'
import { RecentOverflowList, type OverflowRow } from './RecentOverflowList'
import {
  CONNECTOR_OPTIONS,
  GITHUB_REPO_OPTIONS,
  LOCAL_REPO_OPTIONS,
  MCP_OPTIONS,
  type ContextTypeId,
} from '../data/contextOptions'

type TypeId = ContextTypeId

/** Approx height of one recent row, and the fixed chrome a picker keeps around
 *  the list (header + label + Browse row + footer + padding). Used to size the
 *  inline recent list to the available height; the remainder folds into "More". */
const RECENT_ROW_H = 38
const RECENT_CHROME_H = 156

const CONTEXT_TYPES: { id: TypeId; label: string; desc: string; Icon: typeof Paperclip }[] = [
  { id: 'files', label: 'Files', desc: 'Text, documents, spreadsheets, slides and images', Icon: Paperclip },
  { id: 'photos', label: 'Photos', desc: 'Add from your photo library', Icon: ImageIcon },
  { id: 'folder', label: 'Folder', desc: 'List a folder’s files in your workspace', Icon: FolderOpen },
  { id: 'repo', label: 'Repository', desc: 'Connect a git repo to read & edit code', Icon: GitBranch },
  { id: 'connector', label: 'Connector', desc: 'Google Drive, Slack, Notion, Linear…', Icon: Plug },
  { id: 'mcp', label: 'MCP server', desc: 'Add a Model Context Protocol server', Icon: Server },
]

/** One consistent entry point for attaching context — every attachable thing
 *  (files, folders, repos, connectors, MCP servers) is "context" the thread
 *  gains. Step 1 picks the type; step 2 shows that type's quick picks plus a
 *  "Browse…" explorer for everything else. Every picker is multi-add: a pick
 *  attaches without closing and the row flips to ✓ Added; a "Done" footer closes.
 *  Whether a row reads "Added" is derived from what's *actually attached* to the
 *  thread (the live context props below), so it persists across reopens. */
export function AddContextButton({
  onAttach,
  connectors,
  repos,
  attachments,
  workspaces,
  variant = 'icon',
  label = 'Add context',
}: {
  onAttach: (ctx: AddedContext) => void
  /** The thread's currently-attached context — drives which rows show "Added"
   *  and the repo→GitHub-connector prompt. */
  connectors: Connector[]
  repos: Repo[]
  attachments: Attachment[]
  workspaces: Workspace[]
  /** The trigger's shape. 'icon' (default) is the composer's 32×32 plus button;
   *  'inline' is the shared "+ Add context" text trigger (AddTrigger), so on a
   *  surface that sits beside an "Add routine"-style control the two match;
   *  'section' is the compact section-header verb (SectionAction), for a
   *  panel-header action cluster — its popover drops BELOW the trigger. */
  variant?: 'icon' | 'inline' | 'section'
  /** The inline trigger's label (icon variant is icon-only). */
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<TypeId | null>(null)
  // How many recent rows fit inline — measured from the space above the composer
  // so the list is "as long as the layout allows"; the rest folds into the
  // "More" flyout. Recomputed on open and on window resize.
  const [maxRecentRows, setMaxRecentRows] = useState(8)
  const wrapRef = useDismissable<HTMLDivElement>(open, () => close())
  // The popover opens left-aligned from the button, but the button can sit near a
  // right edge (e.g. the project side panel), where a 340px popover would overflow.
  // The shared containment hook nudges it back fully on-screen; the host need
  // not know its own position — the popover self-corrects in any layout.
  const popRef = usePopoverShift<HTMLDivElement>(open)

  const close = () => {
    setOpen(false)
    setType(null)
  }

  // Size the inline recent list to the height available above the composer: the
  // popover opens upward from the button, so the button's top is how much room
  // there is. Subtract the picker's fixed chrome, divide by a row's height.
  useEffect(() => {
    if (!open) return
    const recompute = () => {
      const top = wrapRef.current?.getBoundingClientRect().top ?? window.innerHeight
      const rows = Math.floor((top - 16 - RECENT_CHROME_H) / RECENT_ROW_H)
      // Cap the inline list at a comfortable height even on tall screens; beyond
      // that the tail folds into "More" rather than becoming a giant wall of rows.
      setMaxRecentRows(Math.max(3, Math.min(9, rows)))
    }
    recompute()
    window.addEventListener('resize', recompute)
    return () => window.removeEventListener('resize', recompute)
  }, [open])

  const activeType = type ? CONTEXT_TYPES.find((t) => t.id === type)! : null

  const toggle = () => (open ? close() : setOpen(true))

  return (
    <div ref={wrapRef} className="relative">
      {variant === 'inline' ? (
        <AddTrigger
          label={label}
          open={open}
          onClick={toggle}
          title="Add context — files, folders, repos, connectors, MCP servers"
        />
      ) : variant === 'section' ? (
        <SectionAction label={label} icon={<Plus size={14} />} onClick={toggle} open={open} />
      ) : (
        <button
          onClick={toggle}
          className={`flex h-8 w-8 items-center justify-center rounded-lg transition ${
            open ? 'bg-panel-2 text-ink' : 'text-ink-soft hover:bg-panel-2 hover:text-ink'
          }`}
          title="Add context — files, folders, repos, connectors, MCP servers"
          aria-label="Add context"
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          <Plus size={18} />
        </button>
      )}

      {open && (
        <div
          ref={popRef}
          role="dialog"
          aria-label="Add context"
          className={`absolute z-20 w-[340px] overflow-hidden ${
            variant === 'section' ? 'right-0 top-full mt-1.5' : 'bottom-full left-0 mb-2'
          } ${POPOVER_SURFACE}`}
        >
          {activeType === null ? (
            <div className="p-2">
              <div className="px-1.5 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                Add context
              </div>
              {CONTEXT_TYPES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setType(t.id)}
                  className="flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left transition hover:bg-panel-2"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-panel-2 text-ink-soft">
                    <t.Icon size={15} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium text-ink">{t.label}</span>
                    <span className="block truncate text-[11px] text-ink-faint">{t.desc}</span>
                  </span>
                  <ChevronRight size={15} className="shrink-0 text-ink-faint" />
                </button>
              ))}
            </div>
          ) : (
            <div className="p-2">
              <div className="flex items-center gap-1 px-0.5 pb-1.5">
                <button
                  onClick={() => setType(null)}
                  className="flex h-6 w-6 items-center justify-center rounded-md text-ink-soft transition hover:bg-panel-2"
                  title="Back"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
                  <activeType.Icon size={14} />
                  {activeType.label}
                </span>
              </div>
              <div className="px-0.5">
                <WorkflowBody
                  type={activeType.id}
                  maxRows={maxRecentRows}
                  onAttach={onAttach}
                  onClose={close}
                  connectors={connectors}
                  repos={repos}
                  attachments={attachments}
                  workspaces={workspaces}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function WorkflowBody({
  type,
  maxRows,
  onAttach,
  onClose,
  connectors,
  repos,
  attachments,
  workspaces,
}: {
  type: TypeId
  /** How many recent rows to show inline before folding the rest into "More". */
  maxRows: number
  /** Attach without closing — every picker stacks adds (multi-add). */
  onAttach: (ctx: AddedContext) => void
  /** Close the whole popover (the multi-add "Done"). */
  onClose: () => void
  connectors: Connector[]
  repos: Repo[]
  attachments: Attachment[]
  workspaces: Workspace[]
}) {
  // Which option ids are already attached, per type — so an attached element
  // reads "Added" (no plus) instead of inviting a duplicate add. Mapped back to
  // each catalog's id space (mcp connectors carry an `mcp-` prefix; repos derive
  // their live id from the label; folders tag their workspace artifacts).
  const hasGitHubConnector = connectors.some((c) => c.id === GITHUB_CONNECTOR_ID)
  const addedConnectorIds = connectors.filter((c) => c.kind !== 'mcp').map((c) => c.id)
  const addedMcpIds = connectors.filter((c) => c.kind === 'mcp').map((c) => c.id.replace(/^mcp-/, ''))
  const addedFileIds = attachments.filter((a) => a.kind === 'file').map((a) => a.id)
  const addedPhotoIds = attachments.filter((a) => a.kind === 'photo').map((a) => a.id)
  const addedRepoIds = repos.map((r) => r.id)
  const addedFolderIds = workspaces.flatMap((w) => w.artifacts).flatMap((a) => (a.source ? [a.source.id] : []))

  if (type === 'folder') {
    return <FolderPicker maxRows={maxRows} onAdd={onAttach} onClose={onClose} addedIds={addedFolderIds} />
  }
  if (type === 'repo') {
    return (
      <RepoPicker
        maxRows={maxRows}
        onAdd={onAttach}
        onClose={onClose}
        addedRepoIds={addedRepoIds}
        hasGitHubConnector={hasGitHubConnector}
      />
    )
  }
  if (type === 'connector') {
    return (
      <ListPicker
        type="connector"
        maxRows={maxRows}
        options={CONNECTOR_OPTIONS}
        connectedLabel="Connected"
        browseLabel="Connect a new account…"
        browseTitle="Connect an account"
        location={['Connectors']}
        rowIcon={<Plug size={16} />}
        browseIcon={<Plug size={15} />}
        rowMeta={(_c, connected) => (connected ? 'Ready to use' : 'Set up to connect')}
        toContext={(c) => ({
          kind: 'connector',
          connector: { id: c.id, label: c.label, kind: c.kind ?? 'connector' },
        })}
        addedIds={addedConnectorIds}
        onAdd={onAttach}
        onClose={onClose}
      />
    )
  }
  if (type === 'mcp') {
    return (
      <ListPicker
        type="mcp"
        maxRows={maxRows}
        options={MCP_OPTIONS}
        connectedLabel="Connected"
        browseLabel="Add an MCP server…"
        browseTitle="MCP Registry"
        location={['MCP Registry']}
        rowIcon={<Server size={16} />}
        browseIcon={<Server size={15} />}
        rowMeta={(m) => m.meta}
        toContext={(m) => ({
          kind: 'mcp',
          connector: { id: `mcp-${m.id}`, label: `MCP · ${m.label}`, kind: 'mcp' },
        })}
        addedIds={addedMcpIds}
        onAdd={onAttach}
        onClose={onClose}
      />
    )
  }
  if (type === 'files') {
    return <FilesPicker maxRows={maxRows} onAdd={onAttach} onClose={onClose} addedIds={addedFileIds} />
  }
  return <PhotosPicker onAdd={onAttach} onClose={onClose} addedIds={addedPhotoIds} />
}

/* ------------------------------------------------------------------ Browse --
   A simulated file-system explorer window (macOS Finder flavour) for picking
   something that isn't in the recents list. Selecting an item hands its id back
   to the picker, which runs the normal attach path (so the repo / folder
   dependency prompts still fire) and promotes it into recents. */

interface BrowseItem {
  id: string
  name: string
  meta?: string
  icon?: ReactNode
  /** Tailwind gradient class for grid (photo) thumbnails. */
  thumb?: string
}

interface BrowseGroup {
  label?: string
  items: BrowseItem[]
}

function BrowseDialog({
  title,
  location,
  groups,
  layout = 'list',
  onCancel,
  onConfirm,
}: {
  title: string
  location: string[]
  groups: BrowseGroup[]
  layout?: 'list' | 'grid'
  onCancel: () => void
  onConfirm: (id: string) => void
}) {
  const [picked, setPicked] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const items = groups.flatMap((g) => g.items)
  const pickedItem = items.find((i) => i.id === picked) ?? null

  // Trap Tab within the browse window and restore focus on close. Escape is
  // handled below in capture phase (closeOnEscape: false) so it closes this
  // modal before the popover's own Escape handler tears the whole popover down.
  useFocusTrap(dialogRef, onCancel, { closeOnEscape: false })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCancel()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onCancel])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onMouseDown={onCancel}
      role="dialog"
      aria-modal="true"
      aria-label={`${title} — browse`}
    >
      <div className={`${SCRIM_CLASS} backdrop-blur-[1px]`} />
      <div
        ref={dialogRef}
        onMouseDown={(e) => e.stopPropagation()}
        className={`relative flex max-h-[72dvh] w-[560px] max-w-[calc(100vw-16px)] flex-col ${DIALOG_SURFACE_CLASS} short:max-h-[85dvh]`}
      >
        {/* Title bar — Finder-style traffic lights + centered title. */}
        <div className="relative flex h-9 shrink-0 items-center border-b border-line bg-panel-2 px-3">
          <div className="flex items-center gap-1.5">
            <button
              onClick={onCancel}
              title="Close"
              aria-label="Close"
              className="h-3 w-3 rounded-full bg-[#ff5f57] ring-1 ring-black/10 transition hover:brightness-90"
            />
            <span className="h-3 w-3 rounded-full bg-[#febc2e] ring-1 ring-black/10" />
            <span className="h-3 w-3 rounded-full bg-[#28c840] ring-1 ring-black/10" />
          </div>
          <span className="absolute left-1/2 -translate-x-1/2 text-[12px] font-semibold text-ink-soft">
            {title}
          </span>
        </div>

        {/* Location / breadcrumb bar. */}
        <div className="flex shrink-0 items-center gap-1 border-b border-line px-3 py-1.5 text-[11px] text-ink-faint">
          <FolderOpen size={13} className="text-ink-faint" />
          {location.map((seg, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <ChevronRight size={11} className="text-line-strong" />}
              <span className={i === location.length - 1 ? 'font-medium text-ink-soft' : ''}>{seg}</span>
            </span>
          ))}
        </div>

        {/* Body. */}
        <div className="min-h-[140px] flex-1 overflow-y-auto p-2">
          {items.length === 0 ? (
            <div className="flex h-full min-h-[140px] items-center justify-center px-6 text-center text-[12px] text-ink-faint">
              Everything here is already in your recents.
            </div>
          ) : layout === 'grid' ? (
            <div className="grid grid-cols-4 gap-2 p-1">
              {items.map((it) => (
                <button
                  key={it.id}
                  title={it.name}
                  onClick={() => setPicked(it.id)}
                  onDoubleClick={() => onConfirm(it.id)}
                  className={`aspect-square rounded-lg ring-2 transition ${it.thumb ?? 'bg-panel-2'} ${
                    it.id === picked ? 'ring-accent' : 'ring-transparent hover:ring-line-strong'
                  }`}
                />
              ))}
            </div>
          ) : (
            groups.map((g, gi) => (
              <div key={gi} className="pb-1">
                {g.label && (
                  <p className="px-1 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                    {g.label}
                  </p>
                )}
                {g.items.map((it) => (
                  <button
                    key={it.id}
                    onClick={() => setPicked(it.id)}
                    onDoubleClick={() => onConfirm(it.id)}
                    className={`mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition ${
                      it.id === picked ? 'bg-accent-tint ring-1 ring-accent/40' : 'hover:bg-panel-2'
                    }`}
                  >
                    <span className="shrink-0 text-ink-soft">{it.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-ink">{it.name}</span>
                      {it.meta && <span className="block truncate text-[11px] text-ink-faint">{it.meta}</span>}
                    </span>
                  </button>
                ))}
              </div>
            ))
          )}
        </div>

        {/* Footer — selected name + Cancel / Open. */}
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-line bg-panel px-3 py-2">
          <span className="min-w-0 truncate text-[11px] text-ink-faint">
            {pickedItem ? pickedItem.name : 'Select an item to open'}
          </span>
          <div className="flex shrink-0 gap-1.5">
            <button
              onClick={onCancel}
              className="rounded-md px-2.5 py-1 text-[12px] font-medium text-ink-soft transition hover:bg-panel-2"
            >
              Cancel
            </button>
            <button
              onClick={() => picked && onConfirm(picked)}
              disabled={!picked}
              className={`${SOFT_BUTTON_CLASS} px-2.5 py-1 text-[12px] disabled:cursor-not-allowed disabled:opacity-40`}
            >
              Open
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** The dashed "Browse…" row that ends every recents list and opens the explorer. */
function BrowseRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="mt-0.5 flex w-full items-center gap-2.5 rounded-lg border border-dashed border-line-strong px-2 py-1.5 text-left text-ink-soft transition hover:bg-panel-2 hover:text-ink"
    >
      <FolderSearch size={16} className="shrink-0" />
      <span className="min-w-0 flex-1 text-[13px] font-medium">{label}</span>
      <ChevronRight size={15} className="shrink-0 text-ink-faint" />
    </button>
  )
}

/* ------------------------------------------------------------- simple lists --
   Connectors and MCP servers: the auth/setup-heavy context. Their already
   set-up entries (from the Contexts page) show as a "Connected" quick list that
   attaches instantly — no re-authenticating. This is a multi-add surface: each
   row attaches without closing (marked ✓) so several can be added in one pass,
   and a "Done" footer closes. Browse sets up / authenticates a *new* one, which
   the attach funnel promotes into the Connected list (the shared recents store,
   lib/recents) so it's reusable next time. The list never evicts — a long one
   folds its tail into a "More" flyout (RecentOverflowList). */
function ListPicker<T extends { id: string; label: string }>({
  type,
  maxRows,
  options,
  connectedLabel,
  browseLabel,
  browseTitle,
  location,
  rowIcon,
  browseIcon,
  rowMeta,
  toContext,
  addedIds,
  onAdd,
  onClose,
}: {
  type: ContextTypeId
  maxRows: number
  options: readonly T[]
  connectedLabel: string
  browseLabel: string
  browseTitle: string
  location: string[]
  rowIcon: ReactNode
  browseIcon: ReactNode
  /** Row subtitle. `connected` says whether it's in the quick list (set up) or
   *  a Browse candidate (still to set up). */
  rowMeta: (o: T, connected: boolean) => string | undefined
  toContext: (o: T) => AddedContext
  /** Option ids already attached to the thread — shown as ✓ Added, not a plus. */
  addedIds: readonly string[]
  onAdd: (ctx: AddedContext) => void
  onClose: () => void
}) {
  const [browsing, setBrowsing] = useState(false)
  // The set-up ids read reactively from the one recents store (in recency order),
  // so a Browse promotion — or any other attach path — shows up here at once. The
  // rest are the Browse candidates. Nothing is evicted; a long list folds into the
  // "More" flyout (RecentOverflowList).
  const recentIds = useRecentIds(type)
  // Each row's auth state comes from the saved-contexts REGISTRY (the Contexts
  // page's system of record, refreshed live on `connector.status`) — never
  // asserted by this picker. The quick list once painted every row with a
  // fabricated green "Connected" dot, so a disconnect never showed here.
  const savedStatus = new Map(
    (useSavedContexts().data?.contexts ?? []).filter((c) => c.kind === type).map((c) => [c.id, c.status]),
  )
  const byId = new Map(options.map((o) => [o.id, o]))
  const connected = recentIds.map((id) => byId.get(id)).filter(Boolean) as T[]
  const rest = options.filter((o) => !recentIds.includes(o.id))

  // Attach without closing, so multiple can be stacked. The row flips to ✓ Added
  // off the live attached state (addedIds). Promotion into the quick list happens
  // at the attach funnel (lib/contextShortcuts.ts), so a freshly-browsed element
  // moves from Browse into the list with no extra bookkeeping here.
  const choose = (o: T) => {
    onAdd(toContext(o))
  }

  const rows: OverflowRow[] = connected.map((o) => {
    const status = savedStatus.get(o.id) ?? 'connected'
    return {
      key: o.id,
      node: (
        <OptionRow
          icon={rowIcon}
          label={o.label}
          meta={status === 'needs-auth' ? 'Needs auth — reconnect from Contexts' : rowMeta(o, true)}
          status={status}
          added={addedIds.includes(o.id)}
          onClick={() => choose(o)}
        />
      ),
    }
  })

  return (
    <>
      <Section label={connectedLabel}>
        <RecentOverflowList rows={rows} maxRows={maxRows} moreLabel={`More ${connectedLabel.toLowerCase()}`} />
        <BrowseRow label={browseLabel} onClick={() => setBrowsing(true)} />
      </Section>
      <MultiAddFooter count={addedIds.length} onDone={onClose} />
      {browsing && (
        <BrowseDialog
          title={browseTitle}
          location={location}
          groups={[
            { items: rest.map((o) => ({ id: o.id, name: o.label, meta: rowMeta(o, false), icon: browseIcon })) },
          ]}
          onCancel={() => setBrowsing(false)}
          onConfirm={(id) => {
            setBrowsing(false)
            const o = options.find((x) => x.id === id)
            if (o) choose(o)
          }}
        />
      )}
    </>
  )
}

/** Footer for the multi-add pickers: a running "N added" count and a Done button
 *  to close (click-outside / Esc also close). Signals that adds don't close the
 *  picker, so you can keep clicking. */
function MultiAddFooter({ count, onDone }: { count: number; onDone: () => void }) {
  return (
    <div className="mt-1 flex items-center justify-between gap-2 border-t border-line px-1 pt-2">
      <span className="min-w-0 truncate text-[11px] text-ink-faint">
        {count === 0 ? 'Add as many as you need' : `${count} added`}
      </span>
      <button
        type="button"
        onClick={onDone}
        className="shrink-0 rounded-md px-2 py-1 text-[12px] font-medium text-ink ring-1 ring-line-strong transition hover:bg-panel-2"
      >
        Done
      </button>
    </div>
  )
}

/* ----------------------------------------------- served filesystem sources --
   Files / Photos / Folder are served from a real filesystem (contract/fs.ts),
   from three sources the picker switches between: This computer (read client-side,
   lib/uiHostFs), Cloud storage (the web backend's own disk), and each connected
   runner's host (proxied through the broker). The switcher + the served-catalog
   panes below are shared by all three pickers. */

const SOURCE_ICON: Record<FsSource['kind'], typeof Cloud> = {
  'ui-host': Laptop,
  cloud: Cloud,
  runner: Server,
}

/** Human file size for a catalog row's meta. */
function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** The source switcher — This computer · Cloud storage · each runner. */
function SourceSwitcher({
  sources,
  active,
  onPick,
}: {
  sources: FsSource[]
  active: string
  onPick: (id: string) => void
}) {
  return (
    <div className="mb-2 flex items-center gap-0.5 overflow-x-auto rounded-lg bg-panel-2 p-0.5">
      {sources.map((s) => {
        const Icon = SOURCE_ICON[s.kind]
        const on = s.id === active
        return (
          <button
            key={s.id}
            onClick={() => onPick(s.id)}
            title={s.label}
            className={`flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition ${
              on ? 'bg-surface text-ink ring-1 ring-line-strong' : 'text-ink-soft hover:text-ink'
            }`}
          >
            <Icon size={13} />
            {s.label}
          </button>
        )
      })}
    </div>
  )
}

/** Pick/drop local snapshots, then persist image bytes before attaching refs.
 * The whole selection belongs to the account that opened the picker. */
function UiHostDropZone({
  accept,
  label,
  onPicked,
  hostFs,
}: {
  accept: 'image' | 'any'
  label: string
  onPicked: (f: UiHostFile) => void | Promise<void>
  hostFs: UiHostFsModule
}) {
  const [drag, setDrag] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const intake = useRef<AbortController | null>(null)
  useEffect(() => {
    const unsubscribe = onAccountSwitch(() => {
      intake.current?.abort()
      setImporting(false)
      setFailure(null)
    })
    return () => { unsubscribe(); intake.current?.abort() }
  }, [])
  const take = async (read: (signal: AbortSignal) => Promise<UiHostFile[]>) => {
    if (intake.current) return
    const controller = new AbortController()
    const issuedAccount = accountGeneration()
    intake.current = controller
    setImporting(true)
    setFailure(null)
    try {
      const files = await read(controller.signal)
      if (accountGeneration() !== issuedAccount) controller.abort()
      if (!controller.signal.aborted) {
        const prepared = await prepareUiHostFiles(files, controller.signal)
        if (!controller.signal.aborted) {
          // Queue the accepted selection before the first acknowledgement can
          // open a split pane and remount this picker. The session FIFO owns
          // commit/retry from here; closing the intake cannot cancel queued work.
          setImporting(false)
          const commits = prepared.map((file) => onPicked(file))
          await Promise.all(commits)
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) setFailure(error instanceof Error ? error.message : 'The selected items could not be read. Try again.')
    } finally {
      if (!controller.signal.aborted) setImporting(false)
      intake.current = null
    }
  }
  return (
    <div>
      <button
        type="button"
        onClick={() => void take((signal) => hostFs.pickUiHostFiles(accept, window, signal))}
        disabled={importing}
        aria-busy={importing}
        onDragOver={(e) => {
          e.preventDefault()
          setDrag(true)
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDrag(false)
          const files = e.dataTransfer.files
          void take((signal) => hostFs.readDroppedFiles(files, accept, signal))
        }}
        className={`flex w-full flex-col items-center justify-center rounded-lg border border-dashed px-3 py-6 text-center transition ${
          drag ? 'border-accent bg-accent-tint' : 'border-line-strong hover:bg-panel-2'
        }`}
      >
        {accept === 'image' ? (
          <ImageIcon size={18} className="mb-1 text-ink-faint" />
        ) : (
          <Paperclip size={18} className="mb-1 text-ink-faint" />
        )}
        <span className="text-[12px] font-medium text-ink">{label}</span>
        <span className="text-[11px] text-ink-faint">drag &amp; drop, or click to choose</span>
      </button>
      {importing && <p role="status" className="px-1 pt-1.5 text-[11px] leading-snug text-ink-soft">Importing selected files… Close this picker to cancel.</p>}
      {accept === 'any' && <p className="px-1 pt-1.5 text-[11px] leading-snug text-ink-faint">Documents (.pdf, .docx, .xlsx, .pptx): up to 8 MB each, 24 MB combined per selection. Only extracted text up to 64 KB per file is saved. PDFs: up to 100 pages; images, layout and OCR are not included. Excel: visible cell values only; formulas are not calculated. PowerPoint: slide text only; speaker notes and hidden slides are excluded.</p>}
      <p className="px-1 pt-1.5 text-[11px] leading-snug text-ink-faint">PNG, JPEG, GIF or WebP: up to 8 MB each, 24 MB per selection. Images are saved as a resized PNG of the first frame.</p>
      {failure && <p role="alert" className="px-1 pt-1.5 text-[11px] leading-snug text-danger-text">{failure}</p>}
    </div>
  )
}

function UiHostLoadNotice({ state, label }: { state: UiHostFsLoadState; label: string }) {
  if (state.status === 'ready') return null
  if (state.status === 'loading') {
    return <p role="status" aria-busy="true" className="px-1 py-6 text-center text-[11px] text-ink-soft">Loading {label}…</p>
  }
  if (state.status === 'error') {
    return (
      <div role="alert" data-local-picker-load="error" className="px-1 py-4 text-center text-[11px] text-danger-text">
        <p>Local {label} could not be loaded.</p>
        <p className="mt-1 text-ink-soft">Reload the app to try again. Copy any unsent text first.</p>
        <button type="button" onClick={() => window.location.reload()} className="mt-2 rounded-md px-2 py-1 text-[11px] font-medium text-ink ring-1 ring-line-strong hover:bg-panel-2">Reload app</button>
      </div>
    )
  }
  return null
}

/** Empty / loading state for a served catalog pane. */
function CatalogEmpty({ loading, label }: { loading: boolean; label: string }) {
  return (
    <div className="px-1 py-6 text-center text-[12px] text-ink-faint">
      {loading ? 'Loading…' : `Nothing here yet — no ${label}.`}
    </div>
  )
}

/** Entry ids in `recentKeys` that belong to `sourceId` (the source-qualified MRU). */
function recentEntryIds(recentKeys: readonly string[], sourceId: string): Set<string> {
  return new Set(
    recentKeys
      .map(parseFsRecentKey)
      .filter((k): k is { sourceId: string; entryId: string } => !!k && k.sourceId === sourceId)
      .map((k) => k.entryId),
  )
}

/** The served files of one source (cloud / runner), recents-ordered. */
function ServedFiles({
  source,
  maxRows,
  addedIds,
  onAttach,
}: {
  source: FsSource
  maxRows: number
  addedIds: readonly string[]
  onAttach: (e: FsFileEntry) => void
}) {
  const cat = useFsCatalog(source.id)
  const recentKeys = useRecentIds('files')
  const files = cat.data?.files ?? []
  const recent = recentEntryIds(recentKeys, source.id)
  const ordered = [...files.filter((f) => recent.has(f.id)), ...files.filter((f) => !recent.has(f.id))]
  if (!files.length) return <CatalogEmpty loading={cat.status === 'loading'} label="files" />
  return (
    <RecentOverflowList
      maxRows={maxRows}
      moreLabel="More files"
      rows={ordered.map((f) => ({
        key: f.id,
        node: (
          <OptionRow
            icon={<FileText size={16} />}
            label={f.name}
            meta={`${f.ext ? f.ext.toUpperCase() + ' · ' : ''}${fmtSize(f.size)}`}
            added={addedIds.includes(fsRecentKey(source.id, f.id))}
            onClick={() => onAttach(f)}
          />
        ),
      }))}
    />
  )
}

/** The served photos of one source as a scrollable grid (real `<img>`). */
function ServedPhotos({
  source,
  addedIds,
  onAttach,
}: {
  source: FsSource
  addedIds: readonly string[]
  onAttach: (e: FsPhotoEntry) => void
}) {
  const cat = useFsCatalog(source.id)
  const photos = cat.data?.photos ?? []
  if (!photos.length) return <CatalogEmpty loading={cat.status === 'loading'} label="photos" />
  return (
    <div className="grid max-h-[210px] grid-cols-3 gap-1.5 overflow-y-auto px-1 pb-1">
      {photos.map((p) => {
        const added = addedIds.includes(fsRecentKey(source.id, p.id))
        return (
          <PhotoThumb
            key={p.id}
            id={p.id}
            src={fsContentUrl(source.id, p.id)}
            title={p.name}
            onClick={added ? undefined : () => onAttach(p)}
            className={`aspect-square rounded-lg ring-1 transition ${
              added ? 'ring-2 ring-ok' : 'ring-black/5 hover:opacity-80'
            }`}
          >
            {added && (
              <span className="absolute inset-0 flex items-center justify-center bg-black/35">
                <Check size={18} className="text-on-solid" strokeWidth={3} />
              </span>
            )}
          </PhotoThumb>
        )
      })}
    </div>
  )
}

function FilesPicker({
  maxRows,
  onAdd,
  onClose,
  addedIds,
}: {
  maxRows: number
  onAdd: (ctx: AddedContext) => void
  onClose: () => void
  addedIds: readonly string[]
}) {
  const sources = useFsSourceList()
  const [sourceId, setSourceId] = useState(DEFAULT_FS_SOURCE_ID)
  const active = sources.find((s) => s.id === sourceId) ?? UI_HOST_SOURCE
  const hostFs = useUiHostFs(active.kind === 'ui-host')

  const attachUiHost = (f: UiHostFile) =>
    onAdd({
      kind: 'files',
      attachments: [
        { id: fsRecentKey('ui-host', f.id), label: f.name, kind: f.kind, source: UI_HOST_SOURCE, previewText: f.text, documentImport: f.documentImport, image: f.image },
      ],
    })
  const attachServed = (e: FsFileEntry) =>
    onAdd({ kind: 'files', attachments: [{ id: fsRecentKey(active.id, e.id), label: e.name, kind: 'file', source: active }] })

  return (
    <div className="pb-1">
      <SourceSwitcher sources={sources} active={sourceId} onPick={setSourceId} />
      {active.kind === 'ui-host' ? (
        hostFs.module ? (
          <UiHostDropZone accept="any" label="Add files from this computer" onPicked={attachUiHost} hostFs={hostFs.module} />
        ) : <UiHostLoadNotice state={hostFs} label="file access" />
      ) : (
        <ServedFiles source={active} maxRows={Math.max(2, maxRows - 1)} addedIds={addedIds} onAttach={attachServed} />
      )}
      <MultiAddFooter count={addedIds.length} onDone={onClose} />
    </div>
  )
}

function PhotosPicker({
  onAdd,
  onClose,
  addedIds,
}: {
  onAdd: (ctx: AddedContext) => void
  onClose: () => void
  addedIds: readonly string[]
}) {
  const sources = useFsSourceList()
  const [sourceId, setSourceId] = useState(DEFAULT_FS_SOURCE_ID)
  const active = sources.find((s) => s.id === sourceId) ?? UI_HOST_SOURCE
  const hostFs = useUiHostFs(active.kind === 'ui-host')

  const attachUiHost = (f: UiHostFile) =>
    onAdd({
      kind: 'photos',
      attachments: [{ id: fsRecentKey('ui-host', f.id), label: f.name, kind: 'photo', source: UI_HOST_SOURCE, previewText: f.text, image: f.image }],
    })
  const attachServed = (e: FsPhotoEntry) =>
    onAdd({ kind: 'photos', attachments: [{ id: fsRecentKey(active.id, e.id), label: e.name, kind: 'photo', source: active }] })

  return (
    <div className="pb-1">
      <SourceSwitcher sources={sources} active={sourceId} onPick={setSourceId} />
      {active.kind === 'ui-host' ? (
        hostFs.module ? (
          <UiHostDropZone accept="image" label="Add photos from this computer" onPicked={attachUiHost} hostFs={hostFs.module} />
        ) : <UiHostLoadNotice state={hostFs} label="photo access" />
      ) : (
        <ServedPhotos source={active} addedIds={addedIds} onAttach={attachServed} />
      )}
      <MultiAddFooter count={addedIds.length} onDone={onClose} />
    </div>
  )
}

type RepoContext = Extract<AddedContext, { kind: 'repo' }>

type RepoOption =
  | ((typeof LOCAL_REPO_OPTIONS)[number] & { origin: 'local' })
  | ((typeof GITHUB_REPO_OPTIONS)[number] & { origin: 'github' })

/** Local + GitHub repos merged into one catalog so recents can mix origins. */
const REPO_CATALOG: RepoOption[] = [
  ...LOCAL_REPO_OPTIONS.map((r) => ({ ...r, origin: 'local' as const })),
  ...GITHUB_REPO_OPTIONS.map((r) => ({ ...r, origin: 'github' as const })),
]

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
function RepoPicker({
  maxRows,
  onAdd,
  onClose,
  addedRepoIds,
  hasGitHubConnector,
}: {
  maxRows: number
  onAdd: (ctx: AddedContext) => void
  onClose: () => void
  /** Live-repo ids already attached — rows for these read ✓ Added. */
  addedRepoIds: readonly string[]
  hasGitHubConnector: boolean
}) {
  const [pending, setPending] = useState<{ ctx: RepoContext; id: string } | null>(null)
  const [dontAsk, setDontAsk] = useState(false)
  const [browsing, setBrowsing] = useState(false)

  const labelOf = (o: RepoOption) => (o.origin === 'local' ? basename(o.path) : o.remote)
  const isAdded = (o: RepoOption) => addedRepoIds.includes(repoIdForLabel(labelOf(o)))

  const recentIds = useRecentIds('repo')
  const byId = new Map(REPO_CATALOG.map((o) => [o.id, o]))
  const recent = recentIds.map((id) => byId.get(id)).filter(Boolean) as RepoOption[]
  // Browse lists what's neither recent nor already attached — so re-selecting an
  // attached repo can't re-fire its attach (and re-attach the GitHub connector).
  const rest = REPO_CATALOG.filter((o) => !recentIds.includes(o.id) && !isAdded(o))

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
            <span className="font-medium">{pending.ctx.label}</span> has a GitHub remote. Add the{' '}
            <span className="font-medium">GitHub connector</span> too, so Claude can push and open PRs?
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
      <Section label="Recent repositories">
        <RecentOverflowList
          maxRows={maxRows}
          moreLabel="More recent repositories"
          rows={recent.map((o) => ({ key: o.id, node: repoRow(o) }))}
        />
        <BrowseRow label="Browse repositories…" onClick={() => setBrowsing(true)} />
      </Section>
      <MultiAddFooter count={addedRepoIds.length} onDone={onClose} />
      {browsing && (
        <BrowseDialog
          title="Open Repository"
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
    </>
  )
}

/** The served folders of one source, recents-ordered. Clicking one fetches its
 *  contents and attaches it as a workspace (its artifacts tagged with the folder
 *  as their source, carrying the fs source so the workspace can show real content). */
function ServedFolders({
  source,
  maxRows,
  addedIds,
  onAttach,
}: {
  source: FsSource
  maxRows: number
  addedIds: readonly string[]
  onAttach: (f: FsFolderEntry) => void
}) {
  const cat = useFsCatalog(source.id)
  const recentKeys = useRecentIds('folder')
  const folders = cat.data?.folders ?? []
  const recent = recentEntryIds(recentKeys, source.id)
  const ordered = [...folders.filter((f) => recent.has(f.path)), ...folders.filter((f) => !recent.has(f.path))]
  if (!folders.length) return <CatalogEmpty loading={cat.status === 'loading'} label="folders" />
  return (
    <RecentOverflowList
      maxRows={maxRows}
      moreLabel="More folders"
      rows={ordered.map((f) => ({
        key: f.id,
        node: (
          <OptionRow
            icon={<FolderOpen size={16} />}
            label={f.name}
            meta={`${f.fileCount} file${f.fileCount === 1 ? '' : 's'}`}
            added={addedIds.includes(fsRecentKey(source.id, f.path))}
            onClick={() => onAttach(f)}
          />
        ),
      }))}
    />
  )
}

/** Folder picker — source-aware. A served folder (cloud / runner) attaches as a
 *  workspace of its real scanned artifacts; the UI-host source opens the OS folder
 *  picker. (The old git-repo prompt is gone: served folders are plain workspaces;
 *  attach a git repo through the Repository type instead.) */
function FolderPicker({
  maxRows,
  onAdd,
  onClose,
  addedIds,
}: {
  maxRows: number
  onAdd: (ctx: AddedContext) => void
  onClose: () => void
  /** Folder source-keys already in the shared workspace — rows for these read ✓ Added. */
  addedIds: readonly string[]
}) {
  const sources = useFsSourceList()
  const [sourceId, setSourceId] = useState(DEFAULT_FS_SOURCE_ID)
  const [failure, setFailure] = useState<string | null>(null)
  const active = sources.find((s) => s.id === sourceId) ?? UI_HOST_SOURCE
  const hostFs = useUiHostFs(active.kind === 'ui-host')
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  // Attach a served folder: fetch its contents, tag each artifact with the folder
  // (a source-qualified key so the workspace can fetch real content + de-dupe).
  const attachServed = async (f: FsFolderEntry) => {
    const src = { id: fsRecentKey(active.id, f.path), label: `${f.name}/` }
    const contents = await apiGet<FsFolderContents>(paths.fsFolder(active.id, f.path)).catch(() => undefined)
    const artifacts = (contents?.artifacts ?? []).map((a) => ({ ...a, source: src }))
    onAdd({ kind: 'folder', label: f.name, artifacts, source: active })
  }

  const attachUiHost = async () => {
    if (!hostFs.module || !mounted.current) return
    setFailure(null)
    const issuedAccount = accountGeneration()
    try {
      const picked = await hostFs.module.pickUiHostFolder()
      if (!mounted.current || accountGeneration() !== issuedAccount) return
      if (!picked) return
      if (!picked.artifacts.length) {
        setFailure('No visible top-level files were found. Choose a folder containing files; hidden files and subfolders are excluded.')
        return
      }
      const src = { id: fsRecentKey('ui-host', picked.id), label: `${picked.name}/` }
      onAdd({
        kind: 'folder',
        label: picked.name,
        artifacts: picked.artifacts.map((a) => ({ ...a, source: src })),
        source: UI_HOST_SOURCE,
      })
    } catch (error) {
      if (mounted.current && accountGeneration() === issuedAccount) {
        setFailure(error instanceof Error ? error.message : 'The selected folder could not be read. Try again.')
      }
    }
  }

  return (
    <div className="pb-1">
      <SourceSwitcher sources={sources} active={sourceId} onPick={setSourceId} />
      {active.kind === 'ui-host' ? (
        hostFs.module ? (
          <div>
            <button
              type="button"
              onClick={() => void attachUiHost()}
              className="flex w-full flex-col items-center justify-center rounded-lg border border-dashed border-line-strong px-3 py-6 text-center transition hover:bg-panel-2"
            >
              <FolderOpen size={18} className="mb-1 text-ink-faint" />
              <span className="text-[12px] font-medium text-ink">Choose a folder from this computer</span>
              <span className="text-[11px] text-ink-faint">Import top-level text snapshots for the selected model. Hidden files and subfolders are excluded.</span>
            </button>
            <p className="px-1 pt-1.5 text-[11px] leading-snug text-ink-faint">Up to 24 readable files, 64 KB each and 128 KB total. Original files are never changed or kept in sync. Reattach to import later edits.</p>
            {failure && <p role="alert" className="px-1 pt-1.5 text-[11px] leading-snug text-danger">{failure}</p>}
          </div>
        ) : <UiHostLoadNotice state={hostFs} label="folder access" />
      ) : (
        <ServedFolders source={active} maxRows={Math.max(2, maxRows - 1)} addedIds={addedIds} onAttach={(f) => void attachServed(f)} />
      )}
      <MultiAddFooter count={addedIds.length} onDone={onClose} />
    </div>
  )
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="pb-1">
      <p className="px-1 pb-1.5 text-[11px] text-ink-faint">{label}</p>
      {children}
    </div>
  )
}

function OptionRow({
  icon,
  label,
  meta,
  status,
  added,
  onClick,
}: {
  icon: ReactNode
  label: string
  meta?: string
  /** The row's LIVE auth state dot (the quick list): green = connected, amber =
   *  needs auth. Read from the saved-contexts registry, never asserted — a
   *  disconnect on the Contexts page must show here too (registries have one
   *  home and live points-of-use). */
  status?: 'connected' | 'needs-auth'
  /** Already attached to the thread — shows ✓ Added (not a plus) and isn't
   *  clickable, so it can't be added twice. Persists across reopens. */
  added?: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={added ? undefined : onClick}
      aria-disabled={added}
      className={`group mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition ${
        added ? 'cursor-default' : 'hover:bg-panel-2'
      }`}
    >
      {status && (
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${status === 'connected' ? 'bg-ok' : 'bg-warn'}`}
          title={status === 'connected' ? 'Connected' : 'Needs auth'}
        />
      )}
      <span className="shrink-0 text-ink-soft">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-ink">{label}</span>
        {meta && <span className="block truncate text-[11px] text-ink-faint">{meta}</span>}
      </span>
      {added ? (
        <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-ok-strong">
          <Check size={13} strokeWidth={2.5} /> Added
        </span>
      ) : (
        <span
          title="Add"
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-ink-faint transition group-hover:bg-accent-solid group-hover:text-on-solid"
        >
          <Plus size={14} />
        </span>
      )}
    </button>
  )
}
