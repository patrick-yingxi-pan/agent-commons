import { useEffect, useRef, useState, type ReactNode } from 'react'
import { accountGeneration, onAccountSwitch } from '../api/account.ts'
import { Check, Cloud, FolderOpen, Laptop, Plug, Server } from 'lucide-react'
import type { AddedContext, Attachment, Connector, FsFileEntry, FsFolderEntry, FsPhotoEntry, FsSource, Repo, Workspace } from '../types'
import { PhotoThumb } from './PhotoThumb'
import { DeferredContextBrowseDialog as BrowseDialog } from './DeferredContextBrowseDialog.tsx'
import { GITHUB_CONNECTOR_ID } from '../lib/connectors'
import { useRecentIds } from '../lib/recents'
import { UI_HOST_SOURCE, useFsPickerSource } from '../lib/fsSources'
import { fsReadPhase } from '../lib/fsReadState.ts'
import { FS_PICKER_BODY_CLASS, FS_SOURCE_GROUP_CLASS, FS_SOURCE_OPTION_CLASS } from '../lib/fsSourceLayout.ts'
import { FsReadNotice } from './FsReadNotice.tsx'
import type { UiHostFile } from '../lib/uiHostFs'
import { useUiHostFs, type UiHostFsModule } from '../lib/useUiHostFs'
import { UiHostLoadNotice } from './UiHostLoadNotice.tsx'
import { DeferredServedFileIntake } from './DeferredServedFileIntake.tsx'
import { OptionRow } from './ContextOptionRow.tsx'
import { SECONDARY_BUTTON_CLASS, SOFT_BUTTON_CLASS } from '../lib/button'
import { DRAFT_ID } from '../data/liveSession.ts'
import { useFsCatalog, useSavedContexts, fsContentUrl } from '../api/hooks'
import { useMcpConnections } from '../api/mcpConnectionHooks.ts'
import { readFsFolderSnapshot, retryFsCatalog } from '../api/fsReads.ts'
import { workspaceFolders } from '../../contract/workspaceFolders.ts'
import { fsRecentKey, parseFsRecentKey } from '../../contract/index'
import { isExternalMcpId } from '../../contract/mcpConnections.ts'
import { RecentOverflowList, type OverflowRow } from './RecentOverflowList'
import type { ContextTypeId } from '../../contract/contexts.ts'
import { useContextCatalog } from '../api/contextCatalog.ts'
import { ContextCatalogNotice } from './ContextCatalogNotice.tsx'
import { DeferredRepoContextPicker as RepoPicker } from './DeferredRepoContextPicker.tsx'
import { BrowseRow, MultiAddFooter, Section } from './ContextPickerParts.tsx'
import { DeferredDiscussionContextPicker as DiscussionPicker } from './DeferredDiscussionContextPicker.tsx'
import type { TypeId } from './AddContextButton.tsx'

