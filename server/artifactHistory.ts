import {
  historyBodyWithoutRevision,
  parseArtifactHistoryVersion,
  type ArtifactHistoryReason,
  type ArtifactHistoryVersion,
} from '../contract/artifactHistory.ts'
import type { ArtifactContent } from '../contract/content.ts'

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
    if (latest.revision !== priorRevision || JSON.stringify(latest.body) !== JSON.stringify(prior)) {
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
  if (!next || (reason === 'restore' && !versions.some((version) => version.revision === restoredFromRevision))) {
    throw new TypeError('Artifact history version is invalid.')
  }
  versions.push(next)
  return versions
}
