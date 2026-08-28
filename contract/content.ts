/** ── Contract: artifact bodies ─────────────────────────────────────────────
 *  The rendered content of an artifact (a doc's blocks, a sheet's rows, a deck's
 *  slides, a figure's series). The mock backend serves hand-authored bodies; a
 *  real backend would render/extract the actual file. Shared so the server's
 *  payload and the UI's renderer agree on shape. */

export type DocBlock =
  | { h: string } // section heading
  | { p: string } // paragraph
  | { ul: string[] } // bullet list
  | { code: string[] } // monospace block (config, headers, signatures)
  | { email: { to: string; subject: string } } // an email's To/Subject header

export type FigureShape = 'hero' | 'bars' | 'line' | 'funnel'

export type ArtifactContent = (
  | { type: 'doc'; title: string; blocks: DocBlock[] }
  | { type: 'sheet'; columns: string[]; rows: string[][]; note?: string }
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

/** The artifact-body library. Authored fixtures are keyed by file name; an
 * edited projection additionally carries its exact artifact-id key so two
 * same-named artifacts can never share mutable state. */
export type ArtifactContentLibrary = Record<string, ArtifactContent>

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
  if ('h' in block) return { h: text }
  if ('p' in block) return { p: text }
  return block
}