export function WorkflowBody({
  type,
  maxRows,
  onAttach,
  onClose,
  onMcpSetup,
  connectors,
  repos,
  attachments,
  workspaces,
  sessionId,
}: {
  type: TypeId
  /** How many recent rows to show inline before folding the rest into "More". */
  maxRows: number
  /** Attach without closing — every picker stacks adds (multi-add). */
  onAttach: (ctx: AddedContext) => void
  /** Close the whole popover (the multi-add "Done"). */
  onClose: () => void
  onMcpSetup: () => void
  connectors: Connector[]
  repos: Repo[]
  attachments: Attachment[]
  workspaces: Workspace[]
  sessionId?: string
}) {
  // Which option ids are already attached, per type — so an attached element
  // reads "Added" (no plus) instead of inviting a duplicate add. Mapped back to
  // each catalog's id space (mcp connectors carry an `mcp-` prefix; repos derive
  // their live id from the label; folders tag their workspace artifacts).
  const hasGitHubConnector = connectors.some((c) => c.id === GITHUB_CONNECTOR_ID)
  const addedConnectorIds = connectors.filter((c) => c.kind !== 'mcp').map((c) => c.id)
  const addedMcpIds = connectors.filter((c) => c.kind === 'mcp')
    .map((c) => isExternalMcpId(c.id) ? c.id : c.id.replace(/^mcp-/, ''))
  const addedFileIds = attachments.filter((a) => a.kind === 'file').map((a) => a.id)
  const addedPhotoIds = attachments.filter((a) => a.kind === 'photo').map((a) => a.id)
  const addedDiscussionIds = attachments.filter((a) => a.kind === 'discussion').map((a) => a.id)
  const addedRepoIds = repos.map((r) => r.id)
  const addedFolderIds = workspaces.flatMap(workspaceFolders).map((folder) => folder.id)
  const catalog = useContextCatalog(type === 'connector')

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
        addedLocalGitIds={addedFolderIds.filter((id) => parseFsRecentKey(id)?.sourceId === 'ui-host' && /^GIT_[A-F0-9]{32}$/.test(parseFsRecentKey(id)?.entryId ?? ''))}
        hasGitHubConnector={hasGitHubConnector}
      />
    )
  }
  if (type === 'connector') {
    return (
      <>
        <ContextCatalogNotice query={catalog} />
        {catalog.data?.connectors.length ? (
          <ListPicker
            type="connector"
            maxRows={maxRows}
            options={catalog.data.connectors}
            developmentFixtures={catalog.data.developmentFixtures}
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
        ) : <>
          {catalog.data && <p className="px-1 py-3 text-[12px] text-ink-soft">No connector adapters are configured. You can add an MCP server from Contexts.</p>}
          <MultiAddFooter count={addedConnectorIds.length} onDone={onClose} />
        </>}
      </>
    )
  }
  if (type === 'mcp') {
    return <McpPicker maxRows={maxRows} addedIds={addedMcpIds} onAdd={onAttach} onClose={onClose} onSetup={onMcpSetup} />
  }
  if (type === 'discussion') {
    return <DiscussionPicker onAdd={onAttach} onClose={onClose} addedIds={addedDiscussionIds} isDraft={!sessionId || sessionId === DRAFT_ID} />
  }
  if (type === 'files') {
    return <FilePicker kind="files" key="files" maxRows={maxRows} onAdd={onAttach} onClose={onClose} addedIds={addedFileIds} />
  }
  return <FilePicker kind="photos" key="photos" maxRows={maxRows} onAdd={onAttach} onClose={onClose} addedIds={addedPhotoIds} />
}

/** External connections come from the tenant-owned registry, not the fixture
 * catalog. Only the server's current execution posture makes one attachable;
 * the opaque connection id crosses the ordinary atomic context funnel intact. */
