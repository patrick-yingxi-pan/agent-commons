import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, FileText, Image as ImageIcon, Mail, Sheet, Presentation, X } from 'lucide-react'
import type { Artifact, ArtifactKind } from '../../types'

const KIND_ICON: Record<ArtifactKind, typeof FileText> = {
  doc: FileText,
  email: Mail,
  image: ImageIcon,
  slide: Presentation,
  sheet: Sheet,
}

export function ArtifactPanel({
  artifacts,
  workspaceName,
}: {
  artifacts: Artifact[]
  workspaceName: string
}) {
  const [selectedId, setSelectedId] = useState(artifacts[0]?.id)
  // Whether the bottom preview pane is showing. Closing it hands the list the
  // full height; clicking any artifact brings it back on that artifact.
  const [previewOpen, setPreviewOpen] = useState(true)
  // Folder groups the user has folded shut, keyed by group id.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())

  // Keep the selection valid as the workspace fills in during the demo.
  useEffect(() => {
    if (!artifacts.some((a) => a.id === selectedId)) {
      setSelectedId(artifacts[0]?.id)
    }
  }, [artifacts, selectedId])

  const selected = artifacts.find((a) => a.id === selectedId) ?? artifacts[0]

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

  // Group artifacts by their source folder. Artifacts with no source (a
  // conversation's own seeded/demo outputs) fall under one default group labelled
  // with the workspace name. Subheaders only appear once ≥2 folders contribute,
  // so the common single-source case looks exactly as before.
  const groups = useMemo(() => {
    const m = new Map<string, { id: string; label: string; items: Artifact[] }>()
    for (const a of artifacts) {
      const key = a.source?.id ?? '__default'
      if (!m.has(key)) m.set(key, { id: key, label: a.source?.label ?? workspaceName, items: [] })
      m.get(key)!.items.push(a)
    }
    return [...m.values()]
  }, [artifacts, workspaceName])
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
        <div className="text-xs font-semibold text-ink">{workspaceName}</div>
        <div className="text-[11px] text-ink-faint">
          {artifacts.length} item{artifacts.length === 1 ? '' : 's'}
          {folderCount > 0 ? ` · ${folderCount} folder${folderCount === 1 ? '' : 's'}` : ' in workspace'}
        </div>
      </div>

      <div
        className={`overflow-y-auto px-2 py-2 ${previewOpen && selected ? 'shrink-0' : 'flex-1'}`}
        style={previewOpen && selected ? { maxHeight: '46%' } : undefined}
      >
        {showGroups
          ? groups.map((g) => {
              const isCollapsed = collapsed.has(g.id)
              return (
                <div key={g.id} className="mb-1.5">
                  <button
                    onClick={() => toggleGroup(g.id)}
                    aria-expanded={!isCollapsed}
                    className="mb-0.5 flex w-full items-center gap-1 rounded-md px-1.5 py-1 text-left transition hover:bg-surface/60"
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
                  {!isCollapsed && g.items.map(renderRow)}
                </div>
              )
            })
          : artifacts.map(renderRow)}
      </div>

      {previewOpen && selected && (
        <div className="flex-1 overflow-y-auto border-t border-line bg-surface p-3">
          <ArtifactPreview artifact={selected} onClose={() => setPreviewOpen(false)} />
        </div>
      )}
    </div>
  )
}

function hashId(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return h
}

/** Deterministic skeleton-line widths seeded by an artifact id, so two same-kind
 *  artifacts in the shared workspace never render an identical body. */
const LINE_WIDTHS = ['w-full', 'w-11/12', 'w-5/6', 'w-4/5', 'w-3/4', 'w-2/3', 'w-1/2']
function bodyLines(id: string, n: number): string[] {
  const h = hashId(id)
  return Array.from({ length: n }, (_, i) => LINE_WIDTHS[(h + i * 3) % LINE_WIDTHS.length])
}

/** A muted gradient seeded across the full hue circle by id, so two different
 *  image artifacts in the same workspace get visibly different previews (a small
 *  fixed palette collides — see the 4-gradient photo set). */
function imageTint(id: string): string {
  const hue = hashId(id) % 360
  return `linear-gradient(135deg, hsl(${hue} 38% 74%), hsl(${(hue + 26) % 360} 34% 55%))`
}

const KIND_LABEL: Record<ArtifactKind, string> = {
  doc: 'Document',
  email: 'Draft email',
  image: 'Image',
  slide: 'Slides',
  sheet: 'Sheet',
}

function ArtifactPreview({ artifact, onClose }: { artifact: Artifact; onClose: () => void }) {
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
      <div className="mb-3 truncate text-sm font-semibold text-ink">{artifact.name}</div>

      {artifact.kind === 'image' ? (
        <div
          className="flex aspect-video w-full items-center justify-center rounded-lg text-sm font-medium text-white/90 shadow-inner"
          style={{ background: imageTint(artifact.id) }}
        >
          {artifact.name}
        </div>
      ) : artifact.kind === 'sheet' ? (
        <div className="overflow-hidden rounded-lg border border-line text-[11px]">
          {['cohort,users,churn', 'Annual · May,1,204,2.1%', 'Annual · Jun,1,190,4.8%', 'Monthly · Jun,3,902,3.0%'].map(
            (row, i) => (
              <div
                key={i}
                className={`grid grid-cols-3 gap-2 px-2 py-1 ${
                  i === 0 ? 'bg-panel-2 font-semibold text-ink' : 'text-ink-soft'
                } ${i > 0 ? 'border-t border-line' : ''}`}
              >
                {row.split(',').map((c, j) => (
                  <span key={j} className="truncate">
                    {c}
                  </span>
                ))}
              </div>
            ),
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {bodyLines(artifact.id, 7).map((w, i) => (
            <div key={i} className={`h-2.5 rounded bg-panel-2 ${w}`} />
          ))}
        </div>
      )}
    </div>
  )
}
