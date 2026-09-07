import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, X } from 'lucide-react'
import type { Artifact, Attachment } from '../../types'
import { attachmentInputCopy, planAttachmentInput, type AttachmentInputStatus } from '../../../contract/attachmentInput.ts'
import { ArtifactBodyView, KIND_ICON, KIND_LABEL } from '../artifactPreview'
import { FOLD_HOVER } from '../../lib/foldHeader'
import { DANGER_BUTTON_CLASS } from '../../lib/button'
import { parseFsRecentKey } from '../../../contract/index'

export function ArtifactPanel({
  artifacts,
  workspaceName,
  onRemoveFolder,
  inputAttachments = [],
}: {
  artifacts: Artifact[]
  inputAttachments?: Attachment[]
  workspaceName: string
  /** Remove a whole source folder from the workspace (the per-folder ✕). When
   *  absent, folder headers show no remove control. */
  onRemoveFolder?: (sourceId: string) => void
}) {
  const [selectedId, setSelectedId] = useState(artifacts[0]?.id)
  // Whether the bottom preview pane is showing. Closing it hands the list the
  // full height; clicking any artifact brings it back on that artifact.
  const [previewOpen, setPreviewOpen] = useState(true)
  // Folder groups the user has folded shut, keyed by group id.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  // The folder group awaiting a remove confirmation (null = none).
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null)

  // Keep the selection valid as the workspace fills in during the demo.
  useEffect(() => {
    if (!artifacts.some((a) => a.id === selectedId)) {
      setSelectedId(artifacts[0]?.id)
    }
  }, [artifacts, selectedId])

  const selected = artifacts.find((a) => a.id === selectedId) ?? artifacts[0]
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
    const m = new Map<string, { id: string; label: string; items: Artifact[] }>()
    for (const a of artifacts) {
      const key = a.source?.id ?? '__default'
      if (!m.has(key)) m.set(key, { id: key, label: a.source?.label ?? 'This session', items: [] })
      m.get(key)!.items.push(a)
    }
    return [...m.values()]
  }, [artifacts])
  // Show foldable folder headers once any folder has contributed; the pure
  // seeded/default workspace (no sourced artifacts) stays a flat list.
  const showGroups = artifacts.some((a) => a.source)
  const folderCount = groups.filter((g) => g.id !== '__default').length

  const renderRow = (a: Artifact) => {
    const Icon = KIND_ICON[a.kind]
    const active = previewOpen && a.id === selected?.id
    return (
      <button
        key={a.id}
        onClick={() => openPreview(a.id)}
        className={`mb-1 flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition ${
          active ? 'bg-surface ring-1 ring-line-strong' : 'hover:bg-surface/60'
        }`}
      >
        <Icon size={16} className="shrink-0 text-cap-workspace" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium text-ink">{a.name}</div>
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
              const confirming = confirmRemoveId === g.id
              return (
                <div key={g.id} className="mb-1.5">
                  <div className={`group/fold mb-0.5 flex items-center gap-1 rounded-md px-1.5 py-1 ${FOLD_HOVER.panel}`}>
                    <button
                      onClick={() => toggleGroup(g.id)}
                      aria-expanded={!isCollapsed}
                      className="flex min-w-0 flex-1 items-center gap-1 text-left"
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
                    {canRemove && !confirming && (
                      <button
                        onClick={() => setConfirmRemoveId(g.id)}
                        title="Remove folder from workspace"
                        aria-label={`Remove ${g.label} from the workspace`}
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-faint opacity-0 transition hover:bg-removed-bg hover:text-removed focus-visible:opacity-100 group-hover/fold:opacity-100"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
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
                          onClick={() => setConfirmRemoveId(null)}
                          className="rounded px-1.5 py-0.5 text-[11px] font-medium text-ink-soft transition hover:bg-panel-2"
                        >
                          Cancel
                        </button>
                        <button
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
                </div>
              )
            })
          : artifacts.map(renderRow)}
      </div>

      {previewOpen && selected && (
        <div className="flex-1 overflow-y-auto border-t border-line bg-surface p-3">
          <ArtifactPreview artifact={selected} inputStatus={inputPlan.find((item) => item.attachment.id === selected.id)?.status ?? 'unavailable'} onClose={() => setPreviewOpen(false)} />
        </div>
      )}
    </div>
  )
}

function ArtifactPreview({ artifact, inputStatus, onClose }: { artifact: Artifact; inputStatus: AttachmentInputStatus; onClose: () => void }) {
  // A folder artifact served from a real filesystem carries its source on
  // `artifact.source.id` (`<source>::<folderPath>`) and its path on `artifact.id`,
  // so its real content is fetched. UI-host folders + seeded artifacts have no
  // served source. Local snapshots never fall back to the authored library.
  const parsed = artifact.source ? parseFsRecentKey(artifact.source.id) : null
  const served =
    parsed && parsed.sourceId !== 'ui-host' ? { sourceId: parsed.sourceId, path: artifact.id } : undefined
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
      <div className="mb-3 truncate text-[15px] font-semibold text-ink">{artifact.name}</div>
      {parsed?.sourceId === 'ui-host' ? (
        <div data-folder-snapshot-preview>
          <p className="mb-2 text-[11px] leading-snug text-ink-soft">Imported snapshot · read-only. Reattach the folder to import later edits.</p>
          <p className="mb-3 text-[11px] leading-snug text-ink-soft">{attachmentInputCopy(inputStatus)}</p>
          {typeof artifact.localSnapshot?.text === 'string' ? (
            <pre className="whitespace-pre-wrap break-words text-[12px] leading-relaxed text-ink [overflow-wrap:anywhere]">{artifact.localSnapshot.text || '(Empty file)'}</pre>
          ) : (
            <p className="text-[12px] leading-snug text-ink-faint">{folderOmissionCopy(artifact.localSnapshot?.omitted)}</p>
          )}
        </div>
      ) : (
        <ArtifactBodyView kind={artifact.kind} name={artifact.name} artifactId={artifact.id} size="compact" served={served} />
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
