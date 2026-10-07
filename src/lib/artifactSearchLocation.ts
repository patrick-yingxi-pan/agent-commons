import { artifactHistoryRevision } from './artifactHistoryLocation.ts'
import { parseArtifactSearchTarget } from '../../contract/artifactSearch.ts'

export interface ArtifactSubLocation {
  revision?: number
  /** Canonical `${revision}/${field}` key. */
  match?: string
}

/** Parse the artifact-specific nav bridge grammar. Invalid match suffixes are
 * rejected as a whole; they never degrade into a different address. */
export function parseArtifactSubLocation(subId: string | undefined): ArtifactSubLocation | undefined {
  if (subId === undefined) return {}

  if (subId.startsWith('match/')) {
    const key = subId.slice('match/'.length)
    const target = parseArtifactSearchTarget(key)
    return target ? { match: key } : undefined
  }

  if (!subId.startsWith('history/')) return undefined
  const rest = subId.slice('history/'.length)
  const [revisionText, marker, field, ...extra] = rest.split('/')
  const revision = artifactHistoryRevision(revisionText)
  if (revision === undefined) return undefined
  if (marker === undefined) return { revision }
  if (marker !== 'match' || !field || extra.length) return undefined
  const key = `${revision}/${field}`
  const target = parseArtifactSearchTarget(key)
  return target?.revision === revision ? { revision, match: key } : undefined
}

/** Build a canonical subId for a current or retained artifact match. */
export function artifactSubLocationKey(location: ArtifactSubLocation): string | undefined {
  const revision = location.revision
  const match = location.match === undefined ? undefined : parseArtifactSearchTarget(location.match)
  if (location.match !== undefined && (!match || (revision !== undefined && match.revision !== revision))) return undefined
  if (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 0)) return undefined
  if (revision !== undefined) return `history/${revision}${match ? `/match/${match.field}` : ''}`
  return match ? `match/${match.revision}/${match.field}` : undefined
}
