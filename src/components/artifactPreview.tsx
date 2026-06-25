import { useEffect, useRef, useState } from 'react'
import {
  Box,
  Check,
  ChevronDown,
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
import type { ArtifactContent, DocBlock } from '../types'
import { useArtifactContent } from '../api'
import { useFocusTrap } from '../lib/useFocusTrap'

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

/** Where the body is being rendered — drives type scale and how much we show.
 *  `thumb` = the small gallery card preview; `compact` = the workspace side
 *  panel; `full` = the modal viewer. */
type Size = 'thumb' | 'compact' | 'full'

function hashId(seed: string): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return h
}

/** A muted gradient seeded across the hue circle by file name (not artifact id) —
 *  matching the by-name content library, so an image's gradient is stable across
 *  the gallery, the workspace panel, and the composer preview. */
function imageTint(seed: string): string {
  const hue = hashId(seed) % 360
  return `linear-gradient(135deg, hsl(${hue} 38% 74%), hsl(${(hue + 26) % 360} 34% 55%))`
}

/** Turn a file name into a human title for files that have no authored body. */
function titleFromName(name: string): string {
  return name
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/* ───────────────────────────── doc / email ───────────────────────────── */

const DOC = {
  thumb: { title: 'text-[9px]', gap: 'space-y-1', h: 'text-[8px]', p: 'text-[8px]', lead: 'leading-snug' },
  compact: { title: 'text-[13px]', gap: 'space-y-2.5', h: 'text-[11px]', p: 'text-[12px]', lead: 'leading-relaxed' },
  full: { title: 'text-lg', gap: 'space-y-3.5', h: 'text-[13px]', p: 'text-[14px]', lead: 'leading-relaxed' },
} as const

function DocBlockView({ block, size }: { block: DocBlock; size: Size }) {
  const t = DOC[size]
  if ('email' in block) {
    return (
      <div className={`space-y-0.5 rounded-lg bg-panel-2/50 px-3 py-2 text-ink-soft ${t.p}`}>
        <div>
          <span className="text-ink-faint">To:</span> {block.email.to}
        </div>
        <div className="truncate">
          <span className="text-ink-faint">Subject:</span> {block.email.subject}
        </div>
      </div>
    )
  }
  if ('h' in block) {
    return <div className={`${t.h} font-semibold text-ink`}>{block.h}</div>
  }
  if ('p' in block) {
    return <p className={`${t.p} ${t.lead} text-ink-soft ${size === 'thumb' ? 'line-clamp-2' : ''}`}>{block.p}</p>
  }
  if ('ul' in block) {
    const items = size === 'thumb' ? block.ul.slice(0, 2) : block.ul
    return (
      <ul className={`${t.p} ${t.lead} space-y-1 text-ink-soft`}>
        {items.map((li, i) => (
          <li key={i} className="flex gap-1.5">
            <span className="mt-[3px] shrink-0 text-accent">•</span>
            <span className={size === 'thumb' ? 'line-clamp-1' : ''}>{li}</span>
          </li>
        ))}
      </ul>
    )
  }
  // code
  return (
    <div className={`overflow-hidden rounded-md bg-panel-2/60 px-2.5 py-1.5 font-mono text-ink ${t.p}`}>
      {block.code.map((ln, i) => (
        <div key={i} className="truncate">
          {ln}
        </div>
      ))}
    </div>
  )
}

function DocView({ doc, size }: { doc: Extract<ArtifactContent, { type: 'doc' }>; size: Size }) {
  const t = DOC[size]
  const blocks = size === 'thumb' ? doc.blocks.slice(0, 2) : doc.blocks
  return (
    <div className={t.gap}>
      <div className={`${t.title} font-serif font-semibold leading-snug text-ink ${size === 'thumb' ? 'line-clamp-1' : ''}`}>
        {doc.title}
      </div>
      {blocks.map((b, i) => (
        <DocBlockView key={i} block={b} size={size} />
      ))}
    </div>
  )
}

/* ───────────────────────────────── sheet ───────────────────────────────── */

const SHEET = {
  thumb: { text: 'text-[8px]', cell: 'px-1.5 py-[3px]' },
  compact: { text: 'text-[11px]', cell: 'px-2.5 py-1' },
  full: { text: 'text-[12px]', cell: 'px-3 py-1.5' },
} as const

const HEX = /^#[0-9a-f]{6}$/i

function SheetView({ sheet, size }: { sheet: Extract<ArtifactContent, { type: 'sheet' }>; size: Size }) {
  const t = SHEET[size]
  const rows = size === 'thumb' ? sheet.rows.slice(0, 3) : sheet.rows
  return (
    <div className={`overflow-hidden rounded-lg border border-line ${t.text}`}>
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-panel-2">
            {sheet.columns.map((c, i) => (
              <th
                key={i}
                className={`${t.cell} text-left font-semibold text-ink ${i > 0 ? 'border-l border-line text-right' : ''}`}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="border-t border-line">
              {r.map((c, ci) => (
                <td
                  key={ci}
                  className={`${t.cell} ${ci === 0 ? 'text-ink' : 'border-l border-line text-right tabular-nums text-ink-soft'}`}
                >
                  {HEX.test(c) ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm ring-1 ring-line-strong"
                        style={{ background: c }}
                      />
                      <span className="font-mono">{c}</span>
                    </span>
                  ) : (
                    c
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {sheet.note && size !== 'thumb' && (
        <div className="border-t border-line bg-panel/40 px-3 py-1.5 text-[11px] italic text-ink-faint">{sheet.note}</div>
      )}
    </div>
  )
}

/* ───────────────────────────────── slides ──────────────────────────────── */

function SlidesView({ slides, size }: { slides: Extract<ArtifactContent, { type: 'slides' }>['slides']; size: Size }) {
  const shown = size === 'thumb' ? slides.slice(0, 1) : slides
  return (
    <div className={size === 'thumb' ? '' : 'space-y-3'}>
      {shown.map((s, i) => (
        <div
          key={i}
          className={`flex w-full flex-col rounded-lg border border-line bg-surface shadow-sm ${
            size === 'thumb' ? 'h-full p-2.5' : 'aspect-video p-4'
          }`}
        >
          <div
            className={`font-serif font-semibold leading-snug text-ink ${
              size === 'thumb' ? 'text-[9px] line-clamp-1' : size === 'compact' ? 'text-[12px]' : 'text-[15px]'
            }`}
          >
            {s.title}
          </div>
          <ul className={`mt-1.5 space-y-1 text-ink-soft ${size === 'thumb' ? 'text-[8px]' : 'text-[12px]'}`}>
            {(size === 'thumb' ? s.bullets.slice(0, 2) : s.bullets).map((b, j) => (
              <li key={j} className="flex gap-1.5">
                <span className="mt-[2px] shrink-0 text-accent">•</span>
                <span className={size === 'thumb' ? 'line-clamp-1' : ''}>{b}</span>
              </li>
            ))}
          </ul>
          {size !== 'thumb' && (
            <div className="mt-auto pt-2 text-right text-[10px] text-ink-faint">
              {i + 1} / {slides.length}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

/* ───────────────────────────────── figure ──────────────────────────────── */

const FIG_H = { thumb: 'h-full', compact: 'h-32', full: 'h-52' } as const

function FigureView({
  fig,
  name,
  size,
}: {
  fig: Extract<ArtifactContent, { type: 'figure' }>
  name: string
  size: Size
}) {
  const caption = size !== 'thumb' && (
    <p className="mt-2 text-[12px] leading-snug text-ink-faint">{fig.caption}</p>
  )

  if (fig.shape === 'hero') {
    return (
      <div>
        <div
          className={`relative flex w-full items-center justify-center overflow-hidden rounded-lg shadow-inner ${
            size === 'thumb' ? 'h-full' : 'aspect-video'
          }`}
          style={{ background: imageTint(name) }}
        >
          <div
            className={`px-4 text-center font-serif font-semibold text-white drop-shadow-sm ${
              size === 'thumb' ? 'text-[13px]' : size === 'compact' ? 'text-xl' : 'text-3xl'
            }`}
          >
            {fig.headline ?? titleFromName(name)}
          </div>
        </div>
        {caption}
      </div>
    )
  }

  const chartH = FIG_H[size]
  const series = fig.series ?? []
  const dataMax = Math.max(1, ...series, ...(fig.series2 ?? []))
  // Anchor the axis at 0 (and at 100 when the data fits) so bar heights and the
  // line slope are proportional to the actual values — not stretched to fill the
  // min–max window, which would overstate small changes.
  const axisMax = dataMax <= 100 ? 100 : dataMax

  if (fig.shape === 'bars') {
    return (
      <div>
        <div className={`flex items-end gap-2 rounded-lg border border-line bg-surface p-3 ${chartH}`}>
          {series.map((v, i) => (
            <div key={i} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
              <div className="w-full rounded-t bg-accent/80" style={{ height: `${(v / axisMax) * 100}%` }} />
              {size !== 'thumb' && fig.labels?.[i] && (
                <span className="truncate text-[10px] text-ink-faint">{fig.labels[i]}</span>
              )}
            </div>
          ))}
        </div>
        {caption}
      </div>
    )
  }

  if (fig.shape === 'line') {
    const n = series.length
    if (n === 0) return <div>{caption}</div>
    const pts = series
      .map((v, i) => `${n === 1 ? 50 : (i / (n - 1)) * 100},${40 - (v / axisMax) * 36 - 2}`)
      .join(' ')
    return (
      <div>
        <div className={`rounded-lg border border-line bg-surface p-3 ${chartH}`}>
          {/* preserveAspectRatio='none' stretches the viewBox to fill the card, so
              only non-scaling geometry (the stroke) stays undistorted — no circle
              markers, which would render as squashed ellipses. */}
          <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-full w-full text-accent">
            <polyline points={pts} fill="none" stroke="currentColor" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          </svg>
        </div>
        {size !== 'thumb' && fig.labels && (
          <div className="mt-1 flex justify-between text-[10px] text-ink-faint">
            {fig.labels.map((l, i) => (
              <span key={i}>{l}</span>
            ))}
          </div>
        )}
        {caption}
      </div>
    )
  }

  // funnel
  return (
    <div>
      <div className={`space-y-2 rounded-lg border border-line bg-surface p-3 ${size === 'thumb' ? 'overflow-hidden' : ''}`}>
        {fig.legend && size !== 'thumb' && (
          <div className="flex gap-3 text-[11px] text-ink-soft">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm bg-accent/80" />
              {fig.legend[0]}
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm bg-line-strong" />
              {fig.legend[1]}
            </span>
          </div>
        )}
        {(fig.labels ?? []).map((lab, i) => (
          <div key={i}>
            {size !== 'thumb' && <div className="text-[11px] text-ink-soft">{lab}</div>}
            <div className="mt-0.5 space-y-1">
              {i < series.length && (
                <FunnelBar v={series[i]} max={axisMax} tone="bg-accent/80" showLabel={size !== 'thumb'} />
              )}
              {fig.series2 && i < fig.series2.length && (
                <FunnelBar v={fig.series2[i]} max={axisMax} tone="bg-line-strong" showLabel={size !== 'thumb'} />
              )}
            </div>
          </div>
        ))}
      </div>
      {caption}
    </div>
  )
}

function FunnelBar({ v, max, tone, showLabel }: { v: number; max: number; tone: string; showLabel: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-2.5 min-w-[2px] rounded-r-sm" style={{ width: `${(v / max) * 100}%` }}>
        <div className={`h-full w-full rounded-r-sm ${tone}`} />
      </div>
      {showLabel && <span className="shrink-0 text-[10px] tabular-nums text-ink-faint">{v}%</span>}
    </div>
  )
}

/* ─────────────────────────── structured fallback ───────────────────────── */

/** A file with no authored body still reads as a real document: a title from
 *  the file name, its one-line excerpt, and a kind-appropriate scaffold — never
 *  bare skeleton bars with no heading. */
function Scaffold({ kind, name, size, excerpt }: { kind: ArtifactKind; name: string; size: Size; excerpt?: string }) {
  if (kind === 'image') {
    return <FigureView fig={{ type: 'figure', shape: 'hero', caption: excerpt ?? '', headline: titleFromName(name) }} name={name} size={size} />
  }
  if (kind === 'sheet') {
    return (
      <SheetView
        sheet={{
          type: 'sheet',
          columns: ['metric', 'value', 'Δ'],
          rows: [
            ['—', '—', '—'],
            ['—', '—', '—'],
            ['—', '—', '—'],
          ],
        }}
        size={size}
      />
    )
  }
  if (kind === 'slide') {
    return <SlidesView slides={[{ title: titleFromName(name), bullets: excerpt ? [excerpt] : [] }]} size={size} />
  }
  if (kind === 'email') {
    return (
      <DocView
        doc={{
          type: 'doc',
          title: titleFromName(name),
          blocks: [
            { email: { to: 'recipients', subject: titleFromName(name) } },
            ...(excerpt ? [{ p: excerpt } as DocBlock] : []),
          ],
        }}
        size={size}
      />
    )
  }
  const t = DOC[size]
  const widths = ['w-full', 'w-11/12', 'w-5/6', 'w-3/4']
  return (
    <div className={t.gap}>
      <div className={`${t.title} font-serif font-semibold leading-snug text-ink ${size === 'thumb' ? 'line-clamp-1' : ''}`}>
        {titleFromName(name)}
      </div>
      {excerpt && (
        <p className={`${t.p} ${t.lead} text-ink-soft ${size === 'thumb' ? 'line-clamp-2' : ''}`}>{excerpt}</p>
      )}
      <div className="space-y-1.5 pt-0.5">
        {widths.slice(0, size === 'thumb' ? 3 : 4).map((w, i) => (
          <div key={i} className={`h-2 rounded bg-panel-2 ${w}`} />
        ))}
      </div>
    </div>
  )
}

/* ───────────────────────────── shared entry point ──────────────────────── */

/** The real, kind-appropriate body for an artifact — shared by the gallery card
 *  thumbnail, the gallery's full viewer, and the workspace side panel. Looks the
 *  body up by file name; falls back to a structured scaffold for unauthored
 *  files. */
export function ArtifactBodyView({
  kind,
  name,
  size,
  excerpt,
}: {
  kind: ArtifactKind
  name: string
  size: Size
  excerpt?: string
}) {
  const content = useArtifactContent().data?.[name]
  if (content) {
    switch (content.type) {
      case 'doc':
        return <DocView doc={content} size={size} />
      case 'sheet':
        return <SheetView sheet={content} size={size} />
      case 'slides':
        return <SlidesView slides={content.slides} size={size} />
      case 'figure':
        return <FigureView fig={content} name={name} size={size} />
      default: {
        // Exhaustiveness guard: a new ArtifactContent variant becomes a compile error here.
        const _exhaustive: never = content
        return _exhaustive
      }
    }
  }
  return <Scaffold kind={kind} name={name} size={size} excerpt={excerpt} />
}

/** A compact, kind-appropriate thumbnail for an artifact card — a faithful
 *  miniature of the file's real content. */
export function ArtifactThumb({ kind, name, excerpt }: { kind: ArtifactKind; name: string; excerpt?: string }) {
  const content = useArtifactContent().data?.[name]
  const isFigure = (content?.type === 'figure' && content.shape === 'hero') || (!content && kind === 'image')
  // Hero images fill the tile edge-to-edge; everything else sits on "paper".
  if (isFigure) {
    return (
      <div className="h-full w-full">
        <ArtifactBodyView kind={kind} name={name} size="thumb" excerpt={excerpt} />
      </div>
    )
  }
  return (
    <div className="relative h-full w-full overflow-hidden p-2.5">
      <ArtifactBodyView kind={kind} name={name} size="thumb" excerpt={excerpt} />
      {/* fade any clipped bottom line into the tile so the miniature reads as a
          preview rather than truncated text */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-9 bg-gradient-to-t from-panel-2 via-panel-2/85 to-transparent" />
    </div>
  )
}

/* ─────────────────────────────── full viewer ───────────────────────────── */

/** A modal that opens an artifact "in full" from the Artifacts gallery. The header
 *  carries a project picker so the artifact can be (re)assigned to a project — or
 *  unfiled — right here. */
export function ArtifactViewer({
  artifact,
  projects,
  currentProjectId,
  onAssignProject,
  onClose,
}: {
  artifact: ArtifactItem
  projects: { id: string; name: string }[]
  /** The project the artifact is filed under right now ('' = unfiled). */
  currentProjectId: string
  /** Assign to a project, or unfile (null). */
  onAssignProject: (projectId: string | null) => void
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDivElement>(null)

  // Trap Tab within the viewer, close on Escape, restore focus on close (the
  // viewer has no single primary field, so focus lands on the first control).
  useFocusTrap(dialogRef, onClose)

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
        ref={dialogRef}
        onMouseDown={(e) => e.stopPropagation()}
        className="relative flex max-h-[80vh] w-[680px] max-w-full flex-col overflow-hidden rounded-xl bg-surface shadow-2xl ring-1 ring-line-strong"
      >
        <div className="flex shrink-0 items-start gap-3 border-b border-line px-5 py-3.5">
          <Icon size={20} className="mt-0.5 shrink-0 text-cap-workspace" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-semibold text-ink">{artifact.name}</div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-faint">
              <span>{KIND_LABEL[artifact.kind]}</span>
              <span>·</span>
              <ProjectAssignMenu
                projects={projects}
                currentProjectId={currentProjectId}
                onAssign={onAssignProject}
              />
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
          <ArtifactBodyView kind={artifact.kind} name={artifact.name} size="full" excerpt={artifact.excerpt} />
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t border-line bg-panel px-5 py-2.5 text-[12px] text-ink-faint">
          <span className="rounded bg-panel-2 px-2 py-0.5 font-medium text-ink-soft">{artifact.tag}</span>
          <span className="ml-auto truncate">From {artifact.source}</span>
        </div>
      </div>
    </div>
  )
}

/** The header's project control: shows the artifact's current project (or "Unfiled")
 *  and, on click, a menu to assign it to any project or remove it from one. The edit
 *  routes through a refile-artifact relation op, so the gallery re-groups live. */
function ProjectAssignMenu({
  projects,
  currentProjectId,
  onAssign,
}: {
  projects: { id: string; name: string }[]
  currentProjectId: string
  onAssign: (projectId: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const current = projects.find((p) => p.id === currentProjectId)

  return (
    <span ref={ref} className="relative inline-flex">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Assign to a project"
        className="inline-flex items-center gap-1 rounded font-medium text-ink-soft transition hover:text-ink"
      >
        <Box size={11} className="text-ink-faint" />
        {current?.name ?? 'Unfiled'}
        <ChevronDown size={11} className={`transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute left-0 top-full z-40 mt-1 max-h-64 w-56 overflow-y-auto rounded-lg border border-line-strong bg-surface py-1 shadow-xl"
        >
          <ProjectAssignRow
            label="No project"
            active={!current}
            onClick={() => {
              onAssign(null)
              setOpen(false)
            }}
          />
          {projects.map((p) => (
            <ProjectAssignRow
              key={p.id}
              label={p.name}
              active={p.id === currentProjectId}
              onClick={() => {
                onAssign(p.id)
                setOpen(false)
              }}
            />
          ))}
        </div>
      )}
    </span>
  )
}

function ProjectAssignRow({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      role="option"
      aria-selected={active}
      className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[13px] transition hover:bg-panel-2 ${
        active ? 'font-medium text-accent-strong' : 'text-ink'
      }`}
    >
      <span className="truncate">{label}</span>
      {active && <Check size={14} className="shrink-0" />}
    </button>
  )
}
