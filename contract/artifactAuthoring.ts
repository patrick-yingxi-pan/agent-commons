import { authoredDocument, type ArtifactContent } from './content.ts'
import { artifactBodyExcerpt } from './artifactExcerpt.ts'
import { normalizeArtifactName } from './artifactMetadata.ts'
import {
  MAX_AUTHORED_CELL_CHARS,
  MAX_AUTHORED_LABEL_CHARS,
  MAX_AUTHORED_STRUCTURE_CHARS,
  parseAuthoredSheet,
  parseAuthoredWorkbook,
} from './workbook.ts'

/** Authored values, not spreadsheet execution or an Office file format. Body
 * revisions belong to the server and are never accepted from an author. */
export type StructuredArtifactBody =
  | Omit<Extract<ArtifactContent, { type: 'sheet' }>, 'revision'>
  | Omit<Extract<ArtifactContent, { type: 'workbook' }>, 'revision'>
  | Omit<Extract<ArtifactContent, { type: 'slides' }>, 'revision'>

export { MAX_AUTHORED_CELL_CHARS, MAX_AUTHORED_LABEL_CHARS, MAX_AUTHORED_SHEET_COLUMNS, MAX_AUTHORED_SHEET_ROWS, MAX_AUTHORED_STRUCTURE_CHARS } from './workbook.ts'
export const MAX_AUTHORED_SLIDES = 40
export const MAX_AUTHORED_SLIDE_BULLETS = 20

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
  if (value.type === 'workbook') return parseAuthoredWorkbook(value)
  if (value.type === 'sheet') return parseAuthoredSheet(value)
  let characters = 0
  const text = (raw: unknown, limit: number, nonblank = false): raw is string => {
    if (typeof raw !== 'string' || raw.length > limit || (nonblank && !raw.trim())) return false
    characters += raw.length
    return characters <= MAX_AUTHORED_STRUCTURE_CHARS
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
  if (!normalizeArtifactName(name)) return undefined
  if (kind === 'doc') {
    const document = authoredDocument(name, raw)
    return document && { body: document.body, draftBody: document.text, excerpt: artifactBodyExcerpt(document.body)! }
  }
  if (kind !== 'sheet' && kind !== 'slide') return undefined
  const structured = parseStructuredArtifactBody(raw)
  if (!structured || (kind === 'sheet' ? structured.type !== 'sheet' && structured.type !== 'workbook' : structured.type !== 'slides')) return undefined
  return { body: { ...structured, revision: 0 }, draftBody: structured, excerpt: artifactBodyExcerpt(structured)! }
}
