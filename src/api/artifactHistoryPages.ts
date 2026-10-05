import type { ArtifactHistoryPage } from '../../contract/artifactHistory.ts'

/** Keep loaded boundaries stable when new versions shift the newest page. The
 * new page is prepended; old page metadata remains available and the flattened
 * row projection deduplicates revision ids. */
export function mergeArtifactHistoryPage(
  pages: ArtifactHistoryPage[],
  incoming: ArtifactHistoryPage,
  newest: boolean,
): ArtifactHistoryPage[] {
  const identity = incoming.versions[0]?.revision
  const existing = pages.findIndex((page) => page.versions[0]?.revision === identity)
  if (existing >= 0) return pages.map((page, index) => index === existing ? incoming : page)
  return newest ? [incoming, ...pages] : [...pages, incoming]
}

export function artifactHistoryNextCursor(pages: ArtifactHistoryPage[]): number | undefined {
  let oldest: ArtifactHistoryPage | undefined
  for (const page of pages) {
    if (!page.versions.length) continue
    if (!oldest || page.versions.at(-1)!.revision < oldest.versions.at(-1)!.revision) oldest = page
  }
  return oldest?.nextBeforeRevision
}

export function flattenArtifactHistoryPages(pages: ArtifactHistoryPage[]) {
  const byRevision = new Map<number, ArtifactHistoryPage['versions'][number]>()
  for (const page of pages) for (const version of page.versions) byRevision.set(version.revision, version)
  return [...byRevision.values()].sort((a, b) => b.revision - a.revision)
}
