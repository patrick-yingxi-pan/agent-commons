import { literalSearchSnippet } from '../contract/literalSearch.ts'
import { findArtifactBodySearchText } from './artifactBodySearch.ts'
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
        const matchedText = findArtifactBodySearchText(version.body, query)
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
