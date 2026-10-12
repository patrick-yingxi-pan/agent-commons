/** ── Contract: artifact bodies ─────────────────────────────────────────────
 *  The rendered content of an artifact (a doc's blocks, a sheet's rows, a deck's
 *  slides, a figure's series). Authored documents, sheets, and slides persist
 *  real values; seeded demo and unsupported imported-file previews remain
 *  explicit fixtures. Shared so persistence, consent, and rendering agree. */

import type { SheetCell } from './sheetCell.ts'
export type { SheetCell } from './sheetCell.ts'

export type DocBlock = (
  | { h: string } // section heading
  | { p: string } // paragraph
  | { ul: string[] } // bullet list
  | { code: string[] } // monospace block (config, headers, signatures)
  | { email: { to: string; subject: string } } // an email's To/Subject header
) & {
  /** Stable within one artifact, independent of text and position. Absence is
   * legacy identity-unknown content, not permission to infer an ID by index.
   * Saved bodies are either wholly identified or wholly legacy. Rollout of ID
   * assignment and structural editing is separate from lossless admission. */
  id?: string
}

/** Opaque, bounded local identity, safe to carry through a typed block locus.
 * Validation does not mint identity or establish correspondence with an older
 * snapshot; the authoritative writer/migration owns those decisions. */
export function isDocBlockId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(value) && !/\s/.test(value)
}

export type FigureShape = 'hero' | 'bars' | 'line' | 'funnel'

/** One authored worksheet grid. Sheet IDs identify tabs inside a workbook only;
 * they carry no artifact identity or permission authority. */
export interface SheetGrid {
  columns: string[]
  rows: SheetCell[][]
  note?: string
}

export interface WorkbookSheet extends SheetGrid {
  id: string
  name: string
}

export type ArtifactContent = (
  | { type: 'doc'; title: string; blocks: DocBlock[] }
  | ({ type: 'sheet' } & SheetGrid)
  | { type: 'workbook'; sheets: WorkbookSheet[] }
  | { type: 'slides'; slides: { title: string; bullets: string[] }[] }
  | {
      type: 'figure'
      shape: FigureShape
      caption: string
      headline?: string
      labels?: string[]
      series?: number[]
      series2?: number[]
      legend?: [string, string]
    }
) & {
  /** Monotonic server-owned revision of this artifact's editable body. The
   *  authored fixture and legacy persisted overlays omit it and therefore read
   *  as revision 0. Metadata, grants, filing, and discussion activity are
   *  deliberately separate domains and do not advance it. */
  revision?: number
}

/** The artifact-body library. Addressed readers use exact artifact-id keys for
 * every visible body, including untouched seeds. Name keys remain a legacy
 * fixture-preview compatibility path, never identity or write authority. */
export type ArtifactContentLibrary = Record<string, ArtifactContent>

/** The one authored-document boundary shared by proposal construction and
 * persistence. Bounding only at final storage would still let a model put an
 * oversized body into the consent card/message record; bounding only at the
 * tool would let direct/MCP callers bypass it. */
export const MAX_ARTIFACT_BLOCK_CHARS = 2_000
export const MAX_AUTHORED_DOCUMENT_BLOCKS = 100
export const MAX_AUTHORED_DOCUMENT_CHARS = 20_000
/** Source-text budget leaves room for separators introduced only when a single
 * overlong paragraph must become several editable blocks. Thus every character
 * accepted at this public boundary survives in the canonical consent text. */
export const MAX_AUTHORED_DOCUMENT_SOURCE_CHARS =
  MAX_AUTHORED_DOCUMENT_CHARS - Math.ceil(MAX_AUTHORED_DOCUMENT_CHARS / MAX_ARTIFACT_BLOCK_CHARS) * 2
export const MAX_ARTIFACT_EXCERPT_CHARS = 160

function record(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function fields(value: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
  return required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => required.includes(key) || optional.includes(key))
}

