import {
  parseArtifactHistoryBody,
  historyBodyWithoutRevision,
  parseArtifactHistoryVersion,
  type ArtifactHistoryReason,
  type ArtifactHistoryVersion,
} from '../contract/artifactHistory.ts'
import type { ArtifactContent } from '../contract/content.ts'

function sameHistoryBody(left: unknown, right: unknown): boolean {
  const canonicalLeft = parseArtifactHistoryBody(left)
  const canonicalRight = parseArtifactHistoryBody(right)
  return canonicalLeft !== undefined && canonicalRight !== undefined &&
    JSON.stringify(canonicalLeft) === JSON.stringify(canonicalRight)
}

export interface StoredArtifactHistoryRestoreReceipt {
  tenantId: string
  userId: string
  artifactId: string
  keyHash: string
  sourceRevision: number
  expectedRevision: number
  restoredRevision: number
}

export function prepareArtifactHistoryAppend(
  id: string,
  priorBody: ArtifactContent,
  updatedBody: ArtifactContent,
  savedAt: string,
  reason: Exclude<ArtifactHistoryReason, 'baseline'> = 'edit',
  restoredFromRevision?: number,
  existing?: ArtifactHistoryVersion[],
): ArtifactHistoryVersion[] {
  const priorRevision = priorBody.revision ?? 0
  const updatedRevision = updatedBody.revision ?? 0
  if (!id || updatedRevision !== priorRevision + 1 ||
    (reason === 'restore' ? !Number.isSafeInteger(restoredFromRevision) || restoredFromRevision! < 0 || restoredFromRevision! >= updatedRevision : restoredFromRevision !== undefined)) {
    throw new TypeError('Artifact history append does not match the next body revision.')
  }
  const prior = historyBodyWithoutRevision(priorBody)
  const updated = historyBodyWithoutRevision(updatedBody)
  if (!prior || !updated) throw new TypeError('Artifact body is not valid bounded history content.')
  let versions = existing ? [...existing] : []
  if (versions.length === 0) {
    versions.push({ revision: priorRevision, savedAt: null, reason: 'baseline', body: prior })
  } else {
    const latest = versions.at(-1)!
    if (latest.revision !== priorRevision || !sameHistoryBody(latest.body, prior)) {
      throw new TypeError('Artifact history does not match its current body.')
    }
  }
  const next = parseArtifactHistoryVersion({
    revision: updatedRevision,
    savedAt,
    reason,
    ...(reason === 'restore' ? { restoredFromRevision: restoredFromRevision! } : {}),
    body: updated,
  })
  const restoreSource = reason === 'restore'
    ? versions.find((version) => version.revision === restoredFromRevision)
    : undefined
  if (!next || (reason === 'restore' && (!restoreSource || !sameHistoryBody(next.body, restoreSource.body)))) {
    if (reason === 'restore' && restoreSource && next) {
      throw new TypeError('Artifact history restore body must exactly match its retained source version.')
    }
    throw new TypeError('Artifact history version is invalid.')
  }
  versions.push(next)
  return versions
}
