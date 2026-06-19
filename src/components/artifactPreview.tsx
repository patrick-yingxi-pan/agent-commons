import { useEffect } from 'react'
import {
  FileText,
  Image as ImageIcon,
  Mail,
  Presentation,
  Sheet,
  X,
  type LucideIcon,
} from 'lucide-react'
import type { ArtifactKind } from '../types'
import type { ArtifactItem } from '../data/cowork'

export const KIND_ICON: Record<ArtifactKind, LucideIcon> = {
  doc: FileText,
  email: Mail,
  image: ImageIcon,
  slide: Presentation,
  sheet: Sheet,
}

export const KIND_LABEL: Record<ArtifactKind, string> = {
  doc: 'Document',
  email: 'Draft email',
  image: 'Image',
  slide: 'Slides',
  sheet: 'Sheet',
}

function hashId(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return h
}

const LINE_WIDTHS = ['w-full', 'w-11/12', 'w-5/6', 'w-4/5', 'w-3/4', 'w-2/3', 'w-1/2']
/** Deterministic skeleton-line widths seeded by id, so two same-kind artifacts
 *  never render an identical body. */
function bodyLines(id: string, n: number): string[] {
  const h = hashId(id)
  return Array.from({ length: n }, (_, i) => LINE_WIDTHS[(h + i * 3) % LINE_WIDTHS.length])
}

/** A muted gradient seeded across the hue circle by id, so two image artifacts
 *  get visibly different previews. */
function imageTint(id: string): string {
  const hue = hashId(id) % 360
  return `linear-gradient(135deg, hsl(${hue} 38% 74%), hsl(${(hue + 26) % 360} 34% 55%))`
}

const SHEET_ROWS = [
  ['cohort', 'users', 'churn'],
  ['Annual · May', '1,204', '2.1%'],
  ['Annual · Jun', '1,190', '4.8%'],
  ['Monthly · Jun', '3,902', '3.0%'],
  ['Trial · Jun', '2,180', '6.4%'],
]

/** A compact, kind-appropriate thumbnail for an artifact card. Purely decorative
 *  — a faux render so the gallery reads like the real Artifacts gallery. */