function boundedDocLines(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.length > MAX_AUTHORED_DOCUMENT_BLOCKS) return false
  // Iteration visits holes; Array.every skips them and would admit undefined
  // lines that change into null when the saved body crosses JSON.
  for (const line of value) {
    if (typeof line !== 'string' || line.length > MAX_ARTIFACT_BLOCK_CHARS) return false
  }
  return true
}

/** Closed, detached block admission shared by history and export. Identity is
 * all-or-none, never inferred. The envelope preserves the historical 100 ×
 * 2,000-character ceiling; callers own stricter authored/export budgets and
 * whether an empty block list or a particular title is acceptable. */
export function parseDocBlocks(value: unknown): DocBlock[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_AUTHORED_DOCUMENT_BLOCKS) return undefined
  let characters = 0
  const blocks: DocBlock[] = []
  const blockIds = new Set<string>()
  const identified = record(value[0]) && Object.hasOwn(value[0], 'id')
  for (const item of value) {
    if (!record(item)) return undefined
    if (Object.hasOwn(item, 'id') !== identified) return undefined
    if (identified) {
      if (!isDocBlockId(item.id) || blockIds.has(item.id)) return undefined
      blockIds.add(item.id)
    }
    let block: DocBlock
    if (fields(item, ['h'], ['id']) && typeof item.h === 'string') {
      characters += item.h.length
      block = { h: item.h }
    } else if (fields(item, ['p'], ['id']) && typeof item.p === 'string') {
      characters += item.p.length
      block = { p: item.p }
    } else if (fields(item, ['ul'], ['id']) && boundedDocLines(item.ul)) {
      characters += item.ul.reduce((sum, line) => sum + line.length, 0)
      block = { ul: [...item.ul] }
    } else if (fields(item, ['code'], ['id']) && boundedDocLines(item.code)) {
      characters += item.code.reduce((sum, line) => sum + line.length, 0)
      block = { code: [...item.code] }
    } else if (fields(item, ['email'], ['id']) && record(item.email) && fields(item.email, ['to', 'subject']) &&
      typeof item.email.to === 'string' && typeof item.email.subject === 'string') {
      if (item.email.to.length > MAX_ARTIFACT_BLOCK_CHARS || item.email.subject.length > MAX_ARTIFACT_BLOCK_CHARS) return undefined
      characters += item.email.to.length + item.email.subject.length
      block = { email: { to: item.email.to, subject: item.email.subject } }
    } else return undefined
    const text = docBlockText(block)
    if (text !== undefined && text.length > MAX_ARTIFACT_BLOCK_CHARS) return undefined
    if (characters > MAX_ARTIFACT_BLOCK_CHARS * MAX_AUTHORED_DOCUMENT_BLOCKS) return undefined
    blocks.push(identified ? { id: item.id as string, ...block } : block)
  }
  return blocks
}

export interface AuthoredDocument {
  body: ArtifactContent
  excerpt: string
  /** Canonical plain text corresponding exactly to `body.blocks`. This is the
   * bounded value a consent op carries, so preview and persistence cannot show
   * different prose. */
  text: string
}

function titleFromName(name: string): string {
  const leaf = name.trim().split(/[\\/]/).at(-1) ?? ''
  const dot = leaf.lastIndexOf('.')
  return (dot > 0 ? leaf.slice(0, dot) : leaf) || 'Untitled document'
}

function splitDocumentParagraph(paragraph: string): string[] {
  const parts: string[] = []
  let rest = paragraph
  while (rest.length > MAX_ARTIFACT_BLOCK_CHARS) {
    const wordBoundary = rest.lastIndexOf(' ', MAX_ARTIFACT_BLOCK_CHARS)
    const end = wordBoundary > 0 ? wordBoundary : MAX_ARTIFACT_BLOCK_CHARS
    const part = rest.slice(0, end).trim()
    if (part) parts.push(part)
    rest = rest.slice(end).trim()
  }
  if (rest) parts.push(rest)
  return parts
}

