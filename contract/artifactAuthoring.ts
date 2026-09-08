import { authoredDocument, MAX_ARTIFACT_EXCERPT_CHARS, type ArtifactContent } from './content.ts'
import { normalizeArtifactName } from './artifactMetadata.ts'

/** Authored values, not spreadsheet execution or an Office file format. Body
 * revisions belong to the server and are never accepted from an author. */
export type StructuredArtifactBody =
  | Omit<Extract<ArtifactContent, { type: 'sheet' }>, 'revision'>
  | Omit<Extract<ArtifactContent, { type: 'slides' }>, 'revision'>

export const MAX_AUTHORED_SHEET_COLUMNS = 32
export const MAX_AUTHORED_SHEET_ROWS = 200
export const MAX_AUTHORED_CELL_CHARS = 2_000
export const MAX_AUTHORED_SLIDES = 40
export const MAX_AUTHORED_SLIDE_BULLETS = 20
export const MAX_AUTHORED_LABEL_CHARS = 240
export const MAX_AUTHORED_STRUCTURE_CHARS = 20_000

export interface AuthoredArtifact {
  body: ArtifactContent
  draftBody: string | StructuredArtifactBody
  excerpt: string
}

function record(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function fields(value: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
  return required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => required.includes(key) || optional.includes(key))
}

/** A detached, lossless value snapshot. Reject the complete submission on any
 * invalid shape or limit, before consent or storage; never coerce or truncate.
 * Formula-looking strings remain literal data in the same contract as prose. */
export function parseStructuredArtifactBody(value: unknown): StructuredArtifactBody | undefined {
  if (!record(value)) return undefined
  let characters = 0
  const text = (raw: unknown, limit: number, nonblank = false): raw is string => {
    if (typeof raw !== 'string' || raw.length > limit || (nonblank && !raw.trim())) return false
    characters += raw.length
    return characters <= MAX_AUTHORED_STRUCTURE_CHARS
  }
  if (value.type === 'sheet') {
    if (!fields(value, ['type', 'columns', 'rows'], ['note']) ||
      !Array.isArray(value.columns) || value.columns.length < 1 || value.columns.length > MAX_AUTHORED_SHEET_COLUMNS ||
      !Array.isArray(value.rows) || value.rows.length < 1 || value.rows.length > MAX_AUTHORED_SHEET_ROWS) return undefined
    const columns: string[] = []
    for (const column of value.columns) {
      if (!text(column, MAX_AUTHORED_LABEL_CHARS, true)) return undefined
      columns.push(column)
    }
    const rows: string[][] = []
    for (const row of value.rows) {
      if (!Array.isArray(row) || row.length !== columns.length) return undefined
      const cells: string[] = []
      for (const cell of row) {
        if (!text(cell, MAX_AUTHORED_CELL_CHARS)) return undefined
        cells.push(cell)
      }
      rows.push(cells)
    }
    if (Object.hasOwn(value, 'note') && !text(value.note, MAX_AUTHORED_CELL_CHARS)) return undefined
    return { type: 'sheet', columns, rows, ...(typeof value.note === 'string' ? { note: value.note } : {}) }
  }
  if (value.type === 'slides') {
    if (!fields(value, ['type', 'slides']) || !Array.isArray(value.slides) ||
      value.slides.length < 1 || value.slides.length > MAX_AUTHORED_SLIDES) return undefined
    const slides: Array<{ title: string; bullets: string[] }> = []
    for (const slide of value.slides) {
      if (!record(slide) || !fields(slide, ['title', 'bullets']) ||
        !text(slide.title, MAX_AUTHORED_LABEL_CHARS, true) || !Array.isArray(slide.bullets) ||
        slide.bullets.length > MAX_AUTHORED_SLIDE_BULLETS) return undefined
      const bullets: string[] = []
      for (const bullet of slide.bullets) {
        if (!text(bullet, MAX_AUTHORED_CELL_CHARS)) return undefined
        bullets.push(bullet)
      }
      slides.push({ title: slide.title, bullets })
    }
    return { type: 'slides', slides }
  }
  return undefined
}

/** One proposal/store boundary with the established document behavior intact.
 * Kind must be explicit for structured content; no filename/type guessing. */
export function authoredArtifact(name: string, kind: unknown, raw: unknown): AuthoredArtifact | undefined {
  if (kind === 'doc') {
    const document = authoredDocument(name, raw)
    return document && { body: document.body, draftBody: document.text, excerpt: document.excerpt }
  }
  if ((kind !== 'sheet' && kind !== 'slide') || !normalizeArtifactName(name)) return undefined
  const structured = parseStructuredArtifactBody(raw)
  if (!structured || (kind === 'sheet' ? structured.type !== 'sheet' : structured.type !== 'slides')) return undefined
  const excerpt = structured.type === 'sheet'
    ? `${structured.rows.length} rows · ${structured.columns.join(' · ')}`
    : `${structured.slides.length} slides · ${structured.slides[0].title}`
  return { body: { ...structured, revision: 0 }, draftBody: structured, excerpt: excerpt.slice(0, MAX_ARTIFACT_EXCERPT_CHARS) }
}
