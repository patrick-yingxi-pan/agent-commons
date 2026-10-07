import { literalSearchSnippet } from '../contract/literalSearch.ts'
import type { ArtifactContent } from '../contract/content.ts'

/** Search only authored string fields from a saved Artifact body. Fields are
 * visited independently: a query cannot match by crossing a structural edge
 * between a title, block, cell, or slide field. */
function* bodyText(body: ArtifactContent): Generator<unknown> {
  switch (body.type) {
    case 'doc':
      yield body.title
      for (const block of body.blocks) {
        if ('h' in block) yield block.h
        else if ('p' in block) yield block.p
        else if ('ul' in block) yield* block.ul
        else if ('code' in block) yield* block.code
        else {
          yield block.email.to
          yield block.email.subject
        }
      }
      return
    case 'sheet':
      yield* body.columns
      for (const row of body.rows) yield* row
      if (body.note !== undefined) yield body.note
      return
    case 'workbook':
      for (const sheet of body.sheets) {
        yield sheet.name
        yield* sheet.columns
        for (const row of sheet.rows) yield* row
        if (sheet.note !== undefined) yield sheet.note
      }
      return
    case 'slides':
      for (const slide of body.slides) {
        yield slide.title
        yield* slide.bullets
      }
      return
    case 'figure':
      // Figure captions, labels, and series are metadata/visual structure, not
      // saved searchable prose in this projection.
      return
  }
}

/** Find the first literal match in the body's declared text fields without
 * constructing a snippet. `normalizedQuery` is the trimmed lowercase query
 * shared by the caller. */
export function findArtifactBodySearchText(
  body: ArtifactContent | undefined,
  normalizedQuery: string,
): string | undefined {
  if (!body || !normalizedQuery) return undefined
  for (const text of bodyText(body)) {
    if (typeof text !== 'string') continue
    if (text.toLowerCase().includes(normalizedQuery)) return text
  }
  return undefined
}

/** Return a bounded snippet for the first body-field match. This convenience
 * projection shares the same field finder as paged consumers. */
export function artifactBodySearchSnippet(
  body: ArtifactContent | undefined,
  normalizedQuery: string,
): string | undefined {
  const text = findArtifactBodySearchText(body, normalizedQuery)
  return text === undefined ? undefined : literalSearchSnippet(text, normalizedQuery)
}
