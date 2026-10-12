import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, RefreshCw, X } from 'lucide-react'
import type { Artifact, Attachment, WorkspaceFolder } from '../../types'
import { workspaceArtifactKey, type WorkspaceArtifact } from '../../../contract/workspaceFolders.ts'
import { attachmentInputCopy, planAttachmentInput, type AttachmentInputStatus } from '../../../contract/attachmentInput.ts'
import { ArtifactBodyView, KIND_ICON, KIND_LABEL } from '../artifactPreview'
import { FOLD_HOVER } from '../../lib/foldHeader'
import { DANGER_BUTTON_CLASS } from '../../lib/button'
import { parseFsRecentKey } from '../../../contract/index'
import { SectionAction } from '../SectionAction'
import { refreshServedFolder } from '../../controller/servedFolderRefresh.ts'
import { refreshLocalFolder } from '../../controller/localFolderRefresh.ts'
import { localFolderTreeAvailable, localFoldersAvailable } from '../../api/localFolders.ts'
import { refreshLocalGitFolder } from '../../controller/localGitRefresh.ts'
import { localGitAvailable } from '../../api/localGitCapability.ts'
import { GitSnapshotPolicy } from '../GitSnapshotPolicy'
import { isRecursiveFolder } from '../../lib/folderPresentation.ts'

