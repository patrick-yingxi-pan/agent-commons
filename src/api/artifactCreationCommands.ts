import type { ArtifactItem, CreateArtifactRequest, CreateArtifactResponse, RelationGraph } from '../../contract/index.ts'
import { apiGet, apiPost, ApiRequestError, AccountSwitchedError } from './client.ts'
import { accountGeneration, activeAccount } from './account.ts'
import { invalidate, invalidatePrefix, mutate, peek, setData } from './cache.ts'
import { keys, paths } from './keys.ts'
import { shouldAcceptRelationGraph } from './relationRevision.ts'
import { artifactCreationId } from './artifactCreationIdentity.ts'

export interface ArtifactCreationIntent {
  readonly tenantId: string
  /** Frozen at activation, before a different tab can replace the shared cookie. */
  readonly sourceUserId: string | null
  readonly intentId: string
  readonly request: CreateArtifactRequest
}

function assertScope(intent: ArtifactCreationIntent, issuedGeneration: number): void {
  const account = activeAccount()
  if (issuedGeneration !== accountGeneration() || (account && account.tenantId !== intent.tenantId)) {
    throw new AccountSwitchedError('artifact creation identity changed')
  }
}

/** An existing row can contain independently newer name, filing, and synopsis
 * data. Admit a new exact identity immediately; otherwise let fresh reads heal. */
export function rememberCreatedArtifact(artifact: ArtifactItem): void {
  mutate<ArtifactItem[]>(keys.artifacts, (current) => {
    const rows = current ?? []
    return rows.some((row) => row.id === artifact.id) ? rows : [...rows, artifact]
  })
  invalidate(keys.artifacts)
  invalidate(keys.relations)
  invalidate(keys.artifactContent)
  invalidatePrefix(keys.search())
  invalidatePrefix(keys.ownerProfile())
}

export async function applyArtifactCreation(intent: ArtifactCreationIntent, idempotencyKey: string): Promise<void> {
  const issuedGeneration = accountGeneration()
  const expectedId = await artifactCreationId(intent.tenantId, idempotencyKey)
  assertScope(intent, issuedGeneration)
  const created = await apiPost<CreateArtifactResponse>(paths.artifacts, intent.request, {
    idempotencyKey, expectedSessionUserId: intent.sourceUserId,
  })
  if (created.artifact.id !== expectedId || created.artifact.own !== true) throw new Error('Unexpected artifact creation identity.')
  if (shouldAcceptRelationGraph(peek<RelationGraph>(keys.relations), created.graph)) setData(keys.relations, created.graph)
  rememberCreatedArtifact(created.artifact)
}

/** Only the addressed owned row can prove this logical creation. No mutable
 * name/content matching or arbitrary collection arrival may settle uncertainty. */
export async function reconcileArtifactCreation(intent: ArtifactCreationIntent, idempotencyKey: string): Promise<boolean> {
  const issuedGeneration = accountGeneration()
  const expectedId = await artifactCreationId(intent.tenantId, idempotencyKey)
  assertScope(intent, issuedGeneration)
  let artifact: ArtifactItem
  try {
    artifact = await apiGet<ArtifactItem>(paths.artifact(expectedId))
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) return false
    throw error
  }
  if (artifact.id !== expectedId || artifact.own !== true) return false
  rememberCreatedArtifact(artifact)
  return true
}
