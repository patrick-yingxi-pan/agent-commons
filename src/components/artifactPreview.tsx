import { Fragment, useRef, useState, type ReactNode } from 'react'
import {
  ArrowUpRight,
  Box,
  Check,
  ChevronDown,
  FileText,
  Image as ImageIcon,
  Mail,
  Pencil,
  Presentation,
  Sheet,
  type LucideIcon,
} from 'lucide-react'
import type { ArtifactKind } from '../types'
import type { ArtifactItem } from '../data/cowork'
import type { ArtifactContent, DocBlock } from '../types'
import type { SocialEntityRef } from '../../contract/index.ts'
import { docBlockText } from '../../contract/index.ts'
import { LocusGutter } from './LocusGutter'
import { usePendingFocus, useFocusFlash, FOCUS_FLASH_CLASS } from '../lib/focusContext'
import { useArtifactContent, useFsText, fsContentUrl, updateArtifactBlock } from '../api'
import { FORM_INPUT_CLASS } from '../lib/formInput'
import { INLINE_ACTION_CLASS } from '../lib/inlineAction'
import { ProposalsPanel } from './ProposalsPanel'
import { artifactMetaIsSpecific } from '../lib/artifactMeta'
import { PhotoThumb } from './PhotoThumb'
import { GrantsPanel } from './GrantsPanel'
import { useDismissable } from '../lib/useDismissable'
import { STANDING_DOOR_CLASS } from '../lib/textDoor'
import { relativeTime } from '../lib/relativeTime'
import { POPOVER_SURFACE } from '../lib/popover'
import { usePopoverShift } from '../lib/usePopoverShift'
import { PAGE_HEADER_CLASS, PAGE_TITLE_CLASS } from '../lib/pageHeader'
import { BackButton } from './BackButton'
import type { NavLocation } from '../lib/nav'

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
 *  panel; `full` = the artifact's canonical main page. */
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

/** The owner's in-place body editing (social S3). Editing text happens WHERE the
 *  text is — the same reasoning that made the turn gutter's composer inline —
 *  so the open block becomes a textarea in the flow rather than opening a form
 *  elsewhere. Absent ⇒ a read-only body, which is every surface except the
 *  owner's own artifact page. */
export interface DocEdit {
  /** The block open for editing, or null when none is. */
  index: number | null
  draft: string
  /** Why the last save failed, if it did. The editor stays OPEN carrying the
   *  draft when this is set — a rewrite is real work, and closing on failure
   *  would discard it silently. */
  error: string | null
  saving: boolean
  onStart: (index: number, current: string) => void
  onDraft: (text: string) => void
  onSave: () => void | Promise<void>
  onCancel: () => void
}

