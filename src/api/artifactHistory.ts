import {
  parseArtifactHistoryPage,
  parseArtifactHistoryVersionResult,
  type ArtifactHistoryPage,
  type ArtifactHistoryVersionResult,
  type RestoreArtifactHistoryRequest,
  type RestoreArtifactHistoryResult,
} from '../../contract/artifactHistory.ts'
import { apiGet, apiPost } from './client.ts'
import { invalidate, invalidatePrefix, useQuery, type QueryState } from './cache.ts'
import { artifactHistoryKey } from './artifactHistoryKeys.ts'
import { paths } from './keys.ts'

function requirePage(value: unknown, artifactId: string): ArtifactHistoryPage {
  const page = parseArtifactHistoryPage(value)
  if (!page || page.artifactId !== artifactId) throw new TypeError('Artifact history response did not match the requested artifact.')
  return page
}

function requireVersion(value: unknown, artifactId: string, revision: number): ArtifactHistoryVersionResult {
  const result = parseArtifactHistoryVersionResult(value)
  if (!result || result.artifactId !== artifactId || result.version.revision !== revision) {
    throw new TypeError('Artifact history response did not match the requested version.')
  }
  return result
}

export function useArtifactHistory(artifactId: string, beforeRevision?: number, enabled = true): QueryState<ArtifactHistoryPage> {
  const key = `${artifactHistoryKey(artifactId)}:${beforeRevision ?? 'newest'}`
  return useQuery(key, async () => requirePage(
    await apiGet<unknown>(paths.artifactHistory(artifactId, beforeRevision)), artifactId,
  ), Boolean(artifactId) && enabled)
}

export function useArtifactHistoryVersion(
  artifactId: string,
  revision: number | undefined,
): QueryState<ArtifactHistoryVersionResult> {
  const key = `${artifactHistoryKey(artifactId)}:version:${revision ?? 'none'}`
  return useQuery(key, async () => requireVersion(
    await apiGet<unknown>(paths.artifactHistoryVersion(artifactId, revision!)), artifactId, revision!,
  ), Boolean(artifactId) && revision !== undefined)
}

export async function readArtifactHistory(artifactId: string, beforeRevision?: number): Promise<ArtifactHistoryPage> {
  return requirePage(await apiGet<unknown>(paths.artifactHistory(artifactId, beforeRevision)), artifactId)
}

export async function readArtifactHistoryVersion(artifactId: string, revision: number): Promise<ArtifactHistoryVersionResult> {
  return requireVersion(await apiGet<unknown>(paths.artifactHistoryVersion(artifactId, revision)), artifactId, revision)
}

export async function restoreArtifactHistoryVersion(
  artifactId: string,
  revision: number,
  request: RestoreArtifactHistoryRequest,
  idempotencyKey: string,
  sourceUserId: string | null,
): Promise<RestoreArtifactHistoryResult> {
  const response = parseArtifactHistoryVersionResult(await apiPost<unknown>(
    paths.artifactHistoryRestore(artifactId, revision), request,
    { idempotencyKey, expectedSessionUserId: sourceUserId },
  ))
  const result = response && response.artifactId === artifactId ? response : undefined
  if (!result || result.version.revision !== request.expectedRevision + 1 ||
    result.currentRevision < request.expectedRevision ||
    result.version.reason !== 'restore' || result.version.restoredFromRevision !== revision) {
    throw new TypeError('Artifact history restore response did not acknowledge the reviewed restore.')
  }
  invalidatePrefix(artifactHistoryKey(artifactId))
  return result
}

export function invalidateArtifactHistory(artifactId: string): void {
  invalidatePrefix(artifactHistoryKey(artifactId))
}

export function invalidateArtifactHistoryVersion(artifactId: string, revision: number): void {
  invalidate(`${artifactHistoryKey(artifactId)}:version:${revision}`)
}