export function ArtifactPanel({
  artifacts,
  workspaceName,
  onRemoveFolder,
  inputAttachments = [],
  folders = [],
  refreshSessionId,
  refreshDisabled = false,
}: {
  artifacts: WorkspaceArtifact[]
  folders?: WorkspaceFolder[]
  inputAttachments?: Attachment[]
  refreshSessionId?: string
  refreshDisabled?: boolean
  workspaceName: string
  /** Remove a whole source folder from the workspace (the per-folder ✕). When
   *  absent, folder headers show no remove control. */
  onRemoveFolder?: (sourceId: string) => void
}) {
  const [selectedId, setSelectedId] = useState(artifacts[0] && workspaceArtifactKey(artifacts[0]))
  // Whether the bottom preview pane is showing. Closing it hands the list the
  // full height; clicking any artifact brings it back on that artifact.
  const [previewOpen, setPreviewOpen] = useState(true)
  // Folder groups the user has folded shut, keyed by group id.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  // The folder group awaiting a remove confirmation (null = none).
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null)

  // Keep the selection valid as the workspace fills in during the demo.
  useEffect(() => {
    if (!artifacts.some((a) => workspaceArtifactKey(a) === selectedId)) {
      setSelectedId(artifacts[0] && workspaceArtifactKey(artifacts[0]))
    }
  }, [artifacts, selectedId])

  const selected = artifacts.find((a) => workspaceArtifactKey(a) === selectedId) ?? artifacts[0]
  const selectedFolder = folders.find((folder) => folder.id === selected?.source?.id)
  const inputPlan = planAttachmentInput(inputAttachments)

  const openPreview = (id: string) => {
    setSelectedId(id)
    setPreviewOpen(true)
  }

  const toggleGroup = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // Group artifacts by their source folder. Artifacts with no source (the
  // session's own seeded/demo outputs) fall under one default group labelled
  // "This session", to set it apart from the attached source folders rather than
  // read as a folder named after the workspace. Folder subheaders appear once any
  // folder contributes; a purely sourceless workspace stays a flat list.
  const groups = useMemo(() => {
    const m = new Map<string, { id: string; label: string; items: WorkspaceArtifact[]; folder?: WorkspaceFolder }>()
    for (const folder of folders) m.set(folder.id, { id: folder.id, label: folder.label, items: [], folder })
    for (const a of artifacts) {
      const key = a.source?.id ?? '__default'
      if (!m.has(key)) m.set(key, { id: key, label: a.source?.label ?? 'This session', items: [] })
      m.get(key)!.items.push(a)
    }
    return [...m.values()]
  }, [artifacts, folders])
  // Show foldable folder headers once any folder has contributed; the pure
  // seeded/default workspace (no sourced artifacts) stays a flat list.
  const showGroups = folders.length > 0 || artifacts.some((a) => a.source)
  const folderCount = groups.filter((g) => g.id !== '__default').length

  const renderRow = (a: WorkspaceArtifact) => {
    const Icon = KIND_ICON[a.kind]
    const key = workspaceArtifactKey(a)
    const active = previewOpen && !!selected && key === workspaceArtifactKey(selected)
    const recursive = isRecursiveFolder(folders.find((folder) => folder.id === a.source?.id))
    return (
      <button
        key={key}
        onClick={() => openPreview(key)}
        className={`mb-1 flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition ${
          active ? 'bg-surface ring-1 ring-line-strong' : 'hover:bg-surface/60'
        }`}
      >
        <Icon size={16} className="shrink-0 text-cap-workspace" />
        <div className="min-w-0 flex-1">
          <div data-folder-path-scope={recursive ? 'recursive' : 'flat'} title={a.name} className={`${recursive ? 'break-all whitespace-normal' : 'truncate'} text-[13px] font-medium text-ink`}>{a.name}</div>
          <div className="truncate text-[11px] text-ink-faint">{a.meta}</div>
        </div>
      </button>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-line px-3 py-2">
        <div className="text-[12px] font-semibold text-ink">{workspaceName}</div>
        <div className="text-[11px] text-ink-faint">
          {artifacts.length} item{artifacts.length === 1 ? '' : 's'}
          {folderCount > 0 ? ` · ${folderCount} folder${folderCount === 1 ? '' : 's'}` : ' in workspace'}
        </div>
      </div>

      <div
        className={`overflow-y-auto px-2 py-2 ${previewOpen && selected ? 'max-h-[46%] shrink-0 short:max-h-[28%]' : 'flex-1'}`}
      >
        {showGroups
          ? groups.map((g) => {
              const isCollapsed = collapsed.has(g.id)
              // The default group holds the conversation's own (sourceless)
              // outputs — not a folder, so it has no per-folder remove.
              const canRemove = g.id !== '__default' && !!onRemoveFolder
              const address = parseFsRecentKey(g.id)
              const served = address && address.sourceId !== 'ui-host'
              const local = address?.sourceId === 'ui-host' ? g.folder?.localSnapshot : undefined
              const git = address?.sourceId === 'ui-host' ? g.folder?.gitSnapshot : undefined
              const snapshot = local || git || g.folder?.snapshot
              const recursive = isRecursiveFolder(g.folder)
              const confirming = confirmRemoveId === g.id
              return (
                <div key={g.id} data-workspace-folder={g.id} className="mb-1.5">
                  <div className={`group/fold mb-0.5 flex items-center gap-1 rounded-md px-1.5 py-1 ${FOLD_HOVER.panel}`}>
                    <button
                      onClick={() => toggleGroup(g.id)}
                      aria-expanded={!isCollapsed}
                      className="flex min-h-6 min-w-0 flex-1 items-center gap-1 text-left"
                    >
                      {isCollapsed ? (
                        <ChevronRight size={12} className="shrink-0 text-ink-faint" />
                      ) : (
                        <ChevronDown size={12} className="shrink-0 text-ink-faint" />
                      )}
                      <span className="min-w-0 flex-1 truncate text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
                        {g.label}
                      </span>
                      <span className="shrink-0 text-[10px] font-medium text-ink-faint">{g.items.length}</span>
                    </button>
                    {(served || (local && localFoldersAvailable()) || (git && localGitAvailable())) && refreshSessionId && g.folder && (
                      <SectionAction
                        label={`${snapshot ? 'Refresh' : 'Save snapshot of'} ${g.label}`}
                        caption={snapshot ? 'Refresh' : 'Save snapshot'}
                        icon={<RefreshCw size={12} />}
                        disabled={refreshDisabled}
                        disabledReason="Resolve the current context update first"
                        onClick={() => void (git ? refreshLocalGitFolder : local ? refreshLocalFolder : refreshServedFolder)(refreshSessionId, g.folder!)}
                      />
                    )}
                    {canRemove && !confirming && (
                      <SectionAction
                        onClick={() => setConfirmRemoveId(g.id)}
                        label={`Remove ${g.label} from the workspace`}
                        disabled={refreshDisabled}
                        icon={<X size={12} />}
                      />
                    )}
                  </div>
                  {!isCollapsed && (served || local || git) && (
                    <div data-served-folder-state={snapshot ? 'saved' : 'missing'} className="px-2 pb-1 text-[11px] leading-snug text-ink-soft">
                      {git ? <>Saved Git snapshot <time dateTime={git.capturedAt}>{new Date(git.capturedAt).toLocaleString()}</time> · read-only. {git.files.filter(file => 'omitted' in file.snapshot).length} tracked file(s) have no saved text. {refreshSessionId ? localGitAvailable() ? 'Refresh to capture later tracked edits.' : 'Refresh requires the connection on its original device.' : 'Only the conversation owner can refresh this copy.'}<GitSnapshotPolicy /></>
                        : snapshot ? <>Saved {recursive ? 'including subfolders (root-relative paths shown)' : 'from the top level only'} <time dateTime={snapshot.capturedAt}>{new Date(snapshot.capturedAt).toLocaleString()}</time> · read-only. {!refreshSessionId ? 'Only the conversation owner can refresh this copy.' : local && !localFoldersAvailable() ? 'Refresh requires the connection on its original device.' : local?.version === 2 && !localFolderTreeAvailable() ? 'Recursive refresh is unavailable on this device; the saved copy is unchanged.' : 'Refresh to capture later edits.'}</> : 'No saved copy yet. Save a snapshot to preview and send readable text.'}
                    </div>
                  )}
                  {/* Folder-scoped confirm, inline in the list. Intentionally
                      simpler than the composer chips' shared RemoveConfirm (no
                      cascade, no "don't ask again") — it removes a workspace
                      folder, not a conversation-level context. */}
                  {confirming && (
                    <div className="mb-1 flex items-center gap-2 rounded-md bg-panel-2/60 px-2 py-1.5">
                      <span className="min-w-0 flex-1 text-[11px] leading-snug text-ink-soft">
                        Remove this folder from the workspace?
                      </span>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          disabled={refreshDisabled}
                          onClick={() => setConfirmRemoveId(null)}
                          className="rounded px-1.5 py-0.5 text-[11px] font-medium text-ink-soft transition hover:bg-panel-2"
                        >
                          Cancel
                        </button>
                        <button
                          disabled={refreshDisabled}
                          onClick={() => {
                            onRemoveFolder?.(g.id)
                            setConfirmRemoveId(null)
                          }}
                          className={`${DANGER_BUTTON_CLASS} px-1.5 py-0.5 text-[11px]`}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  )}
                  {!isCollapsed && g.items.map(renderRow)}
                  {!isCollapsed && g.items.length === 0 && <p className="px-2 py-2 text-[12px] text-ink-soft">No visible {recursive ? 'files in this saved folder tree' : 'top-level files in this saved folder'}.</p>}
                </div>
              )
            })
          : artifacts.map(renderRow)}
      </div>

      {previewOpen && selected && (
        <div className="flex-1 overflow-y-auto border-t border-line bg-surface p-3">
          <ArtifactPreview artifact={selected} gitSnapshot={selectedFolder?.gitSnapshot} folderScope={isRecursiveFolder(selectedFolder) ? 'recursive' : 'flat'} inputStatus={inputPlan.find((item) => item.attachment.id === selected.id && (item.attachment.source?.kind === 'ui-host' || item.attachment.textSnapshot?.snapshotId === selected.savedFolderSnapshotId))?.status ?? 'unavailable'} onClose={() => setPreviewOpen(false)} />
        </div>
      )}
    </div>
  )
}