function DocView({
  doc,
  size,
  edit,
  discuss,
}: {
  doc: Extract<ArtifactContent, { type: 'doc' }>
  size: Size
  edit?: DocEdit
  /** The artifact this body belongs to, when the surface can host discussion —
   *  the canonical page, and no other (a thumbnail and a side panel are
   *  previews, not reading surfaces). Present ⇒ each block carries the shared
   *  locus gutter, so a thread can hang on ONE block. */
  discuss?: SocialEntityRef
}) {
  const t = DOC[size]
  const blocks = size === 'thumb' ? doc.blocks.slice(0, 2) : doc.blocks
  return (
    <div className={t.gap}>
      <div className={`${t.title} font-serif font-semibold leading-snug text-ink ${size === 'thumb' ? 'line-clamp-1' : ''}`}>
        {doc.title}
      </div>
      {blocks.map((b, i) => {
        // Only a block that carries ONE editable string is addressable — the
        // contract's own predicate, the same one the server validates a patch
        // with, so the pencil appears exactly where an edit can land.
        const current = docBlockText(b)
        const editable = edit !== undefined && current !== undefined
        // The OPEN editor replaces the block's BODY: there is nothing to point
        // at or discuss while it is a textarea, and a gutter under a form would
        // anchor talk to a block the writer is mid-way through changing. It
        // still keeps its wrapper below, so a door aimed at this block lands.
        if (editable && edit.index === i) {
          const editor = (
            <div className="space-y-1.5">
              <textarea
                aria-label={`Rewrite block ${i + 1}`}
                value={edit.draft}
                onChange={(e) => edit.onDraft(e.target.value)}
                rows={3}
                autoFocus
                className={`${FORM_INPUT_CLASS} w-full resize-y`}
              />
              <div className="flex items-center gap-1.5">
                <button onClick={() => void edit.onSave()} disabled={!edit.draft.trim() || edit.saving} className={INLINE_ACTION_CLASS}>
                  {edit.saving ? 'Saving…' : 'Save'}
                </button>
                <button onClick={edit.onCancel} className={INLINE_ACTION_CLASS}>
                  Cancel
                </button>
                {edit.error && <span className="min-w-0 truncate text-[11px] text-danger">{edit.error}</span>}
              </div>
            </div>
          )
          return discuss ?
              <DiscussableBlock key={i} subject={discuss} index={i} gutter={false}>
                {editor}
              </DiscussableBlock>
            : <Fragment key={i}>{editor}</Fragment>
        }
        const body =
          editable ?
            // Recessive until needed (the SECTION_REVEAL idiom): the pencil costs
            // the reading surface nothing until the pointer is on the block. Its
            // lane is RESERVED with padding rather than overlaid — an absolutely
            // positioned control on top of full-width prose sits on the last word
            // of the first line (UI-2: a control may not cover content).
            <div className="group/block relative pr-7">
              <DocBlockView block={b} size={size} />
              <button
                onClick={() => edit.onStart(i, current)}
                title="Edit this block"
                aria-label={`Edit block ${i + 1}`}
                className="absolute right-0 top-0 flex h-6 w-6 items-center justify-center rounded-md text-ink-faint opacity-0 transition hover:bg-panel-2 hover:text-ink focus-visible:opacity-100 group-hover/block:opacity-100"
              >
                <Pencil size={12} />
              </button>
            </div>
          : <DocBlockView block={b} size={size} />
        // A keyed Fragment, not a wrapper div: every preview surface renders
        // this body too, and an extra node per block would be DOM noise on all
        // of them for the benefit of the one surface that hosts a gutter.
        if (!discuss) return <Fragment key={i}>{body}</Fragment>
        return (
          <DiscussableBlock key={i} subject={discuss} index={i}>
            {body}
          </DiscussableBlock>
        )
      })}
    </div>
  )
}

/** One block of a doc body, made ADDRESSABLE (social S2): it carries the shared
 *  locus gutter, so a thread can hang on this block rather than on the whole
 *  artifact, and it is the element an `artifact-block` anchor lands on.
 *
 *  Every block is discussable, including the ones no `artifact-patch` may
 *  rewrite (a list, a code block, an email header). Patchability asks whether a
 *  one-line before→after diff can honestly express a change; discussability only
 *  asks whether there is something to point at. Different questions — so they
 *  get different predicates rather than one borrowed from the other. */
