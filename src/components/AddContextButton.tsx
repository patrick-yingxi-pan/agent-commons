import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  FolderGit2,
  FolderOpen,
  FolderSearch,
  GitBranch,
  Github,
  Image as ImageIcon,
  MoreHorizontal,
  Paperclip,
  Plug,
  Plus,
  Server,
} from 'lucide-react'
import type { AddedContext, Attachment, Connector, Repo, Workspace } from '../types'
import { AddTrigger } from './AddTrigger'
import { gradientFor } from '../lib/thumbs'
import { GITHUB_CONNECTOR, GITHUB_CONNECTOR_ID } from '../lib/connectors'
import { repoIdForLabel } from '../data/liveSession'
import { getDecision, setDecision } from '../lib/prefs'
import { useFocusTrap } from '../lib/useFocusTrap'
import { useDismissable } from '../lib/useDismissable'
import { useRecentIds } from '../lib/recents'
import { RecentOverflowList, FlyoutPanel, useFlyout, type OverflowRow } from './RecentOverflowList'
import {
  CONNECTOR_OPTIONS,
  FILE_OPTIONS,
  FOLDER_OPTIONS,
  GITHUB_REPO_OPTIONS,
  LOCAL_REPO_OPTIONS,
  MCP_OPTIONS,
  PHOTO_OPTIONS,
  type ContextTypeId,
} from '../data/contextOptions'

type TypeId = ContextTypeId

/** Approx height of one recent row, and the fixed chrome a picker keeps around
 *  the list (header + label + Browse row + footer + padding). Used to size the
 *  inline recent list to the available height; the remainder folds into "More". */
const RECENT_ROW_H = 38
const RECENT_CHROME_H = 156

const CONTEXT_TYPES: { id: TypeId; label: string; desc: string; Icon: typeof Paperclip }[] = [
  { id: 'files', label: 'Files', desc: 'Images, PDFs, docs from your computer', Icon: Paperclip },
  { id: 'photos', label: 'Photos', desc: 'Add from your photo library', Icon: ImageIcon },
  { id: 'folder', label: 'Folder', desc: 'Attach a local directory as a workspace', Icon: FolderOpen },
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
   *  surface that sits beside an "Add routine"-style control the two match. */
  variant?: 'icon' | 'inline'
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
  // `shiftX` nudges it back fully on-screen — measured once on open. The host need
  // not know its own position; the popover self-corrects in any layout.
  const popRef = useRef<HTMLDivElement>(null)
  const [shiftX, setShiftX] = useState(0)

  const close = () => {
    setOpen(false)
    setType(null)
    setShiftX(0)
  }

  useLayoutEffect(() => {
    if (!open) return
    const el = popRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const M = 8
    // r reflects the current shiftX (0 on first pass); correct the right overflow,
    // then guard the left edge so a very narrow viewport can't push it off-left.
    let dx = 0
    if (r.right > window.innerWidth - M) dx = window.innerWidth - M - r.right
    if (r.left + dx < M) dx = M - r.left
    if (dx !== 0) setShiftX((s) => s + dx)
  }, [open])

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
          style={{ transform: `translateX(${shiftX}px)` }}
          className="absolute bottom-full left-0 z-20 mb-2 w-[340px] overflow-hidden rounded-xl border border-line-strong bg-surface shadow-xl"
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
    return (
      <FolderPicker
        maxRows={maxRows}
        onAdd={onAttach}
        onClose={onClose}
        addedIds={addedFolderIds}
        hasGitHubConnector={hasGitHubConnector}
      />
    )
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
  return <PhotosPicker maxRows={maxRows} onAdd={onAttach} onClose={onClose} addedIds={addedPhotoIds} />
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
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[1px]" />
      <div
        ref={dialogRef}
        onMouseDown={(e) => e.stopPropagation()}
        className="relative flex max-h-[72vh] w-[560px] max-w-[92vw] flex-col overflow-hidden rounded-xl bg-surface shadow-2xl ring-1 ring-line-strong"
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
              className="rounded-md bg-accent px-2.5 py-1 text-[12px] font-medium text-white transition enabled:hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-40"
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

  const rows: OverflowRow[] = connected.map((o) => ({
    key: o.id,
    node: (
      <OptionRow
        icon={rowIcon}
        label={o.label}
        meta={rowMeta(o, true)}
        accentDot
        added={addedIds.includes(o.id)}
        onClick={() => choose(o)}
      />
    ),
  }))

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
  const [browsing, setBrowsing] = useState(false)
  const recentIds = useRecentIds('files')
  const byId = new Map(FILE_OPTIONS.map((f) => [f.id, f]))
  const recent = recentIds.map((id) => byId.get(id)).filter(Boolean) as (typeof FILE_OPTIONS)[number][]
  // Browse lists what's neither recent nor already attached — so an attached
  // file that's been evicted from recents can't reappear here to be added twice.
  const rest = FILE_OPTIONS.filter((f) => !recentIds.includes(f.id) && !addedIds.includes(f.id))

  // Attach without closing so several files can be added in one pass. The row
  // flips to ✓ Added off the live attached state (addedIds); the attach funnel
  // promotes the pick into Recent, which this list reads reactively.
  const choose = (f: (typeof FILE_OPTIONS)[number]) => {
    onAdd({ kind: 'files', attachments: [{ id: f.id, label: f.label, kind: 'file' }] })
  }

  return (
    <div className="pb-1">
      <button
        onClick={() => setBrowsing(true)}
        className="mb-2 flex w-full flex-col items-center justify-center rounded-lg border border-dashed border-line-strong px-3 py-4 text-center transition hover:bg-panel-2"
      >
        <Paperclip size={18} className="mb-1 text-ink-faint" />
        <span className="text-[12px] font-medium text-ink">Drop files here</span>
        <span className="text-[11px] text-ink-faint">or browse your files</span>
      </button>
      <p className="px-1 pb-1.5 text-[11px] text-ink-faint">Recent files</p>
      <RecentOverflowList
        maxRows={Math.max(2, maxRows - 2)}
        moreLabel="More recent files"
        rows={recent.map((f) => ({
          key: f.id,
          node: (
            <OptionRow
              icon={<FileText size={16} />}
              label={f.label}
              meta={f.meta}
              added={addedIds.includes(f.id)}
              onClick={() => choose(f)}
            />
          ),
        }))}
      />
      <BrowseRow label="Browse files…" onClick={() => setBrowsing(true)} />
      <MultiAddFooter count={addedIds.length} onDone={onClose} />
      {browsing && (
        <BrowseDialog
          title="Open"
          location={['~', 'Recent Files']}
          groups={[
            { items: rest.map((f) => ({ id: f.id, name: f.label, meta: f.meta, icon: <FileText size={15} /> })) },
          ]}
          onCancel={() => setBrowsing(false)}
          onConfirm={(id) => {
            setBrowsing(false)
            const f = byId.get(id)
            if (f) choose(f)
          }}
        />
      )}
    </div>
  )
}