function ArtifactPreview({ artifact, gitSnapshot, folderScope, inputStatus, onClose }: { artifact: WorkspaceArtifact; gitSnapshot?: NonNullable<WorkspaceFolder['gitSnapshot']>; folderScope: 'flat' | 'recursive'; inputStatus: AttachmentInputStatus; onClose: () => void }) {
  // Attached folders are saved copies, never live source or library aliases.
  const parsed = artifact.source ? parseFsRecentKey(artifact.source.id) : null
  const snapshot = artifact.savedFolderSnapshot ?? artifact.localSnapshot
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">
          {KIND_LABEL[artifact.kind]}
        </span>
        <button
          onClick={onClose}
          title="Close preview"
          aria-label="Close preview"
          className="-mr-1 -mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-faint transition hover:bg-panel-2 hover:text-ink"
        >
          <X size={14} />
        </button>
      </div>
      <div data-folder-path-scope={folderScope} title={artifact.name} className={`mb-3 text-[15px] font-semibold text-ink ${folderScope === 'recursive' ? 'break-all whitespace-normal' : 'truncate'}`}>{artifact.name}</div>
      {parsed ? (
        <div data-folder-snapshot-preview>
          <p className="mb-2 text-[11px] leading-snug text-ink-soft">{gitSnapshot ? `Saved Git snapshot · ${new Date(gitSnapshot.capturedAt).toLocaleString()} · read-only. This preview uses saved text only; opening and sending do not read the repository.` : parsed.sourceId === 'ui-host' && !artifact.savedFolderSnapshot
            ? 'Imported snapshot · read-only. Reattach the folder to import later edits.'
            : snapshot ? `Saved ${folderScope === 'recursive' ? 'including subfolders; this is the full root-relative path' : parsed.sourceId === 'ui-host' ? 'from the top level only' : 'folder snapshot'} · read-only. Original files are never changed or read automatically. Preview and sending use saved text only.` : 'No saved copy. Use Save snapshot on the folder to capture its readable text.'}</p>
          {snapshot && <p className="mb-3 text-[11px] leading-snug text-ink-soft">{attachmentInputCopy(inputStatus)}</p>}
          {typeof snapshot?.text === 'string' ? (
            <pre className="whitespace-pre-wrap break-words text-[12px] leading-relaxed text-ink [overflow-wrap:anywhere]">{snapshot.text || '(Empty file)'}</pre>
          ) : (
            snapshot && <p className="text-[12px] leading-snug text-ink-faint">{folderOmissionCopy(snapshot.omitted)}</p>
          )}
        </div>
      ) : (
        <ArtifactBodyView kind={artifact.kind} name={artifact.name} artifactId={artifact.id} size="compact" />
      )}
    </div>
  )
}

function folderOmissionCopy(reason: NonNullable<Artifact['localSnapshot']>['omitted']): string {
  switch (reason) {
    case 'unsupported': return 'Preview unavailable. This format is not imported as plain text.'
    case 'too-large': return 'Preview unavailable. This file exceeds the 64 KB import limit.'
    case 'budget': return 'Preview unavailable. The folder import reached its 24-file or 128 KB limit. Attach this file separately to prioritize it.'
    case 'unreadable': return 'Preview unavailable. The file could not be read as whole UTF-8 text.'
    default: return 'Preview unavailable. Reattach the folder to import its text.'
  }
}