function McpPicker({
  maxRows,
  addedIds,
  onAdd,
  onClose,
  onSetup,
}: {
  maxRows: number
  addedIds: readonly string[]
  onAdd: (ctx: AddedContext) => void
  onClose: () => void
  onSetup: () => void
}) {
  const registry = useMcpConnections()
  const catalog = useContextCatalog()
  const external = (registry.data?.connections ?? [])
    .filter((connection) => connection.status === 'connected' && connection.execution === 'approval-required')
    .map((connection) => ({
      id: connection.id,
      label: connection.label,
      meta: `${connection.executableTools?.length ?? 0} tools · Approval required for every call`,
      external: true,
    }))
  const options = [
    ...external,
    ...(catalog.data?.mcp ?? []).map((option) => ({ ...option, external: false })),
  ]
  return (
    <>
      <ContextCatalogNotice query={catalog} />
      <ListPicker
        type="mcp"
        maxRows={maxRows}
        options={options}
        developmentFixtures={catalog.data?.developmentFixtures}
        authoritativeIds={external.map((connection) => connection.id)}
        connectedLabel="Available"
        browseLabel="Add an MCP server…"
        browseTitle="MCP Registry"
        location={['MCP Registry']}
        rowIcon={<Server size={16} />}
        browseIcon={<Server size={15} />}
        rowMeta={(m) => m.meta}
        toContext={(m) => m.external ? ({
          kind: 'mcp',
          connector: { id: m.id, label: m.label, kind: 'mcp' },
        }) : ({
          kind: 'mcp',
          connector: { id: `mcp-${m.id}`, label: `MCP · ${m.label}`, kind: 'mcp' },
        })}
        addedIds={addedIds}
        onAdd={onAdd}
        onClose={onClose}
        onBrowse={catalog.data?.developmentFixtures ? undefined : onSetup}
      />
    </>
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
  developmentFixtures = false,
  authoritativeIds = [],
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
  onBrowse,
}: {
  type: ContextTypeId
  maxRows: number
  options: readonly T[]
  developmentFixtures?: boolean
  /** Registry-owned ready rows do not depend on local recency to be reusable. */
  authoritativeIds?: readonly string[]
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
  onBrowse?: () => void
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
  const availableIds = [...new Set([...authoritativeIds, ...recentIds])]
  const connected = availableIds.map((id) => byId.get(id)).filter(Boolean) as T[]
  const rest = options.filter((o) => !availableIds.includes(o.id))

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
      {browsing && (
        <BrowseDialog
          title={browseTitle}
          developmentFixtures={developmentFixtures}
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
      <Section label={connectedLabel}>
        <RecentOverflowList rows={rows} maxRows={maxRows} moreLabel={`More ${connectedLabel.toLowerCase()}`} />
        <BrowseRow label={browseLabel} onClick={onBrowse ?? (() => setBrowsing(true))} />
      </Section>
      <MultiAddFooter count={addedIds.length} onDone={onClose} />
    </>
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
    <div data-fs-source-switcher="" className={FS_SOURCE_GROUP_CLASS}>
      {sources.map((s) => {
        const Icon = SOURCE_ICON[s.kind]
        const on = s.id === active
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onPick(s.id)}
            aria-pressed={on}
            title={s.label}
            className={`${FS_SOURCE_OPTION_CLASS} ${
              on ? 'bg-surface text-ink ring-1 ring-line-strong' : 'text-ink-soft hover:text-ink'
            }`}
          >
            <Icon size={13} className="shrink-0" />
            <span className="min-w-0 truncate">{s.label}</span>
          </button>
        )
      })}
    </div>
  )
}

