import { useEffect, useMemo, useState } from 'react'
import { FileText, Image as ImageIcon, Mail, Sheet, Presentation } from 'lucide-react'
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

  // Keep the selection valid as the workspace fills in during the demo.
  useEffect(() => {
    if (!artifacts.some((a) => a.id === selectedId)) {
      setSelectedId(artifacts[0]?.id)
    }
  }, [artifacts, selectedId])

  const selected = artifacts.find((a) => a.id === selectedId) ?? artifacts[0]

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
  const grouped = groups.length > 1

  const renderRow = (a: Artifact) => {
    const Icon = KIND_ICON[a.kind]
    const active = a.id === selected?.id
    return (
      <button
        key={a.id}
        onClick={() => setSelectedId(a.id)}
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
          {grouped ? ` · ${groups.length} folders` : ' in workspace'}
        </div>
      </div>

      <div className="shrink-0 overflow-y-auto px-2 py-2" style={{ maxHeight: '46%' }}>
        {grouped
          ? groups.map((g) => (
              <div key={g.id} className="mb-1.5">
                <div className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
                  {g.label}
                </div>
                {g.items.map(renderRow)}
              </div>
            ))
          : artifacts.map(renderRow)}
      </div>

      {selected && (
        <div className="flex-1 overflow-y-auto border-t border-line bg-surface p-3">
          <ArtifactPreview artifact={selected} />
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

function ArtifactPreview({ artifact }: { artifact: Artifact }) {
  return (
    <div>
      <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
        {KIND_LABEL[artifact.kind]}
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
