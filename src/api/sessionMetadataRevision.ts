import type { Session } from '../../contract/index.ts'

/** Whether an acknowledged metadata projection can replace the cache's row.
 * Legacy unrevisioned servers remain mutually compatible, but an unrevisioned
 * or older replay can never rewind a revisioned projection. */
export function shouldAcceptSessionMetadata(
  current: Pick<Session, 'metadataRevision'>,
  incoming: Pick<Session, 'metadataRevision'>,
): boolean {
  if (incoming.metadataRevision === undefined) return current.metadataRevision === undefined
  if (current.metadataRevision === undefined) return true
  return incoming.metadataRevision >= current.metadataRevision
}