function FsSourcePanel({ selection, children }: {
  selection: ReturnType<typeof useFsPickerSource>
  children: ReactNode
}) {
  return <div data-fs-picker-body className={FS_PICKER_BODY_CLASS}>
    <SourceSwitcher sources={selection.sources} active={selection.sourceId} onPick={selection.pick} />
    {selection.active ? children : <FsReadNotice phase={selection.phase} label="file sources" onRetry={selection.retry} unavailable={selection.phase === 'empty'} />}
  </div>
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

/** Files and photos share source admission and intake; only their catalog view
 * and accepted local formats differ. */
function FilePicker({
  kind,
  maxRows,
  onAdd,
  onClose,
  addedIds,
}: {
  kind: 'files' | 'photos'
  maxRows: number
  onAdd: (ctx: AddedContext) => void
  onClose: () => void
  addedIds: readonly string[]
}) {
  const selection = useFsPickerSource()
  const { active } = selection
  const hostFs = useUiHostFs(active?.kind === 'ui-host')

  const attachUiHost = (f: UiHostFile) =>
    onAdd({
      kind,
      attachments: [
        { id: fsRecentKey('ui-host', f.id), label: f.name, kind: kind === 'photos' ? 'photo' : f.kind, source: UI_HOST_SOURCE, previewText: f.text, documentImport: f.documentImport, image: f.image },
      ],
    })
  const attachServed = (e: FsFileEntry | FsPhotoEntry) =>
    active && onAdd({ kind, attachments: [{ id: fsRecentKey(active.id, e.id), label: e.name, kind: kind === 'photos' ? 'photo' : 'file', source: active }] })

  return (
    <div className="pb-1">
      <FsSourcePanel selection={selection}>
        {active?.kind === 'ui-host' ? (
          hostFs.module ? (
            <hostFs.module.UiHostDropZone accept={kind === 'photos' ? 'image' : 'any'} label={`Add ${kind} from this computer`} onPicked={attachUiHost} hostFs={hostFs.module} />
          ) : <UiHostLoadNotice state={hostFs} label={kind === 'photos' ? 'photo access' : 'file access'} />
        ) : active ? (
          <DeferredServedFileIntake key={`${active.id}:${kind}`} kind={kind} source={active} onAdd={onAdd} onClose={onClose} maxRows={maxRows} addedIds={addedIds} onPreviewOnly={attachServed} PhotoThumb={PhotoThumb} />
        ) : null}
      </FsSourcePanel>
      <MultiAddFooter count={addedIds.length} onDone={onClose} />
    </div>
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
  disabled = false,
}: {
  source: FsSource
  maxRows: number
  addedIds: readonly string[]
  onAttach: (f: FsFolderEntry) => void
  disabled?: boolean
}) {
  const cat = useFsCatalog(source.id)
  const recentKeys = useRecentIds('folder')
  const folders = cat.data?.folders ?? []
  const recent = recentEntryIds(recentKeys, source.id)
  const ordered = [...folders.filter((f) => recent.has(f.path)), ...folders.filter((f) => !recent.has(f.path))]
  const phase = fsReadPhase(cat.status, folders.length > 0)
  if (phase !== 'ready') return <FsReadNotice phase={phase} label="folders" onRetry={() => retryFsCatalog(source.id)} />
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
            disabled={disabled}
            onClick={() => onAttach(f)}
          />
        ),
      }))}
    />
  )
}

/** A read is cancellable until it enters the acknowledged context-mutation queue.
 * This component is keyed by source; switching it or closing the picker abandons
 * the read without creating a success-shaped empty workspace. */
function ServedFolderPicker({ source, maxRows, addedIds, onAdd }: {
  source: FsSource
  maxRows: number
  addedIds: readonly string[]
  onAdd: (ctx: AddedContext) => void
}) {
  const [read, setRead] = useState<{ entry: FsFolderEntry; status: 'loading' | 'error' } | null>(null)
  const intake = useRef<AbortController | null>(null)
  useEffect(() => {
    const cancel = () => { intake.current?.abort(); intake.current = null }
    const unsubscribe = onAccountSwitch(() => { cancel(); setRead(null) })
    return () => { unsubscribe(); cancel() }
  }, [])

  const take = async (entry: FsFolderEntry) => {
    if (intake.current) return
    const controller = new AbortController()
    const issuedAccount = accountGeneration()
    intake.current = controller
    setRead({ entry, status: 'loading' })
    try {
      const snapshot = await readFsFolderSnapshot(source.id, entry.path, controller.signal)
      if (controller.signal.aborted || issuedAccount !== accountGeneration()) return
      const src = { id: fsRecentKey(source.id, entry.path), label: `${entry.name}/` }
      setRead(null)
      onAdd({ kind: 'folder', label: entry.name, folder: { ...src, snapshot }, artifacts: [], source })
    } catch {
      if (!controller.signal.aborted && issuedAccount === accountGeneration()) setRead({ entry, status: 'error' })
    } finally {
      if (intake.current === controller) intake.current = null
    }
  }

  return <>
    <fieldset disabled={read?.status === 'loading'}>
      <ServedFolders source={source} maxRows={maxRows} addedIds={addedIds} disabled={read?.status === 'loading'} onAttach={(entry) => void take(entry)} />
    </fieldset>
    <p className="px-1 pt-1.5 text-[11px] leading-snug text-ink-soft">Save up to 24 readable top-level text files, 64 KB each and 128 KB total. Hidden files and subfolders are excluded. Saved copies feed the model; Refresh is explicit and never changes originals.</p>
    {read && <div data-fs-folder-read={read.status} role={read.status === 'error' ? 'alert' : 'status'} aria-busy={read.status === 'loading'} className="break-words px-1 py-2 text-[12px] text-ink-soft">
      {read.status === 'loading' ? <p>Reading {read.entry.name}… Close this picker or choose another source to cancel.</p> : <>
        <p className="break-words text-danger-text">Could not read {read.entry.name}. Nothing was attached.</p>
        <button type="button" onClick={() => void take(read.entry)} className={`${SECONDARY_BUTTON_CLASS} mt-2 px-2 py-1 text-[12px]`}>Retry</button>
      </>}
    </div>}
  </>
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
  const selection = useFsPickerSource()
  const { active } = selection
  const hostFs = useUiHostFs(active?.kind === 'ui-host')

  return (
    <div className="pb-1">
      <FsSourcePanel selection={selection}>
        {active?.kind === 'ui-host' ? (
          hostFs.module ? window.agentCommonsDesktop?.context?.localFolders
        ? <hostFs.module.NativeLocalFolderPicker onAdd={onAdd} addedIds={addedIds} onClose={onClose} />
            : <UiHostFolderPicker hostFs={hostFs.module} onAdd={onAdd} />
            : <UiHostLoadNotice state={hostFs} label="folder access" />
        ) : active ? (
          <ServedFolderPicker key={active.id} source={active} maxRows={Math.max(2, maxRows - 1)} addedIds={addedIds} onAdd={onAdd} />
        ) : null}
      </FsSourcePanel>
      <MultiAddFooter count={addedIds.length} onDone={onClose} />
    </div>
  )
}

