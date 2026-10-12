import { literalSearchSnippet } from '../contract/literalSearch.ts'
import { artifactSearchFields } from '../contract/artifactSearch.ts'
import type { ArtifactContent } from '../contract/content.ts'

export interface ArtifactBodySearchMatch {
  text: string
  field: string
}

/** Find the first textual match in the body's declared authored fields (including
 * exact formula source) without
 * constructing a snippet. `normalizedQuery` is the trimmed lowercase query
 * shared by the caller. */
export function findArtifactBodySearchMatch(
  body: ArtifactContent | undefined,
  normalizedQuery: string,
): ArtifactBodySearchMatch | undefined {
  if (!body || !normalizedQuery) return undefined
  for (const match of artifactSearchFields(body)) {
    if (match.text.toLowerCase().includes(normalizedQuery)) return match
  }
  return undefined
}

/** Compatibility projection for callers that need only the original field. */
export function findArtifactBodySearchText(
  body: ArtifactContent | undefined,
  normalizedQuery: string,
): string | undefined {
  return findArtifactBodySearchMatch(body, normalizedQuery)?.text
}

/** Return a bounded snippet for the first body-field match. This convenience
 * projection shares the same field finder as paged consumers. */
export function artifactBodySearchSnippet(
  body: ArtifactContent | undefined,
  normalizedQuery: string,
): string | undefined {
  const match = findArtifactBodySearchMatch(body, normalizedQuery)
  return match === undefined ? undefined : literalSearchSnippet(match.text, normalizedQuery)
}
