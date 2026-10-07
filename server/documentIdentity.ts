import { createHash } from 'node:crypto'
import { historyBodyWithoutRevision } from '../contract/artifactHistory.ts'
import type { ArtifactContent } from '../contract/content.ts'

/** Deterministic identity for a Document block when a body first receives stable IDs.
 *  Revision is part of the input intentionally: legacy revisions do not prove block
 *  continuity, even when their text or ordinal happens to match. */
export function docBlockId(artifactId: string, revision: number, index: number): string {
  if (typeof artifactId !== 'string' || artifactId.length === 0 ||
    !Number.isSafeInteger(revision) || revision < 0 ||
    !Number.isSafeInteger(index) || index < 0) {
    throw new TypeError('Document block identity inputs are invalid.')
  }
  const digest = createHash('sha256')
    .update(JSON.stringify([artifactId, revision, index]))
    .digest('hex')
    .slice(0, 32)
  return `block-${digest}`
}

/** Validate and detach a Document body, assigning deterministic IDs only to a wholly
 *  legacy (no-ID) body. Existing IDs are authoritative: malformed, duplicate, or
 *  mixed identity state fails closed instead of being silently rewritten. */
export function identifyDocumentBody(artifactId: string, body: ArtifactContent): ArtifactContent {
  if (body.type !== 'doc') return body
  if (typeof artifactId !== 'string' || artifactId.length === 0) {
    throw new TypeError('Document identity requires an Artifact id.')
  }

  const parsed = historyBodyWithoutRevision(body)
  if (!parsed || parsed.type !== 'doc') throw new TypeError('Document body is invalid.')
  const revision = body.revision ?? 0
  if (!Number.isSafeInteger(revision) || revision < 0) throw new TypeError('Document revision is invalid.')
  // Shared admission already proves all-or-none, valid, unique identity.
  const blocks = parsed.blocks[0]?.id !== undefined ? parsed.blocks :
    parsed.blocks.map((block, index) => ({ ...block, id: docBlockId(artifactId, revision, index) }))

  return {
    ...parsed,
    blocks,
    ...(body.revision === undefined ? {} : { revision: body.revision }),
  } as ArtifactContent
}