/** The local intake's lifetime also ends when its selected source leaves. */
function UiHostFolderPicker({ hostFs, onAdd }: { hostFs: UiHostFsModule; onAdd: (ctx: AddedContext) => void }) {
  const [failure, setFailure] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const busy = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const attachUiHost = async () => {
    if (busy.current || !mounted.current) return
    busy.current = true
    setPending(true)
    setFailure(null)
    const issuedAccount = accountGeneration()
    try {
      const picked = await hostFs.pickUiHostFolder()
      if (!mounted.current || accountGeneration() !== issuedAccount) return
      if (!picked) return
      const src = { id: fsRecentKey('ui-host', picked.id), label: `${picked.name}/` }
      onAdd({
        kind: 'folder',
        label: picked.name,
        folder: src,
        artifacts: picked.artifacts.map((a) => ({ ...a, source: src })),
        source: UI_HOST_SOURCE,
      })
    } catch (error) {
      if (mounted.current && accountGeneration() === issuedAccount) {
        setFailure(error instanceof Error ? error.message : 'The selected folder could not be read. Try again.')
      }
    } finally {
      busy.current = false
      if (mounted.current) setPending(false)
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => void attachUiHost()}
        disabled={pending}
        aria-busy={pending}
        className="flex w-full flex-col items-center justify-center rounded-lg border border-dashed border-line-strong px-3 py-6 text-center transition hover:bg-panel-2"
      >
        <FolderOpen size={18} className="mb-1 text-ink-faint" />
        <span className="text-[12px] font-medium text-ink">Choose a folder from this computer</span>
        <span className="text-[11px] text-ink-faint">Import top-level text snapshots for the selected model. Hidden files and subfolders are excluded.</span>
      </button>
      <p className="px-1 pt-1.5 text-[11px] leading-snug text-ink-faint">Up to 24 readable files, 64 KB each and 128 KB total. Original files are never changed or kept in sync. Reattach to import later edits.</p>
      {pending && <p role="status" className="px-1 pt-1.5 text-[11px] text-ink-soft">Reading selected folder… Close this picker or choose another source to cancel.</p>}
      {failure && <p role="alert" className="px-1 pt-1.5 text-[11px] leading-snug text-danger-text">{failure}</p>}
    </div>
  )
}