export function ArtifactThumb({ kind, id, name }: { kind: ArtifactKind; id: string; name: string }) {
  if (kind === 'image') {
    return (
      <div
        className="flex h-full w-full items-end p-2.5"
        style={{ background: imageTint(id) }}
      >
        <span className="truncate text-[10px] font-medium text-white/85">{name}</span>
      </div>
    )
  }

  if (kind === 'sheet') {
    return (
      <div className="h-full w-full p-3">
        <div className="overflow-hidden rounded border border-line bg-surface">
          {SHEET_ROWS.slice(0, 5).map((row, r) => (
            <div key={r} className={`grid grid-cols-3 ${r > 0 ? 'border-t border-line' : ''}`}>
              {row.map((_, c) => (
                <div
                  key={c}
                  className={`px-1.5 py-[3px] ${c > 0 ? 'border-l border-line' : ''} ${
                    r === 0 ? 'bg-panel-2' : ''
                  }`}
                >
                  <div
                    className={`h-1 rounded-sm ${r === 0 ? 'bg-ink-faint/60' : 'bg-line-strong/60'}`}
                    style={{ width: `${45 + ((hashId(id) + r * 5 + c * 3) % 45)}%` }}
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (kind === 'slide') {
    return (
      <div className="flex h-full w-full items-center justify-center p-3">
        <div className="aspect-video w-full rounded border border-line bg-surface p-2.5 shadow-sm">
          <div className="h-1.5 w-1/2 rounded-sm bg-ink-faint/50" />
          <div className="mt-2 space-y-1.5">
            {bodyLines(id, 3).map((w, i) => (
              <div key={i} className={`h-1 rounded-sm bg-line-strong/60 ${w}`} />
            ))}
          </div>
        </div>
      </div>
    )
  }

  // doc / email — a sheet of "paper" with text lines.
  return (
    <div className="h-full w-full p-3">
      <div className="h-full overflow-hidden rounded border border-line bg-surface p-2.5 shadow-sm">
        {kind === 'email' && <div className="mb-2 h-1 w-1/3 rounded-sm bg-ink-faint/50" />}
        <div className="space-y-1.5">
          {bodyLines(id, 6).map((w, i) => (
            <div key={i} className={`h-1 rounded-sm bg-line-strong/50 ${w}`} />
          ))}
        </div>
      </div>
    </div>
  )
}

/** The fuller body shown inside the artifact detail viewer. */
function ArtifactBody({ artifact }: { artifact: ArtifactItem }) {
  const { kind, id, name, excerpt } = artifact

  if (kind === 'image') {
    return (
      <div
        className="flex aspect-video w-full items-center justify-center rounded-lg text-sm font-medium text-white/90 shadow-inner"
        style={{ background: imageTint(id) }}
      >
        {name}
      </div>
    )
  }

  if (kind === 'sheet') {
    return (
      <div className="overflow-hidden rounded-lg border border-line text-[12px]">
        {SHEET_ROWS.map((row, i) => (
          <div
            key={i}
            className={`grid grid-cols-3 gap-2 px-3 py-1.5 ${
              i === 0 ? 'bg-panel-2 font-semibold text-ink' : 'text-ink-soft'
            } ${i > 0 ? 'border-t border-line' : ''}`}
          >
            {row.map((c, j) => (
              <span key={j} className="truncate">
                {c}
              </span>
            ))}
          </div>
        ))}
      </div>
    )
  }

  if (kind === 'slide') {
    return (
      <div className="space-y-3">
        {[0, 1].map((s) => (
          <div key={s} className="aspect-video w-full rounded-lg border border-line bg-surface p-5 shadow-sm">
            <div className="h-3 w-2/5 rounded bg-ink-faint/40" />
            <div className="mt-4 space-y-2.5">
              {bodyLines(`${id}-${s}`, 4).map((w, i) => (
                <div key={i} className={`h-2 rounded bg-panel-2 ${w}`} />
              ))}
            </div>
          </div>
        ))}
      </div>
    )
  }

  // doc / email
  return (
    <div>
      {kind === 'email' && (
        <div className="mb-4 space-y-1 rounded-lg bg-panel/60 px-3 py-2 text-[12px] text-ink-soft">
          <div>
            <span className="font-medium text-ink-faint">To:</span> {artifact.meta.replace(/^to:\s*/i, '')}
          </div>
          <div>
            <span className="font-medium text-ink-faint">Subject:</span>{' '}
            {artifact.source}
          </div>
        </div>
      )}
      {excerpt && <p className="mb-4 text-[15px] leading-relaxed text-ink">{excerpt}</p>}
      <div className="space-y-2.5">
        {bodyLines(id, 12).map((w, i) => (
          <div key={i} className={`h-2.5 rounded bg-panel-2 ${w}`} />
        ))}
      </div>
    </div>
  )
}

/** A modal that opens an artifact "in full" from the Artifacts gallery. */
export function ArtifactViewer({
  artifact,
  projectName,
  onClose,
}: {
  artifact: ArtifactItem
  projectName: string
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const Icon = KIND_ICON[artifact.kind]

  return (
    <div
      className="fixed inset-0 z-50 flex justify-center px-4 pt-[8vh]"
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={artifact.name}
    >
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[1px]" />
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="relative flex max-h-[80vh] w-[680px] max-w-full flex-col overflow-hidden rounded-xl bg-surface shadow-2xl ring-1 ring-line-strong"
      >
        <div className="flex shrink-0 items-start gap-3 border-b border-line px-5 py-3.5">
          <Icon size={20} className="mt-0.5 shrink-0 text-cap-workspace" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-semibold text-ink">{artifact.name}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-ink-faint">
              <span>{KIND_LABEL[artifact.kind]}</span>
              <span>·</span>
              <span>{projectName}</span>
              <span>·</span>
              <span>Edited {artifact.edited}</span>
            </div>
          </div>
          <button
            onClick={onClose}
            title="Close"
            aria-label="Close"
            className="-mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-faint transition hover:bg-panel-2 hover:text-ink"
          >
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <ArtifactBody artifact={artifact} />
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t border-line bg-panel px-5 py-2.5 text-[12px] text-ink-faint">
          <span className="rounded bg-panel-2 px-2 py-0.5 font-medium text-ink-soft">{artifact.tag}</span>
          <span className="ml-auto truncate">From {artifact.source}</span>
        </div>
      </div>
    </div>
  )
}
