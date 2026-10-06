/** Full code comparisons distinguish exact text (including empty) from a
 * non-content explanation, without implying that unknown text was deleted. */
import type { LineDiffHunk } from './lineDiff.ts'

export type TextDiffSide = { label: string; text: string; notice?: never; missing?: never }
  | { label: string; text?: never; notice: string; missing?: true }

/** Only known absence can compare as an empty sequence. An unread side is
 * unknown, not an empty file and never evidence of added/deleted lines. */
export function textDiffInput(sides: { before: TextDiffSide; after: TextDiffSide }): [string, string] | undefined {
  const before = sides.before.text ?? (sides.before.missing ? '' : undefined)
  const after = sides.after.text ?? (sides.after.missing ? '' : undefined)
  return before === undefined || after === undefined ? undefined : [before, after]
}

export const DIFF_PAGE_ROWS = 200
export interface TextDiffPagePart {
  hunk: LineDiffHunk
  offset: number
  rows: LineDiffHunk['rows']
}

/** Bound mounted rows, not the available review. Each continuation repeats its
 * hunk's range so pagination cannot lose the reader's location. */
export function textDiffPages(hunks: LineDiffHunk[]): TextDiffPagePart[][] {
  const pages: TextDiffPagePart[][] = []
  let page: TextDiffPagePart[] = []
  let used = 0
  for (const hunk of hunks) {
    for (let offset = 0; offset < hunk.rows.length;) {
      const rows = hunk.rows.slice(offset, offset + DIFF_PAGE_ROWS - used)
      page.push({ hunk, offset, rows })
      offset += rows.length
      used += rows.length
      if (used === DIFF_PAGE_ROWS) { pages.push(page); page = []; used = 0 }
    }
  }
  if (page.length) pages.push(page)
  return pages
}