function DiscussableBlock({
  subject,
  index,
  /** False while this block is OPEN IN THE EDITOR: there is nothing to point at
   *  or discuss mid-rewrite. The wrapper still renders, so a door aimed at this
   *  block still lands on it — losing the anchor along with the gutter would
   *  make the arrival silently do nothing. */
  gutter = true,
  children,
}: {
  subject: SocialEntityRef
  index: number
  gutter?: boolean
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const { pending } = usePendingFocus()
  // Zero-based: `!== undefined`, never truthiness — block 0 is a real block, and
  // the opening paragraph is exactly the one people comment on.
  // The hook returns WHETHER to flash, not a class — the caller styles on it.
  const flash = useFocusFlash(pending?.artifactBlock !== undefined && pending.artifactBlock === index, ref)
  return (
    // The lit cue needs room to read as a highlight of the block rather than of
    // its text, so the wrapper carries the inset only while it is lit.
    <div ref={ref} className={`rounded-md ${flash ? `${FOCUS_FLASH_CLASS} -mx-2 px-2` : ''}`}>
      {children}
      {gutter && <LocusGutter subject={subject} locus={{ kind: 'artifact-block', block: index }} noun="block" />}
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
          className={`flex w-full flex-col rounded-lg border border-line bg-surface ${
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
            className={`px-4 text-center font-serif font-semibold text-on-solid drop-shadow-sm ${
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
 *  thumbnail, the artifact's full page, and the workspace side panel. Looks the
 *  body up by file name; falls back to a structured scaffold for unauthored
 *  files. */
export function ArtifactBodyView({
  kind,
  name,
  size,
  excerpt,
  served,
  artifactId,
  edit,
  discuss,
}: {
  kind: ArtifactKind
  name: string
  size: Size
  excerpt?: string
  /** The artifact's id, when the host has one. Body lookups prefer it over
   *  `name` (see below); absent just means the name path, which is exact for
   *  every artifact whose name is unique to its owner. */
  artifactId?: string
  /** The owner's in-place block editing (social S3). Only a `doc` body takes
   *  one — the other kinds have no single-string addressable unit — so the
   *  other renderers ignore it rather than pretending. */
  edit?: DocEdit
  /** Hang the per-block discussion gutter off this artifact (social S2). Passed
   *  ONLY by the canonical page: a thumbnail and a side panel are previews,
   *  and a preview that sprouted comment affordances would tax every surface an
   *  artifact appears on. Like `edit`, only a `doc` body has the addressable
   *  unit, so the other renderers ignore it. */
  discuss?: SocialEntityRef
  /** When the artifact comes from a served filesystem folder (cloud / runner), its
   *  source + path, so the real file content is fetched + rendered (instead of the
   *  name-keyed authored library). Absent for seeded artifacts and UI-host folders
   *  (which fall back to the library / scaffold). */
  served?: { sourceId: string; path: string }
}) {
  // The ID key wins when the server carried one (an EDITED body): a file name is
  // not a unique handle — one workspace can hold two artifacts of the same name,
  // and the name key would then show one document's revision inside the other.
  const library = useArtifactContent().data
  const lib = (artifactId ? library?.[artifactId] : undefined) ?? library?.[name]
  const isImage = kind === 'image'
  // Real text for a served, non-image artifact (enabled-gated; rules of hooks).
  const servedText = useFsText(served?.sourceId ?? '', served?.path ?? '', !!served && !isImage)
  // Served real content wins over the authored library.
  if (served) {
    if (isImage) return <ServedImage url={fsContentUrl(served.sourceId, served.path)} name={name} size={size} />
    if (servedText.data?.kind === 'text') return <ServedText text={servedText.data.text ?? ''} name={name} size={size} />
    if (servedText.status === 'loading') {
      return <div className="py-6 text-center text-[12px] text-ink-faint">Loading…</div>
    }
    // A served fetch that returned no text (binary / error) falls through to the scaffold.
  }
  if (lib) {
    switch (lib.type) {
      case 'doc':
        return <DocView doc={lib} size={size} edit={edit} discuss={discuss} />
      case 'sheet':
        return <SheetView sheet={lib} size={size} />
      case 'slides':
        return <SlidesView slides={lib.slides} size={size} />
      case 'figure':
        return <FigureView fig={lib} name={name} size={size} />
      default: {
        // Exhaustiveness guard: a new ArtifactContent variant becomes a compile error here.
        const _exhaustive: never = lib
        return _exhaustive
      }
    }
  }
  return <Scaffold kind={kind} name={name} size={size} excerpt={excerpt} />
}

/** Real text from a served file, rendered as a titled document body (the workspace
 *  panel's compact view). CSV / code keep their raw shape via `whitespace-pre-wrap`. */
function ServedText({ text, name, size }: { text: string; name: string; size: Size }) {
  const t = DOC[size]
  return (
    <div className={t.gap}>
      <div className={`${t.title} font-semibold text-ink`}>{titleFromName(name)}</div>
      <pre className={`${t.p} ${t.lead} max-h-[420px] overflow-auto whitespace-pre-wrap font-sans text-ink-soft`}>
        {text}
      </pre>
    </div>
  )
}

/** A served image rendered from its real bytes (the shared photo primitive). */
function ServedImage({ url, name, size }: { url: string; name: string; size: Size }) {
  return (
    <PhotoThumb
      id={name}
      src={url}
      className={`w-full rounded-lg shadow-inner ${size === 'thumb' ? 'h-full' : 'aspect-video'}`}
    />
  )
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

/* ─────────────────────────────── full page ─────────────────────────────── */

/** The artifact's canonical MAIN PAGE. `/artifacts/:id` is a routed pane place,
 *  so its surface uses the same page header, back history and natural page
 *  scroll as every other resource — never a dialog laid over its own gallery.
 *  The header keeps the project picker so the artifact can be (re)assigned or
 *  unfiled without leaving its page. */
export function ArtifactDetailPage({
  artifact,
  projects,
  currentProjectId,
  own,
  onAssignProject,
  onOpenSource,
  onBack,
  backTo,
}: {
  artifact: ArtifactItem
  projects: { id: string; name: string }[]
  /** Whether the reader OWNS this artifact — a grant widens the read, so
   *  "can see it" and "may rewrite it" are different questions (the routine
   *  page's lesson). Gates the body editor and the share roster; a visitor
   *  offers an `artifact-patch` proposal instead. */
  own: boolean
  /** The project the artifact is filed under right now ('' = unfiled). */
  currentProjectId: string
  /** Assign to a project, or unfile (null). The MENU is gated on `own` — the one
   *  ownership signal — so this is just the callback; absent (or not owned) shows
   *  the filing as a plain label. Before, presence-of-callback was a second,
   *  independent way to say "owner", and the two could disagree. */
  onAssignProject?: (projectId: string | null) => void
  /** Open the conversation that produced this artifact. Absent when `source`
   *  doesn't resolve to a known session (a created/sourceless artifact), so the
   *  provenance stays a plain label rather than a dead link. */
  onOpenSource?: () => void
  onBack: () => void
  backTo: NavLocation | null
}) {
  const Icon = KIND_ICON[artifact.kind]

  // The owner's body edit (social S3): which block is open, and its draft. The
  // save goes through the SAME mutator a landed `artifact-patch` runs — the
  // owner simply needs no consent from themselves.
  const [editing, setEditing] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const edit: DocEdit | undefined = own
    ? {
        index: editing,
        draft,
        error: saveError,
        saving,
        onStart: (index, current) => {
          setEditing(index)
          setDraft(current)
          setSaveError(null)
        },
        onDraft: setDraft,
        // Close only once the write has actually landed. Closing first and
        // firing the request into the void lost the rewrite on any refusal and
        // left the rejection unhandled — the offer form next door has always
        // done the opposite.
        onSave: async () => {
          const index = editing
          if (index === null) return
          setSaving(true)
          setSaveError(null)
          try {
            await updateArtifactBlock(artifact.id, index, draft)
            setEditing(null)
          } catch (e) {
            setSaveError(e instanceof Error ? e.message : 'Could not save that edit.')
          } finally {
            setSaving(false)
          }
        },
        onCancel: () => {
          setEditing(null)
          setSaveError(null)
        },
      }
    : undefined

  return (
    <div
      data-artifact-page={artifact.id}
      className="mx-auto w-full max-w-3xl"
    >
      <header className={PAGE_HEADER_CLASS}>
        <div className="flex min-w-0 items-start gap-3">
          <BackButton
            to={backTo ?? { kind: 'section', section: 'artifacts', projectId: null, scheduleId: null }}
            onBack={onBack}
          />
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-panel-2 text-cap-workspace">
            <Icon size={20} className="shrink-0" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className={`${PAGE_TITLE_CLASS} truncate`}>{artifact.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-faint">
              {/* S6 — the canonical page should be at least as specific as the humble
                  side panel: show the artifact's own descriptor (meta — "functional spec",
                  "1600×900") when it beats the generic kind label (the shared guard skips
                  gallery-created artifacts whose meta = the label — no "Document · Document"). */}
              <span>
                {artifactMetaIsSpecific(artifact.meta, KIND_LABEL[artifact.kind]) ? artifact.meta : KIND_LABEL[artifact.kind]}
              </span>
              <span>·</span>
              {own && onAssignProject ? (
                <ProjectAssignMenu
                  projects={projects}
                  currentProjectId={currentProjectId}
                  onAssign={onAssignProject}
                />
              ) : (
                <span>{projects.find((p) => p.id === currentProjectId)?.name ?? 'Unfiled'}</span>
              )}
              <span>·</span>
              <span>Edited {relativeTime(artifact.editedAt)}</span>
            </div>
          </div>
        </div>
      </header>

      <div className="min-w-0">
        <ArtifactBodyView
          kind={artifact.kind}
          name={artifact.name}
          artifactId={artifact.id}
          size="full"
          excerpt={artifact.excerpt}
          edit={edit}
          // The canonical page is the artifact's READING surface, so it is
          // the one place a block carries its own thread (social S2).
          discuss={{ kind: 'artifact', id: artifact.id }}
        />
        {/* Improvements (social S3) — the generic ProposalsPanel, the third
            social primitive on the one canonical surface. An artifact could be
            shared and discussed but never IMPROVED: `artifact-patch` had no
            host, which is the "capability with no surface" failure the layer's
            own audits keep finding. Everyone sees the ledger; the offer form
            is the panel's own propose-tier gate, land/decline the owner's. */}
        <div className="mt-5 border-t border-line pt-4">
          <ProposalsPanel subject={{ kind: 'artifact', id: artifact.id }} own={own} />
        </div>
        {/* Sharing (social S1) — the OWNER's audience configuration, the same
            generic GrantsPanel every other subject hosts. Without it an
            artifact could be granted only through the API: the read now
            widens for an audience that had no way to be created. */}
        {own && (
          <div className="mt-5 border-t border-line pt-4">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-faint">Share this artifact</p>
            <GrantsPanel subject={{ kind: 'artifact', id: artifact.id }} />
          </div>
        )}
        <div className="mt-5 flex items-center gap-2 border-t border-line pt-4 text-[12px] text-ink-faint">
          {onOpenSource ? (
            <button
              onClick={onOpenSource}
              title={`Open ${artifact.source}`}
              className="group inline-flex max-w-full items-center gap-1 truncate transition hover:text-ink"
            >
              From{' '}
              <span className={`truncate font-medium text-ink-soft ${STANDING_DOOR_CLASS} group-hover:text-ink`}>
                {artifact.source}
              </span>
              <ArrowUpRight size={12} className="shrink-0 opacity-60 transition group-hover:opacity-100" />
            </button>
          ) : (
            <span className="truncate">From {artifact.source}</span>
          )}
        </div>
      </div>
    </div>
  )
}

/** The page header's project control: shows the artifact's current project (or "Unfiled")
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
  const ref = useDismissable<HTMLSpanElement>(open, () => setOpen(false))
  const popRef = usePopoverShift<HTMLDivElement>(open)

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
          ref={popRef}
          role="listbox"
          className={`absolute left-0 top-full z-40 mt-1 max-h-64 w-56 overflow-y-auto py-1 ${POPOVER_SURFACE}`}
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
