import { Component, Fragment, lazy, Suspense, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import {
  ArrowUpRight,
  Box,
  Check,
  ChevronDown,
  Download,
  FileText,
  Image as ImageIcon,
  Mail,
  Pencil,
  Plus,
  Presentation,
  Sheet,
  Trash2,
  RotateCcw,
  X,
  type LucideIcon,
} from 'lucide-react'
import type { ArtifactKind } from '../types'
import type { ArtifactItem } from '../data/cowork'
import type { ArtifactContent, DocBlock } from '../types'
import type { ArtifactHistoryBody } from '../../contract/artifactHistory.ts'
import type { EditableArtifactBody } from '../../contract/artifactEditing.ts'
import type { SocialEntityRef } from '../../contract/index.ts'
import { docBlockText } from '../../contract/index.ts'
import { LocusGutter } from './LocusGutter'
import { usePendingFocus, useFocusFlash, FOCUS_FLASH_CLASS } from '../lib/focusContext'
import { describeLocus } from '../lib/anchorLocus'
import { useArtifactContent, useFsText, fsContentUrl, useMe } from '../api'
import { artifactEditDrafts, useArtifactEditDraft } from '../controller/artifactEditDrafts'
import { FORM_INPUT_CLASS } from '../lib/formInput'
import { INLINE_ACTION_CLASS } from '../lib/inlineAction'
import { ProposalsPanel, type MainPageSectionComponent } from './ProposalsPanel'
import { artifactMetaIsSpecific } from '../lib/artifactMeta'
import { PhotoThumb } from './PhotoThumb'
import { GrantsPanel } from './GrantsPanel'
import { useDismissable } from '../lib/useDismissable'
import { STANDING_DOOR_CLASS } from '../lib/textDoor'
import { relativeTime } from '../lib/relativeTime'
import { POPOVER_SURFACE } from '../lib/popover'
import { usePopoverShift } from '../lib/usePopoverShift'
import { PAGE_HEADER_CLASS, PAGE_TITLE_CLASS } from '../lib/pageHeader'
import { identityTitleProps } from '../lib/identityTitle'
import { WRAPPING_PROSE_CLASS } from '../lib/prose'
import { shouldReadCurrentArtifactBody } from '../lib/artifactBodyRead.ts'
import type { ArtifactSearchTarget } from '../../contract/artifactSearch.ts'
import { ArtifactSearchReveal, useArtifactSearchFields } from './ArtifactSearchReveal.tsx'
import { BackButton } from './BackButton'
import type { NavLocation } from '../lib/nav'
import { SectionAction } from './SectionAction'
import { SHARING_MUTATION_WAIT, isGrantMutationHeld, useGrantMutationStatus } from '../controller/grantMutations.ts'
import { enqueueArtifactLifecycle, heldArtifactLifecycle, useArtifactLifecycleStatus } from '../controller/artifactLifecycleMutations'
import { ConfirmDialog } from './ConfirmDialog'
import { SECONDARY_BUTTON_CLASS } from '../lib/button'
import { useArtifactDownload } from '../controller/useArtifactDownload.ts'
import {
  enqueueArtifactMetadataMutation,
  isArtifactMetadataMutationHeld,
  useArtifactMetadataMutationStatus,
} from '../controller/artifactMetadataMutations.ts'
import { InlineOperationStatus } from './InlineOperationStatus'
import { normalizeArtifactName } from '../../contract/index.ts'
import { HOVER_CUE } from '../lib/hoverReveal'
import { StructuredArtifactView } from './DeferredStructuredArtifactView'
import { StructuredArtifactEditor } from './DeferredStructuredArtifactEditor'
import {
  isStructuredArtifactMutationHeld,
  useStructuredArtifactMutationStatus,
} from '../controller/structuredArtifactMutations'
import { useArtifactHistoryRestoreHeld, useArtifactPermanentDeletionHeld } from '../controller/artifactBodyOperationHolds.ts'

const DeferredArtifactHistorySection = lazy(() => import('./ArtifactHistorySection'))
const DeferredArtifactPermanentDeletionSection = lazy(() => import('./DeferredArtifactPermanentDeletionSection'))

class ArtifactHistorySectionBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (this.state.failed) return <InlineOperationStatus tone="alert" message="Couldn’t display history. Check recovery and copy unsent text before reloading." action={{ label: 'Reload app', onClick: () => window.location.reload() }} />
    return <Suspense fallback={<p role="status">Loading history…</p>}>{this.props.children}</Suspense>
  }
}

class ArtifactPermanentDeletionSectionBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (this.state.failed) return <InlineOperationStatus tone="alert" message="Couldn’t load permanent deletion recovery. Nothing was deleted; reload the app to retry." action={{ label: 'Reload app', onClick: () => window.location.reload() }} />
    return <Suspense fallback={<p role="status">Loading deletion controls…</p>}>{this.props.children}</Suspense>
  }
}

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
 *  `thumb` = an explicit miniature embed (never the Artifacts index; UI-31);
 *  `compact` = the workspace side panel; `full` = the artifact's canonical
 *  main page. */
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

function DocBlockView({ block, size, index = 0 }: { block: DocBlock; size: Size; index?: number }) {
  const t = DOC[size]
  const search = useArtifactSearchFields()
  const field = `doc.block.${index}`
  if ('email' in block) {
    return (
      <div className={`space-y-0.5 rounded-lg bg-panel-2/50 px-3 py-2 text-ink-soft ${t.p}`}>
        <div {...search.props(`${field}.email.to`)}>
          <span className="text-ink-faint">To:</span> {block.email.to}
        </div>
        <div {...search.props(`${field}.email.subject`)} className={size === 'thumb' ? 'truncate' : 'whitespace-pre-wrap break-words [overflow-wrap:anywhere]'}>
          <span className="text-ink-faint">Subject:</span> {block.email.subject}
        </div>
      </div>
    )
  }
  if ('h' in block) {
    return <div {...search.props(`${field}.h`)} className={`${t.h} font-semibold text-ink`}>{block.h}</div>
  }
  if ('p' in block) {
    return <p {...search.props(`${field}.p`)} className={`${t.p} ${t.lead} text-ink-soft ${size === 'thumb' ? 'line-clamp-2' : ''}`}>{block.p}</p>
  }
  if ('ul' in block) {
    const items = size === 'thumb' ? block.ul.slice(0, 2) : block.ul
    return (
      <ul className={`${t.p} ${t.lead} space-y-1 text-ink-soft`}>
        {items.map((li, i) => (
          <li key={i} className="flex gap-1.5">
            <span className="mt-[3px] shrink-0 text-accent">•</span>
            <span {...search.props(`${field}.ul.${i}`)} className={size === 'thumb' ? 'line-clamp-1' : ''}>{li}</span>
          </li>
        ))}
      </ul>
    )
  }
  // code
  return (
    <div className={`overflow-hidden rounded-md bg-panel-2/60 px-2.5 py-1.5 font-mono text-ink ${t.p}`}>
      {block.code.map((ln, i) => (
        <div key={i} {...search.props(`${field}.code.${i}`)} className={size === 'thumb' ? 'truncate' : 'whitespace-pre-wrap break-words [overflow-wrap:anywhere]'}>
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

function DocumentBlockEditor({ edit, unavailable = false }: { edit: DocEdit; unavailable?: boolean }) {
  return (
    <div className="space-y-1.5" data-document-block-editor>
      <textarea
        aria-label={edit.index !== null && edit.index < 0 ? 'Rewrite original block' : `Rewrite block ${(edit.index ?? 0) + 1}`}
        value={edit.draft}
        onChange={(e) => edit.onDraft(e.target.value)}
        disabled={edit.saving}
        rows={3}
        autoFocus
        className={`${FORM_INPUT_CLASS} w-full resize-y`}
      />
      <div className="flex items-center gap-1.5">
        <button onClick={() => void edit.onSave()} disabled={unavailable || !edit.draft.trim() || edit.saving} className={INLINE_ACTION_CLASS}>
          {edit.saving ? 'Saving…' : 'Save'}
        </button>
        <button onClick={edit.onCancel} disabled={edit.saving} className={INLINE_ACTION_CLASS}>Cancel</button>
      </div>
      {unavailable && <p className="text-[11px] text-ink-soft" role="status">The original block is no longer available for editing. Copy your draft, then cancel to review the latest saved content.</p>}
      {edit.error && <p className="text-[11px] text-danger-text" role="status">{edit.error}</p>}
    </div>
  )
}

function DocumentBlockArrival({ doc }: { doc: Extract<ArtifactContent, { type: 'doc' }> }) {
  const { pending, consume } = usePendingFocus()
  const [missingId, setMissingId] = useState<string | null>(null)
  const id = pending?.artifactBlockId
  const missing = id !== undefined && !doc.blocks.some(block => block.id === id)
  useEffect(() => {
    if (!missing || id === undefined) return
    setMissingId(id)
    consume()
  }, [missing, id, consume])
  if (!missingId || doc.blocks.some(block => block.id === missingId)) return null
  return <p role="status" data-artifact-block-unavailable className="text-[12px] text-ink-soft">
    {describeLocus({ kind: 'artifact-block', blockId: missingId }, 'deleted')}. The discussion remains attached to its original block.
  </p>
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
  const search = useArtifactSearchFields()
  return (
    <div data-wrapping-prose className={`${t.gap} ${WRAPPING_PROSE_CLASS}`}>
      {discuss && <DocumentBlockArrival key={discuss.id} doc={doc} />}
      <div {...search.props('doc.title')} className={`${t.title} font-serif font-semibold leading-snug text-ink ${size === 'thumb' ? 'line-clamp-1' : ''}`}>
        {doc.title}
      </div>
      {blocks.map((b, i) => {
        // Only a block that carries ONE editable string is addressable — the
        // contract's own predicate, the same one the server validates a patch
        // with, so the pencil appears exactly where an edit can land.
        const current = docBlockText(b)
        const editable = edit !== undefined && current !== undefined && b.id !== undefined
        // The OPEN editor replaces the block's BODY: there is nothing to point
        // at or discuss while it is a textarea, and a gutter under a form would
        // anchor talk to a block the writer is mid-way through changing. It
        // still keeps its wrapper below, so a door aimed at this block lands.
        if (editable && edit.index === i) {
          const editor = <DocumentBlockEditor edit={edit} />
          return discuss ?
              <DiscussableBlock key={b.id ?? i} subject={discuss} blockId={b.id} gutter={false}>
                {editor}
              </DiscussableBlock>
            : <Fragment key={b.id ?? i}>{editor}</Fragment>
        }
        const body =
          editable ?
            // Recessive until needed (the SECTION_REVEAL idiom): the pencil costs
            // the reading surface nothing until the pointer is on the block. Its
            // lane is RESERVED with padding rather than overlaid — an absolutely
            // positioned control on top of full-width prose sits on the last word
            // of the first line (UI-2: a control may not cover content).
            <div className="group/block relative pr-7">
              <DocBlockView block={b} size={size} index={i} />
              <button
                onClick={() => edit.onStart(i, current)}
                title={edit.index !== null ? 'Save or cancel your current block edit first' : 'Edit this block'}
                aria-label={`Edit block ${i + 1}`}
                disabled={edit.index !== null}
                className="absolute right-0 top-0 flex h-6 w-6 items-center justify-center rounded-md text-ink-faint opacity-0 transition hover:bg-panel-2 hover:text-ink focus-visible:opacity-100 group-hover/block:opacity-100 disabled:cursor-not-allowed"
              >
                <Pencil size={12} />
              </button>
            </div>
          : <DocBlockView block={b} size={size} index={i} />
        // A keyed Fragment, not a wrapper div: every preview surface renders
        // this body too, and an extra node per block would be DOM noise on all
        // of them for the benefit of the one surface that hosts a gutter.
        if (!discuss) return <Fragment key={b.id ?? i}>{body}</Fragment>
        return (
          <DiscussableBlock key={b.id ?? i} subject={discuss} blockId={b.id}>
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
  blockId,
  /** False while this block is OPEN IN THE EDITOR: there is nothing to point at
   *  or discuss mid-rewrite. The wrapper still renders, so a door aimed at this
   *  block still lands on it — losing the anchor along with the gutter would
   *  make the arrival silently do nothing. */
  gutter = true,
  children,
}: {
  subject: SocialEntityRef
  blockId?: string
  gutter?: boolean
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const { pending } = usePendingFocus()
  const flash = useFocusFlash(blockId !== undefined && pending?.artifactBlockId === blockId, ref)
  return (
    // The lit cue needs room to read as a highlight of the block rather than of
    // its text, so the wrapper carries the inset only while it is lit.
    <div ref={ref} data-doc-block-id={blockId} className={`rounded-md ${flash ? `${FOCUS_FLASH_CLASS} -mx-2 px-2` : ''}`}>
      {children}
      {gutter && blockId && <LocusGutter subject={subject} locus={{ kind: 'artifact-block', blockId }} noun="block" />}
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
      <StructuredArtifactView
        body={{
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
    return <StructuredArtifactView body={{ type: 'slides', slides: [{ title: titleFromName(name), bullets: excerpt ? [excerpt] : [] }] }} size={size} />
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

/** The real, kind-appropriate body for an artifact — shared by the artifact's
 *  full page, the workspace side panel, and explicit miniature embeds. The
 *  Artifacts index deliberately uses a synopsis row instead: an index previews
 *  content without redrawing five different reading surfaces. Looks the body up
 *  by exact identity; name-only fixture previews retain their scaffold. */
export function ArtifactBodyView({
  kind,
  name,
  size,
  excerpt,
  served,
  artifactId,
  bodyOverride,
  bodyOverrideRevision,
  searchTarget,
  edit,
  discuss,
}: {
  kind: ArtifactKind
  name: string
  size: Size
  excerpt?: string
  /** An addressed artifact never borrows another file's body by display name. */
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
  /** Immutable history preview. Overrides the live cache without writing into it. */
  bodyOverride?: ArtifactHistoryBody
  bodyOverrideRevision?: number
  searchTarget?: ArtifactSearchTarget
}) {
  const content = useArtifactContent(shouldReadCurrentArtifactBody({ hasBodyOverride: bodyOverride !== undefined }))
  const library = content.data
  const lib = artifactId ? library?.[artifactId] : library?.[name]
  const isImage = kind === 'image'
  // Real text for a served, non-image artifact (enabled-gated; rules of hooks).
  const servedText = useFsText(served?.sourceId ?? '', served?.path ?? '', !!served && !isImage)
  const reveal = (body: ArtifactContent, revision: number, rendered: ReactNode) => searchTarget
    ? <ArtifactSearchReveal body={body} revision={revision} target={searchTarget} retained={bodyOverride !== undefined}>{rendered}</ArtifactSearchReveal>
    : rendered
  if (bodyOverride) {
    return reveal(bodyOverride, bodyOverrideRevision ?? -1, bodyOverride.type === 'doc'
      ? <DocView doc={bodyOverride} size={size} />
      : <StructuredArtifactView body={bodyOverride} size={size} />)
  }
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
        return reveal(lib, lib.revision ?? 0, <DocView doc={lib} size={size} edit={edit} discuss={discuss} />)
      case 'sheet':
      case 'workbook':
        return reveal(lib, lib.revision ?? 0, <StructuredArtifactView body={lib} size={size} />)
      case 'slides':
        return reveal(lib, lib.revision ?? 0, <StructuredArtifactView body={lib} size={size} />)
      case 'figure':
        return <FigureView fig={lib} name={name} size={size} />
      default: {
        // Exhaustiveness guard: a new ArtifactContent variant becomes a compile error here.
        const _exhaustive: never = lib
        return _exhaustive
      }
    }
  }
  if (artifactId && !served && (kind === 'doc' || kind === 'email')) {
    return <p className="text-[13px] text-ink-faint">{!library
      ? (content.status === 'error' ? 'Could not load document content.' : 'Loading document content…')
      : 'No saved document content yet.'}</p>
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

/** A compact, kind-appropriate thumbnail for an explicit embed — a faithful
 *  miniature of the file's real content. It is deliberately not the canonical
 *  Artifacts index preview (UI-31). */
export function ArtifactThumb({ kind, name, excerpt }: { kind: ArtifactKind; name: string; excerpt?: string }) {
  const content = useArtifactContent(shouldReadCurrentArtifactBody()).data?.[name]
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
  addressedRevision,
  searchTarget,
  onViewCurrent,
  inTrash = false,
  filingHeld = false,
  projects,
  currentProjectId,
  own,
  onAssignProject,
  onOpenSource,
  onBack,
  onDeleted,
  backTo,
  Section,
}: {
  artifact: ArtifactItem
  addressedRevision?: number
  searchTarget?: ArtifactSearchTarget
  onViewCurrent?: () => void
  inTrash?: boolean
  filingHeld?: boolean
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
  onDeleted?: () => void
  backTo: NavLocation | null
  /** The same FoldSection every other main page uses. Injected by SectionView
   * so this body module stays reusable without importing its parent. */
  Section: MainPageSectionComponent
}) {
  const Icon = KIND_ICON[artifact.kind]
  const metadataMutation = useArtifactMetadataMutationStatus()
  const identity = useMe().data
  const sourceUserId = identity?.via === 'session' ? identity.user.id : null
  const metadataBusy = isArtifactMetadataMutationHeld(artifact.id) ||
    (metadataMutation.busy && metadataMutation.activeResourceId === artifact.id)
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState(artifact.name)
  const [nameBaseRevision, setNameBaseRevision] = useState(artifact.metadataRevision ?? 0)
  const nameHintId = useId()
  const currentArtifactId = useRef(artifact.id)
  currentArtifactId.current = artifact.id
  useEffect(() => { setEditingName(false) }, [artifact.id])
  const normalizedName = normalizeArtifactName(nameDraft)
  const invalidName = !normalizedName

  const draftState = useArtifactEditDraft(artifact.id)
  const { pending: pendingFocus } = usePendingFocus()
  const documentDraft = own && draftState?.draft.kind === 'document' ? draftState.draft : undefined
  const structuredDraft = own && draftState?.draft.kind === 'structured' ? draftState.draft : undefined
  const saving = draftState?.held ?? false
  const editingStructured = structuredDraft !== undefined
  useArtifactLifecycleStatus()
  const lifecycleHeld = Boolean(heldArtifactLifecycle(artifact.id))
  const historyRestoreHeld = useArtifactHistoryRestoreHeld(artifact.id)
  const permanentDeletionHeld = useArtifactPermanentDeletionHeld(artifact.id)
  const artifactContent = useArtifactContent(shouldReadCurrentArtifactBody({ addressedRevision, inTrash, lifecycleHeld }))
  const structuredMutation = useStructuredArtifactMutationStatus()
  const structuredBody = artifactContent.data?.[artifact.id]
  const editing = documentDraft ? documentDraft.blockId && structuredBody?.type === 'doc'
    ? structuredBody.blocks.findIndex(block => block.id === documentDraft.blockId)
    : documentDraft.block : null
  const draftBlock = structuredBody?.type === 'doc' && editing !== null ? structuredBody.blocks[editing] : undefined
  const documentTargetUnavailable = Boolean(documentDraft && (!draftBlock || docBlockText(draftBlock) === undefined))
  const editableStructuredBody: (EditableArtifactBody & { revision?: number }) | undefined =
    structuredBody?.type === 'sheet' || structuredBody?.type === 'workbook' || structuredBody?.type === 'slides' ? structuredBody :
      structuredBody?.type === 'doc' && structuredBody.blocks.every(block => typeof block.id === 'string')
        ? structuredBody as EditableArtifactBody & { revision?: number } : undefined
  const structuredBusy = saving || isStructuredArtifactMutationHeld(artifact.id) ||
    (structuredMutation.busy && structuredMutation.activeResourceId === artifact.id)
  const [sharing, setSharing] = useState(false)
  const [sharingHeld, setSharingHeld] = useState(false)
  useGrantMutationStatus()
  const [trashReview, setTrashReview] = useState<{ artifact: ArtifactItem; sourceUserId: string | null } | null>(null)
  const trashBlocked = !identity || editingName || metadataBusy || draftState !== undefined || structuredBusy || historyRestoreHeld || sharingHeld || isGrantMutationHeld({ kind: 'artifact', id: artifact.id }) || filingHeld
  const downloadFormat = artifact.kind === 'sheet' ? 'xlsx' : artifact.kind === 'slide' ? 'pptx' : artifact.kind === 'doc' || artifact.kind === 'email' ? 'markdown' : null
  // One artifact-scoped operation owns both document downloads. This keeps
  // Markdown and Word mutually exclusive and gives account/artifact changes a
  // single abort fence.
  const artifactDownload = useArtifactDownload(artifact.id, downloadFormat ?? 'markdown')
  const edit: DocEdit | undefined = own && !historyRestoreHeld
    ? {
        index: editing,
        draft: documentDraft?.text ?? '',
        error: draftState?.error ?? null,
        saving,
        onStart: (index, current) => {
          const block = structuredBody?.type === 'doc' ? structuredBody.blocks[index] : undefined
          if (!block?.id || structuredBody?.type !== 'doc') return
          artifactEditDrafts.start(artifact.id, { kind: 'document', block: index, blockId: block.id,
            expectedRevision: structuredBody.revision ?? 0, text: current })
        },
        onDraft: (text) => {
          if (documentDraft) artifactEditDrafts.update(artifact.id, { ...documentDraft, text })
        },
        onSave: () => { void artifactEditDrafts.save(artifact.id) },
        onCancel: () => artifactEditDrafts.cancel(artifact.id),
      }
    : undefined

  const cancelName = () => {
    if (metadataBusy) return
    setNameDraft(artifact.name)
    setEditingName(false)
  }
  const saveName = async () => {
    if (metadataBusy || isArtifactMetadataMutationHeld(artifact.id)) return
    const next = normalizeArtifactName(nameDraft)
    if (!next || next === artifact.name) return
    const outcome = await enqueueArtifactMetadataMutation(
      artifact.id,
      { name: next },
      nameBaseRevision,
    )
    if (outcome === 'applied' && currentArtifactId.current === artifact.id) setEditingName(false)
  }
  const startStructuredEdit = () => {
    if (!own || !editableStructuredBody || draftState || structuredBusy || historyRestoreHeld) return
    const { revision = 0, ...content } = editableStructuredBody
    artifactEditDrafts.start(artifact.id, { kind: 'structured', content, expectedRevision: revision })
  }
  const historySection = own && artifact.kind !== 'image' && !permanentDeletionHeld && <ArtifactHistorySectionBoundary key={artifact.id}>
    <DeferredArtifactHistorySection Section={Section} artifact={artifact} sourceUserId={sourceUserId}
      addressedRevision={addressedRevision}
      searchTarget={addressedRevision === undefined ? undefined : searchTarget}
      allowRestore={!inTrash && !lifecycleHeld} restoreBlocked={draftState !== undefined || structuredBusy} />
  </ArtifactHistorySectionBoundary>

  if (addressedRevision !== undefined) return <div data-artifact-page={artifact.id} data-artifact-addressed-revision={addressedRevision} className="mx-auto w-full max-w-3xl">
    <header className={PAGE_HEADER_CLASS}>
      <div className="flex min-w-0 items-start gap-3">
        <BackButton to={backTo ?? { kind: 'section', section: 'artifacts', projectId: null, scheduleId: null, artifactId: artifact.id }} onBack={onBack} />
        <div className="min-w-0 flex-1">
          <h1 className={`${PAGE_TITLE_CLASS} break-words [overflow-wrap:anywhere]`}>{artifact.name} · Version {addressedRevision}</h1>
          <p className="mt-1 text-[12px] text-ink-soft">Read-only saved version{inTrash ? ' · Artifact is in Trash' : ''}</p>
          {onViewCurrent && <button type="button" className={`${INLINE_ACTION_CLASS} mt-2`} onClick={onViewCurrent}>View current artifact</button>}
        </div>
      </div>
    </header>
    {!own ? <p role="status" className="text-[13px] text-ink-soft">Saved versions are available only to the artifact owner.</p>
      : permanentDeletionHeld ? <p role="status" className="text-[13px] text-ink-soft">Saved versions are unavailable while permanent deletion awaits confirmation.</p>
        : artifact.kind === 'image' ? <p role="status" className="text-[13px] text-ink-soft">This artifact has no retained body versions.</p>
          : historySection}
  </div>

  // The same canonical identity becomes a recovery surface. No retained body,
  // download, sharing or edit controls confer authority while access is suspended
  // or while the initiating action has an uncertain acknowledgement.
  if (inTrash || lifecycleHeld || permanentDeletionHeld) return (
    <div data-artifact-page={artifact.id} data-artifact-lifecycle={permanentDeletionHeld ? 'deleting' : lifecycleHeld ? 'held' : 'trashed'} data-artifact-permanent-deletion={permanentDeletionHeld ? 'held' : undefined} className="mx-auto w-full max-w-3xl">
      <header className={PAGE_HEADER_CLASS}>
        <div className="flex min-w-0 items-start gap-3">
          <BackButton to={backTo ?? { kind: 'section', section: 'artifacts', projectId: null, scheduleId: null, collectionSectionId: '__trash' }} onBack={onBack} />
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-panel-2 text-cap-workspace"><Icon size={20} /></span>
          <div className="min-w-0 flex-1">
            <h1 className={`${PAGE_TITLE_CLASS} truncate`} {...identityTitleProps(artifact.name)}>{artifact.name}</h1>
            <p className="mt-1 text-[12px] text-ink-soft"><span>{permanentDeletionHeld ? 'Permanent deletion awaiting confirmation' : lifecycleHeld ? 'Waiting for confirmation' : 'In Trash'}</span> · {KIND_LABEL[artifact.kind]}</p>
          </div>
        </div>
      </header>
      <Section title="Recovery" summary={permanentDeletionHeld || lifecycleHeld ? 'Your reviewed action is held' : 'Restore this artifact'}>
        <p className="text-[13px] leading-relaxed text-ink-soft">{permanentDeletionHeld
          ? 'Use the permanent deletion recovery notice to retry this exact reviewed request or Dismiss to check saved state. Restore stays unavailable until the result is confirmed.'
          : lifecycleHeld
          ? 'Use the recovery notice to retry this exact action, or Dismiss to check its saved state. The artifact stays here until the outcome is confirmed.'
          : 'This artifact is kept in Trash and is unavailable to shared readers, discussions and routines. Restoring keeps its contents, filing and current sharing settings.'}</p>
        {own && !lifecycleHeld && <button type="button" disabled={!identity || historyRestoreHeld || permanentDeletionHeld} title={permanentDeletionHeld ? 'Wait for permanent deletion to be confirmed' : historyRestoreHeld ? 'Wait for the version restore to be confirmed' : undefined} className={`${SECONDARY_BUTTON_CLASS} mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px]`} onClick={() => { if (identity) void enqueueArtifactLifecycle(artifact, 'active', sourceUserId) }}><RotateCcw size={14} />Restore artifact</button>}
      </Section>
      {historySection}
      {own && inTrash && !lifecycleHeld && identity && <ArtifactPermanentDeletionSectionBoundary><DeferredArtifactPermanentDeletionSection Section={Section} artifact={artifact} sourceUserId={sourceUserId} onDeleted={onDeleted ?? onBack} /></ArtifactPermanentDeletionSectionBoundary>}
    </div>
  )

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
            {editingName ? (
              <div className="flex min-w-0 max-w-full flex-wrap items-center gap-1" aria-busy={metadataBusy}>
                <h1 className="sr-only">{artifact.name}</h1>
                <input
                  autoFocus
                  disabled={metadataBusy}
                  value={nameDraft}
                  onChange={(event) => setNameDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') cancelName()
                    if (event.key === 'Enter') void saveName()
                  }}
                  aria-label="Artifact name"
                  aria-invalid={invalidName || undefined}
                  aria-describedby={invalidName ? nameHintId : undefined}
                  className={`${PAGE_TITLE_CLASS} min-w-0 max-w-full flex-1 rounded-md border border-accent bg-surface px-1.5 py-0.5 outline-none disabled:opacity-60`}
                />
                <button
                  type="button"
                  onClick={() => void saveName()}
                  disabled={metadataBusy || !normalizedName || normalizedName === artifact.name}
                  aria-label={metadataBusy ? 'Saving artifact name…' : 'Save artifact name'}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-accent transition hover:bg-accent-tint disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <Check size={13} />
                </button>
                {invalidName && (
                  <span id={nameHintId} className="basis-full text-[11px] text-removed" role="status">
                    Artifact name must be 1 to 240 characters and cannot contain control characters.
                  </span>
                )}
                <button
                  type="button"
                  onClick={cancelName}
                  disabled={metadataBusy}
                  aria-label="Cancel artifact rename"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-faint transition hover:bg-panel-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <X size={13} />
                </button>
              </div>
            ) : own ? (
              <button
                type="button"
                disabled={metadataBusy}
                onClick={() => {
                  setNameDraft(artifact.name)
                  setNameBaseRevision(artifact.metadataRevision ?? 0)
                  setEditingName(true)
                }}
                title={metadataBusy ? 'Updating artifact name…' : 'Rename artifact'}
                aria-label="Rename artifact"
                className="group flex min-w-0 max-w-full items-center gap-1.5 rounded-md text-left transition hover:bg-panel-2/60 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <h1 {...identityTitleProps(artifact.name)} className={`${PAGE_TITLE_CLASS} truncate`}>{artifact.name}</h1>
                <Pencil size={14} className={`shrink-0 text-ink-faint ${HOVER_CUE}`} />
              </button>
            ) : (
              <h1 {...identityTitleProps(artifact.name)} className={`${PAGE_TITLE_CLASS} truncate`}>{artifact.name}</h1>
            )}
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-faint">
              {/* S6 — the canonical page should be at least as specific as the humble
                  side panel: show the artifact's own descriptor (meta — "functional spec",
                  "1600×900") when it beats the generic kind label (the shared guard skips
                  index-created artifacts whose meta = the label — no "Document · Document"). */}
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
        <Section
          key={artifact.id}
          title="Content"
          heldOpen={searchTarget !== undefined}
          reveal={pendingFocus?.artifactBlockId !== undefined}
          summary={artifactMetaIsSpecific(artifact.meta, KIND_LABEL[artifact.kind]) ? artifact.meta : KIND_LABEL[artifact.kind]}
          actions={<div className="flex flex-wrap items-center gap-1.5">
            {own && editableStructuredBody && <SectionAction
              label={editingStructured ? 'Cancel editing' : editableStructuredBody.type === 'doc' ? 'Edit document' : editableStructuredBody.type === 'slides' ? 'Edit slides' : 'Edit sheet'}
              icon={editingStructured ? <X size={14} /> : <Pencil size={14} />}
              onClick={editingStructured ? () => artifactEditDrafts.cancel(artifact.id) : startStructuredEdit}
              disabled={structuredBusy || historyRestoreHeld || Boolean(documentDraft)}
              disabledReason={historyRestoreHeld ? 'Wait for the version restore to be confirmed' : documentDraft ? 'Save or cancel your current block edit first' : structuredBusy ? 'Finish the current structure edit first' : undefined}
            />}
            {downloadFormat && <>
              <SectionAction
                label={downloadFormat === 'xlsx' ? 'Download XLSX' : downloadFormat === 'pptx' ? 'Download PowerPoint' : 'Download Markdown'}
                caption={downloadFormat === 'markdown' ? 'Markdown' : undefined}
                icon={<Download size={14} />}
                onClick={() => { void artifactDownload.download(downloadFormat) }}
                disabled={editing !== null || saving || editingName || metadataBusy || editingStructured || structuredBusy || artifactDownload.busy}
                disabledReason={editing !== null || saving || editingName || metadataBusy || editingStructured || structuredBusy ? 'Save or cancel your edit before downloading' : 'Preparing download'}
              />
              {(downloadFormat === 'markdown') && <SectionAction
                label="Download Word"
                caption="Word"
                icon={<Download size={14} />}
                onClick={() => { void artifactDownload.download('docx') }}
                disabled={editing !== null || saving || editingName || metadataBusy || editingStructured || structuredBusy || artifactDownload.busy}
                disabledReason={editing !== null || saving || editingName || metadataBusy || editingStructured || structuredBusy ? 'Save or cancel your edit before downloading' : 'Preparing download'}
              />}
            </>}
          </div>}
        >
          {artifactDownload.notice && <InlineOperationStatus {...artifactDownload.notice} />}
          {searchTarget && draftState && <p role="status" className="mb-3 text-[12px] text-ink-soft">Save or cancel your edit to reveal this search match in the saved body.</p>}
          {pendingFocus?.artifactBlockId && structuredDraft && <p role="status" data-document-anchor-held className="mb-3 text-[12px] text-ink-soft">Save or cancel your draft to reveal the original discussion block in the saved document.</p>}
          {documentTargetUnavailable && edit && <DocumentBlockEditor edit={edit} unavailable />}
          {documentDraft && draftBlock && documentDraft.expectedRevision !== undefined &&
            documentDraft.expectedRevision !== (structuredBody?.revision ?? 0) &&
            <div data-document-latest-block className="mb-3 space-y-2 rounded-md border border-line p-2.5">
              <p className="text-[11px] font-semibold text-ink-soft">Latest saved block</p>
              <DocBlockView block={draftBlock} size="full" index={editing ?? 0} />
            </div>}
          {own && structuredDraft ? (
            <StructuredArtifactEditor
              body={structuredDraft.content}
              onChange={(content) => artifactEditDrafts.update(artifact.id, { ...structuredDraft, content })}
              latestBody={structuredMutation.activeResourceId === artifact.id && structuredMutation.error ? editableStructuredBody : undefined}
              showLatest={structuredMutation.activeResourceId === artifact.id && Boolean(structuredMutation.error)}
              saving={structuredBusy}
              error={draftState?.error}
              onSave={() => { void artifactEditDrafts.save(artifact.id) }}
              onCancel={() => artifactEditDrafts.cancel(artifact.id)}
            />
          ) : <ArtifactBodyView
              kind={artifact.kind}
              name={artifact.name}
              artifactId={artifact.id}
              searchTarget={draftState ? undefined : searchTarget}
              size="full"
              excerpt={artifact.excerpt}
              edit={edit}
              // The canonical page is the artifact's READING surface, so it is
              // the one place a block carries its own thread (social S2).
              discuss={{ kind: 'artifact', id: artifact.id }}
            />}
        </Section>
        {historySection}
        {/* Improvements (social S3) — the generic ProposalsPanel, the third
            social primitive on the one canonical surface. An artifact could be
            shared and discussed but never IMPROVED: `artifact-patch` had no
            host, which is the "capability with no surface" failure the layer's
            own audits keep finding. Everyone sees the ledger; the offer form
            is the panel's own propose-tier gate, land/decline the owner's. */}
        <ProposalsPanel subject={{ kind: 'artifact', id: artifact.id }} own={own} Section={Section} />
        {/* Sharing (social S1) — the OWNER's audience configuration, the same
            generic GrantsPanel every other subject hosts. Without it an
            artifact could be granted only through the API: the read now
            widens for an audience that had no way to be created. */}
        {own && (
          <Section
            title="Sharing"
            defaultFolded
            heldOpen={sharingHeld}
            summary="Audience and permissions"
            actions={
              <SectionAction
                label="Share with an audience"
                icon={<Plus size={14} />}
                onClick={() => setSharing((value) => !value)}
                expanded={sharing}
                disabled={sharingHeld}
                disabledReason={sharingHeld ? SHARING_MUTATION_WAIT : undefined}
              />
            }
          >
            <GrantsPanel
              subject={{ kind: 'artifact', id: artifact.id }}
              composing={sharing}
              onHeldChange={setSharingHeld}
            />
          </Section>
        )}
        <Section title="Provenance" summary={`From ${artifact.source}`}>
          <div className="flex items-center gap-2 text-[12px] text-ink-faint">
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
        </Section>
        {own && <Section title="Manage artifact" summary="Recoverable removal" defaultFolded>
          <p className="text-[12px] leading-relaxed text-ink-soft">Move this artifact to Trash to remove it from active work. You can restore it later.</p>
          <button type="button" disabled={trashBlocked || artifactDownload.busy} title={trashBlocked || artifactDownload.busy ? 'Save or cancel edits and finish current changes before moving to Trash' : 'Move to Trash'} className={`${SECONDARY_BUTTON_CLASS} mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px]`} onClick={() => setTrashReview({ artifact: structuredClone(artifact), sourceUserId })}><Trash2 size={14} />Move to Trash</button>
        </Section>}
      </div>
      {trashReview && <ConfirmDialog title="Move artifact to Trash?" body={`“${trashReview.artifact.name}” will leave active work. Shared access, discussions and routine output to this artifact will be suspended. Its contents and filing are kept so you can restore it later.`} confirmLabel="Move to Trash" onCancel={() => setTrashReview(null)} onConfirm={() => {
        if (trashBlocked || artifactDownload.busy) { setTrashReview(null); return }
        void enqueueArtifactLifecycle(trashReview.artifact, 'trashed', trashReview.sourceUserId)
        setTrashReview(null)
      }} />}
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