function PhotosPicker({
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
  const [browsing, setBrowsing] = useState(false)
  const recentIds = useRecentIds('photos')
  const byId = new Map(PHOTO_OPTIONS.map((p) => [p.id, p]))
  const recent = recentIds.map((id) => byId.get(id)).filter(Boolean) as (typeof PHOTO_OPTIONS)[number][]
  // Browse lists what's neither recent nor already attached — so an attached
  // photo can't reappear here to be added twice.
  const rest = PHOTO_OPTIONS.filter((p) => !recentIds.includes(p.id) && !addedIds.includes(p.id))
  const more = useFlyout()
  const moreRef = useRef<HTMLButtonElement>(null)

  // Attach without closing so several photos can be added in one pass. The
  // thumbnail flips to a ✓ overlay off the live attached state (addedIds); the
  // attach funnel promotes the pick into Recent, which this list reads reactively.
  const choose = (p: (typeof PHOTO_OPTIONS)[number]) => {
    onAdd({ kind: 'photos', attachments: [{ id: p.id, label: p.label, kind: 'photo' }] })
  }

  // One thumbnail, reused inline and in the "More" flyout grid so both render
  // identically.
  const thumb = (p: (typeof PHOTO_OPTIONS)[number]) => {
    const isAdded = addedIds.includes(p.id)
    return (
      <button
        key={p.id}
        title={p.label}
        aria-disabled={isAdded}
        onClick={isAdded ? undefined : () => choose(p)}
        className={`relative aspect-square rounded-lg transition ${gradientFor(p.id)} ${
          isAdded ? 'ring-2 ring-emerald-500' : 'ring-1 ring-black/5 hover:opacity-80'
        }`}
      >
        {isAdded && (
          <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/35">
            <Check size={18} className="text-white" strokeWidth={3} />
          </span>
        )}
      </button>
    )
  }

  // Same non-evicting overflow as the list pickers, in grid terms: show as many
  // thumbnails as the height allows (≈4 per row), fold the rest into a "More"
  // cell whose hover opens a scrollable flyout grid.
  const cap = Math.max(7, maxRows * 2)
  const overflow = recent.length > cap
  const head = overflow ? recent.slice(0, cap - 1) : recent
  const tail = overflow ? recent.slice(cap - 1) : []

  return (
    <Section label="Recent photos">
      <div className="grid grid-cols-4 gap-1.5 px-1 pb-1">
        {head.map(thumb)}
        {overflow && (
          <button
            ref={moreRef}
            title={`${tail.length} more`}
            onMouseEnter={more.openNow}
            onMouseLeave={more.closeSoon}
            className="flex aspect-square flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed border-line-strong text-ink-faint transition hover:bg-panel-2 hover:text-ink"
          >
            <MoreHorizontal size={16} />
            <span className="text-[10px] font-medium">{tail.length} more</span>
          </button>
        )}
        <button
          title="Browse photos…"
          onClick={() => setBrowsing(true)}
          className="flex aspect-square items-center justify-center rounded-lg border border-dashed border-line-strong text-ink-faint transition hover:bg-panel-2 hover:text-ink"
        >
          <FolderSearch size={16} />
        </button>
      </div>
      {more.open && (
        <FlyoutPanel anchor={moreRef.current} width={208} onEnter={more.openNow} onLeave={more.closeSoon}>
          <div className="grid grid-cols-4 gap-1.5 p-1">{tail.map(thumb)}</div>
        </FlyoutPanel>
      )}
      <MultiAddFooter count={addedIds.length} onDone={onClose} />
      {browsing && (
        <BrowseDialog
          title="Photo Library"
          location={['Photo Library']}
          layout="grid"
          groups={[{ items: rest.map((p) => ({ id: p.id, name: p.label, thumb: gradientFor(p.id) })) }]}
          onCancel={() => setBrowsing(false)}
          onConfirm={(id) => {
            setBrowsing(false)
            const p = byId.get(id)
            if (p) choose(p)
          }}
        />
      )}
    </Section>
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
        <span
          className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
            dontAsk ? 'border-accent bg-accent text-white' : 'border-line-strong'
          }`}
        >
          {dontAsk && <Check size={10} strokeWidth={3} />}
        </span>
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
          className="rounded-md bg-accent px-2 py-1 text-[12px] font-medium text-white transition hover:bg-accent-strong"
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

type FolderOption = (typeof FOLDER_OPTIONS)[number]

/** Folder picker. Attaching a folder normally just adds a workspace. When the
 *  folder is a git working tree it first offers to also attach it as a repo
 *  (code / diff / terminal); if that repo has a GitHub remote, it then chains
 *  the same "add the connector?" prompt the repo flow uses. Every prompt's
 *  Cancel aborts the whole attach, and each choice can be remembered. Recent
 *  folders show first; Browse reaches the rest, promoting them on attach. */
function FolderPicker({
  maxRows,
  onAdd,
  onClose,
  addedIds,
  hasGitHubConnector,
}: {
  maxRows: number
  onAdd: (ctx: AddedContext) => void
  onClose: () => void
  /** Folder ids already in the shared workspace — rows for these read ✓ Added. */
  addedIds: readonly string[]
  hasGitHubConnector: boolean
}) {
  const [stage, setStage] = useState<'list' | 'repo' | 'connector'>('list')
  const [folder, setFolder] = useState<FolderOption | null>(null)
  const [dontAsk, setDontAsk] = useState(false)
  const [browsing, setBrowsing] = useState(false)

  const recentIds = useRecentIds('folder')
  const byId = new Map(FOLDER_OPTIONS.map((f) => [f.id, f]))
  const recent = recentIds.map((id) => byId.get(id)).filter(Boolean) as FolderOption[]
  // Browse lists what's neither recent nor already attached.
  const rest = FOLDER_OPTIONS.filter((f) => !recentIds.includes(f.id) && !addedIds.includes(f.id))

  const backToList = () => {
    setStage('list')
    setFolder(null)
  }

  // Attach the folder as a workspace, tagging its artifacts with the folder as
  // their source so the one shared workspace can group by folder (and so the
  // attach funnel can recover the folder's id to promote it into Recent).
  // Returns to the list (multi-add — no close). Runs on every path that actually
  // attaches, so it's the single reset point.
  const attachFolder = (f: FolderOption) => {
    const source = { id: f.id, label: `${basename(f.label)}/` }
    onAdd({
      kind: 'folder',
      label: f.label,
      artifacts: f.artifacts.map((a) => ({ ...a, source })),
    })
    backToList()
  }

  const repoCtxFor = (f: FolderOption): RepoContext => ({
    kind: 'repo',
    origin: 'local',
    label: basename(f.label),
    path: f.label,
    remote: f.repo?.remote,
    branch: f.repo!.branch,
    files: f.repo!.files,
    diff: f.repo!.diff,
    terminal: f.repo!.terminal,
  })

  // Attach the folder (workspace) and its repo — connector first when wanted, so
  // focus lands on the repo. attachFolder handles the list reset.
  const attachFolderAndRepo = (f: FolderOption, withConnector: boolean) => {
    if (withConnector) onAdd({ kind: 'connector', connector: GITHUB_CONNECTOR })
    attachFolder(f)
    onAdd(repoCtxFor(f))
  }

  // The repo is being attached too — settle the GitHub connector question.
  const proceedWithRepo = (f: FolderOption) => {
    if (!f.repo?.remote || hasGitHubConnector) return attachFolderAndRepo(f, false)
    const decision = getDecision('linkOnAttach')
    if (decision === 'always') return attachFolderAndRepo(f, true)
    if (decision === 'never') return attachFolderAndRepo(f, false)
    setDontAsk(false)
    setFolder(f)
    setStage('connector')
  }

  const select = (f: FolderOption) => {
    if (!f.repo) return attachFolder(f) // not a git folder → workspace only
    const decision = getDecision('attachRepoOnFolder')
    if (decision === 'never') return attachFolder(f)
    if (decision === 'always') return proceedWithRepo(f)
    setDontAsk(false)
    setFolder(f)
    setStage('repo')
  }

  if (stage === 'repo' && folder) {
    return (
      <AttachPromptCard
        message={
          <>
            <span className="font-medium">{folder.label}</span> is a git repo (
            <span className="font-medium">{folder.repo!.branch}</span>). Also attach it as a{' '}
            <span className="font-medium">repository</span> — code, diff &amp; terminal?
          </>
        }
        dontAsk={dontAsk}
        onToggleDontAsk={() => setDontAsk((v) => !v)}
        onCancel={backToList}
        secondaryLabel="Just the folder"
        onSecondary={() => {
          if (dontAsk) setDecision('attachRepoOnFolder', 'never')
          attachFolder(folder)
        }}
        primaryLabel="Folder + repo"
        onPrimary={() => {
          if (dontAsk) setDecision('attachRepoOnFolder', 'always')
          proceedWithRepo(folder)
        }}
      />
    )
  }

  if (stage === 'connector' && folder) {
    return (
      <AttachPromptCard
        message={
          <>
            <span className="font-medium">{basename(folder.label)}</span> has a GitHub remote. Add the{' '}
            <span className="font-medium">GitHub connector</span> too, so Claude can push and open PRs?
          </>
        }
        dontAsk={dontAsk}
        onToggleDontAsk={() => setDontAsk((v) => !v)}
        onCancel={backToList}
        secondaryLabel="Skip connector"
        onSecondary={() => {
          if (dontAsk) setDecision('linkOnAttach', 'never')
          attachFolderAndRepo(folder, false)
        }}
        primaryLabel="Add connector"
        onPrimary={() => {
          if (dontAsk) setDecision('linkOnAttach', 'always')
          attachFolderAndRepo(folder, true)
        }}
      />
    )
  }

  return (
    <>
      <Section label="Recent folders">
        <RecentOverflowList
          maxRows={maxRows}
          moreLabel="More recent folders"
          rows={recent.map((f) => ({
            key: f.id,
            node: (
              <OptionRow
                icon={<FolderOpen size={16} />}
                label={f.label}
                meta={`${f.meta}${f.repo ? ' · git repo' : ''}`}
                added={addedIds.includes(f.id)}
                onClick={() => select(f)}
              />
            ),
          }))}
        />
        <BrowseRow label="Browse folders…" onClick={() => setBrowsing(true)} />
      </Section>
      <MultiAddFooter count={addedIds.length} onDone={onClose} />
      {browsing && (
        <BrowseDialog
          title="Open Folder"
          location={['~', 'Folders']}
          groups={[
            {
              items: rest.map((f) => ({
                id: f.id,
                name: basename(f.label),
                meta: `${f.meta}${f.repo ? ' · git repo' : ''}`,
                icon: <FolderOpen size={15} />,
              })),
            },
          ]}
          onCancel={() => setBrowsing(false)}
          onConfirm={(id) => {
            setBrowsing(false)
            const f = byId.get(id)
            if (f) select(f)
          }}
        />
      )}
    </>
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
  accentDot,
  added,
  onClick,
}: {
  icon: ReactNode
  label: string
  meta?: string
  /** A small green "connected / ready" dot before the icon (the quick list). */
  accentDot?: boolean
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
      {accentDot && (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" title="Connected" />
      )}
      <span className="shrink-0 text-ink-soft">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-ink">{label}</span>
        {meta && <span className="block truncate text-[11px] text-ink-faint">{meta}</span>}
      </span>
      {added ? (
        <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-emerald-600">
          <Check size={13} strokeWidth={2.5} /> Added
        </span>
      ) : (
        <span
          title="Add"
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-ink-faint transition group-hover:bg-accent group-hover:text-white"
        >
          <Plus size={14} />
        </span>
      )}
    </button>
  )
}