/** Preserve ordinary paragraphs as individual edit units. Only when a document
 * exceeds the block-count safety bound, pack the smallest possible suffix into
 * bounded blocks; embedded blank lines retain every accepted character even if
 * those unusually numerous paragraphs can no longer each own a separate row. */
function boundDocumentBlocks(candidates: string[]): string[] {
  if (candidates.length <= MAX_AUTHORED_DOCUMENT_BLOCKS) return candidates
  const pack = (items: string[]): string[] => {
    const packed: string[] = []
    let current = ''
    for (const item of items) {
      const joined = current ? `${current}\n\n${item}` : item
      if (joined.length <= MAX_ARTIFACT_BLOCK_CHARS) {
        current = joined
      } else {
        if (current) packed.push(current)
        current = item
      }
    }
    if (current) packed.push(current)
    return packed
  }
  for (let prefixLength = MAX_AUTHORED_DOCUMENT_BLOCKS - 1; prefixLength >= 0; prefixLength -= 1) {
    const suffix = pack(candidates.slice(prefixLength))
    if (prefixLength + suffix.length <= MAX_AUTHORED_DOCUMENT_BLOCKS) {
      return [...candidates.slice(0, prefixLength), ...suffix]
    }
  }
  return pack(candidates).slice(0, MAX_AUTHORED_DOCUMENT_BLOCKS)
}

/** Turn one plain-text authoring field into independently editable document
 * paragraphs. Blank lines express block boundaries; intra-paragraph line wraps
 * collapse to spaces so pasted prose does not acquire accidental hard breaks. */
export function authoredDocument(name: string, raw: unknown): AuthoredDocument | undefined {
  if (typeof raw !== 'string') return undefined
  // Leave room for the blank-line separators inserted when one very long
  // logical paragraph becomes several independently editable blocks. This
  // keeps the canonical consent text itself within the public total ceiling
  // without discarding a tail merely because the author omitted blank lines.
  const bounded = raw.trim().slice(0, MAX_AUTHORED_DOCUMENT_SOURCE_CHARS)
  if (!bounded) return undefined
  const candidates = bounded
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .flatMap(splitDocumentParagraph)
  const paragraphs = boundDocumentBlocks(candidates)
  if (paragraphs.length === 0) return undefined
  return {
    body: {
      type: 'doc',
      title: titleFromName(name),
      blocks: paragraphs.map((p) => ({ p })),
      revision: 0,
    },
    excerpt: paragraphs[0].slice(0, MAX_ARTIFACT_EXCERPT_CHARS).trim(),
    text: paragraphs.join('\n\n'),
  }
}

/** ── The addressable unit of a body edit (social S3, `artifact-patch`) ───────
 *  A doc's blocks are its ordered prose units, so an artifact patch addresses
 *  ONE BLOCK BY INDEX rather than a line range. That is a deliberate cut, not a
 *  shortcut: these bodies are STRUCTURED, not linear (a doc has blocks, a sheet
 *  rows, a deck slides, a figure nothing ordered at all), so a `{from,to}` line
 *  span would make its own label a lie — the same reasoning that blocked the S2
 *  artifact gutter, resolved here by taking the address the body actually has.
 *
 *  Total over `DocBlock` so a new variant must decide, in the same edit, whether
 *  it is patchable. A block answers its text only when it carries exactly ONE
 *  editable string: `ul` and `code` hold a LIST and `email` a structured header,
 *  and a one-line before→after diff cannot honestly address those — they stay
 *  the owner's own surface, the `PROPOSABLE_SCHEDULE_FIELDS` cut. */
export function docBlockText(block: DocBlock): string | undefined {
  if ('h' in block) return block.h
  if ('p' in block) return block.p
  return undefined
}

/** The same cut, applied: a patchable block carrying new text; anything else
 *  unchanged. Paired with `docBlockText` in one module so the reader and the
 *  writer can never disagree about which blocks are addressable. */
export function withDocBlockText(block: DocBlock, text: string): DocBlock {
  if ('h' in block) return { ...block, h: text }
  if ('p' in block) return { ...block, p: text }
  return block
}
