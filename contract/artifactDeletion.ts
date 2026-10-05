/** Permanent Artifact deletion is a separate reviewed act from reversible Trash. */

export interface ArtifactDeletionCascadeCounts {
  versions: number
  shares: number
  discussions: number
  proposals: number
}

export interface ArtifactDeletionPreview {
  artifactId: string
  artifactName: string
  lifecycleRevision: number
  /** Opaque compare token for the complete cascade shown by this preview. */
  reviewToken: string
  counts: ArtifactDeletionCascadeCounts
}

export interface ArtifactDeletionRequest {
  expectedLifecycleRevision: number
  reviewToken: string
}

export interface ArtifactDeletionResult {
  artifactId: string
  deleted: true
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isRevision = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

export function parseArtifactDeletionPreview(value: unknown): ArtifactDeletionPreview | undefined {
  if (!isRecord(value) || Object.keys(value).sort().join(',') !== 'artifactId,artifactName,counts,lifecycleRevision,reviewToken' ||
    typeof value.artifactId !== 'string' || !value.artifactId ||
    typeof value.artifactName !== 'string' || !value.artifactName ||
    !isRevision(value.lifecycleRevision) || typeof value.reviewToken !== 'string' || !/^[0-9a-f]{64}$/.test(value.reviewToken) ||
    !isRecord(value.counts) || Object.keys(value.counts).sort().join(',') !== 'discussions,proposals,shares,versions' ||
    !isRevision(value.counts.versions) || !isRevision(value.counts.shares) ||
    !isRevision(value.counts.discussions) || !isRevision(value.counts.proposals)) return undefined
  return {
    artifactId: value.artifactId,
    artifactName: value.artifactName,
    lifecycleRevision: value.lifecycleRevision,
    reviewToken: value.reviewToken,
    counts: {
      versions: value.counts.versions,
      shares: value.counts.shares,
      discussions: value.counts.discussions,
      proposals: value.counts.proposals,
    },
  }
}

export function parseArtifactDeletionRequest(value: unknown): ArtifactDeletionRequest | undefined {
  if (!isRecord(value) || Object.keys(value).sort().join(',') !== 'expectedLifecycleRevision,reviewToken' ||
    !isRevision(value.expectedLifecycleRevision) || typeof value.reviewToken !== 'string' || !/^[0-9a-f]{64}$/.test(value.reviewToken)) return undefined
  return { expectedLifecycleRevision: value.expectedLifecycleRevision, reviewToken: value.reviewToken }
}

export function parseArtifactDeletionResult(value: unknown): ArtifactDeletionResult | undefined {
  if (!isRecord(value) || Object.keys(value).sort().join(',') !== 'artifactId,deleted' ||
    typeof value.artifactId !== 'string' || !value.artifactId || value.deleted !== true) return undefined
  return { artifactId: value.artifactId, deleted: true }
}
