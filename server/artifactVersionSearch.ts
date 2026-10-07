import { literalSearchSnippet } from '../contract/literalSearch.ts'
import type { ArtifactHistoryVersion } from '../contract/artifactHistory.ts'
import type { ArtifactContent } from '../contract/content.ts'
import {
  MAX_ARTIFACT_VERSION_SEARCH_QUERY_CHARS,
  SEARCH_PAGE_SIZE,
  type ArtifactVersionSearchHit,
  type SearchGroup,
} from '../contract/search.ts'

export interface ArtifactVersionSearchSource {
  id: string
  name: string
  trashed: boolean
  versions: readonly ArtifactHistoryVersion[]
}

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
      return
  }
}

function matchingText(body: ArtifactContent, query: string): string | undefined {
  for (const text of bodyText(body)) {
    if (typeof text === 'string' && text.toLowerCase().includes(query)) return text
  }
  return undefined
}

/** Build an owner-authorized history search page without retaining all matches. */
export function searchArtifactVersions(
  sources: readonly ArtifactVersionSearchSource[],
  rawQuery: string,
  offset: number,
): SearchGroup {
  const query = rawQuery.trim().toLowerCase()
  if (rawQuery.trim().length > MAX_ARTIFACT_VERSION_SEARCH_QUERY_CHARS) {
    throw new RangeError(`Artifact version search queries are limited to ${MAX_ARTIFACT_VERSION_SEARCH_QUERY_CHARS} characters.`)
  }

  const hits: ArtifactVersionSearchHit[] = []
  let total = 0
  if (query) {
    const ordered = [...sources].sort((a, b) => a.id.localeCompare(b.id))
    for (const source of ordered) {
      const versions = [...source.versions].sort((a, b) => b.revision - a.revision)
      for (const version of versions) {
        const matchedText = matchingText(version.body, query)
        if (matchedText === undefined) continue
        if (total >= offset && hits.length < SEARCH_PAGE_SIZE) {
          const subtitle = literalSearchSnippet(matchedText, query)
          if (subtitle === undefined) throw new Error('Literal Artifact version match lost its snippet.')
          const { body: _body, ...metadata } = version
          hits.push({
            type: 'artifactVersion',
            id: source.id,
            title: source.name,
            subtitle,
            ...metadata,
            trashed: source.trashed,
          })
        }
        total += 1
      }
    }
  }
  return { type: 'artifactVersion', label: 'Saved versions', total, hits }
}
