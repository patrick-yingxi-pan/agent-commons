import type {
  ArtifactLifecycleRequest,
  ArtifactLifecycleSnapshot,
  ArtifactLifecycleState,
  TrashedArtifact,
} from '../../contract/artifactLifecycle.ts'
import type { ArtifactItem } from '../../contract/cowork.ts'
import type { RelationGraph } from '../../contract/api.ts'
import { ApiRequestError, apiGet, apiPatch } from './client.ts'
import { evict, invalidate, invalidatePrefix, peek, setData, useQuery, type QueryState } from './cache.ts'
import { keys, paths } from './keys.ts'
import { mergeArtifactMetadata } from './artifactMetadata.ts'
import { isArtifactPermanentlyAbsent, markArtifactPermanentlyAbsent } from './artifactPermanentAbsences.ts'

/** Lifecycle revision is independent of metadata and body revisions. A delayed
 * read or acknowledgement may refresh other fields, but cannot rewind it. */
export function mergeArtifactLifecycleSnapshot(
  current: ArtifactLifecycleSnapshot | undefined,
  incoming: ArtifactLifecycleSnapshot,
): ArtifactLifecycleSnapshot {
  if (current && incoming.lifecycle.revision < current.lifecycle.revision) return current
  // Lifecycle responses also carry the canonical row. Merge its independent
  // display-name revision so a delayed snapshot cannot undo a later rename.
  const lifecycle = !current || incoming.lifecycle.revision > current.lifecycle.revision
    ? incoming.lifecycle
    : current.lifecycle
  return {
    artifact: {
      ...(current ? mergeArtifactMetadata(current.artifact, incoming.artifact) : incoming.artifact),
      lifecycleRevision: lifecycle.revision,
    },
    lifecycle,
  }
}

function projectAcceptedArtifactLifecycle(snapshot: ArtifactLifecycleSnapshot): void {
  const id = snapshot.artifact.id
  const row = {
    ...snapshot.artifact,
    lifecycleRevision: snapshot.lifecycle.revision,
  }

  const active = peek<ArtifactItem[]>(keys.artifacts)
  if (active) {
    const next = active.filter((artifact) => artifact.id !== id)
    if (snapshot.lifecycle.state === 'active') next.unshift(row)
    setData(keys.artifacts, next)
  }

  const trash = peek<TrashedArtifact[]>(keys.artifactTrash)
  if (trash) {
    const next = trash.filter((entry) => entry.artifact.id !== id)
    if (snapshot.lifecycle.state === 'trashed') {
      next.unshift({ artifact: row, trashedAt: snapshot.lifecycle.changedAt })
    }
    setData(keys.artifactTrash, next)
  }

  const graph = peek<RelationGraph>(keys.relations)
  if (graph) {
    const withoutArtifact = graph.extraArtifacts.filter((artifact) => artifact.id !== id)
    const extraArtifacts = snapshot.lifecycle.state === 'trashed'
      ? withoutArtifact
      : graph.extraArtifacts.map((artifact) => artifact.id === id ? row : artifact)
    if (snapshot.lifecycle.state === 'trashed') {
      const artifactProject = { ...graph.artifactProject }
      const artifactSource = { ...graph.artifactSource }
      delete artifactProject[id]
      delete artifactSource[id]
      setData(keys.relations, { ...graph, extraArtifacts, artifactProject, artifactSource })
    } else if (graph.extraArtifacts.some((artifact) => artifact.id === id)) {
      // A restore only refreshes rows that are already in this cached graph;
      // it never invents a saved-artifact row or graph edge locally.
      setData(keys.relations, { ...graph, extraArtifacts })
    }
  }
}

function acceptArtifactLifecycleSnapshot(incoming: ArtifactLifecycleSnapshot): ArtifactLifecycleSnapshot {
  if (isArtifactPermanentlyAbsent(incoming.artifact.id)) return incoming
  const key = keys.artifactLifecycle(incoming.artifact.id)
  const activeRows = peek<ArtifactItem[]>(keys.artifacts) ?? []
  const graphRows = peek<RelationGraph>(keys.relations)?.extraArtifacts ?? []
  const trashEntries = peek<TrashedArtifact[]>(keys.artifactTrash) ?? []
  const candidates = [
    ...activeRows,
    ...graphRows,
    ...trashEntries.map((entry) => entry.artifact),
  ].filter((artifact) => artifact.id === incoming.artifact.id)
  const knownRow = candidates.reduce<ArtifactItem | undefined>((best, row) =>
    !best || (row.lifecycleRevision ?? 0) > (best.lifecycleRevision ?? 0) ? row : best, undefined)
  let knownSnapshot = peek<ArtifactLifecycleSnapshot>(key)
  if (knownRow && (knownRow.lifecycleRevision ?? 0) > (knownSnapshot?.lifecycle.revision ?? -1)) {
    const revision = knownRow.lifecycleRevision ?? 0
    const trashedAt = trashEntries.find((entry) => entry.artifact.id === knownRow.id)?.trashedAt
    knownSnapshot = {
      artifact: knownRow,
      lifecycle: {
        state: revision % 2 === 1 ? 'trashed' : 'active',
        revision,
        changedAt: trashedAt ?? 0,
      },
    }
  }
  let accepted = mergeArtifactLifecycleSnapshot(knownSnapshot, incoming)
  if (knownRow) {
    accepted = {
      ...accepted,
      artifact: {
        ...mergeArtifactMetadata(knownRow, accepted.artifact),
        lifecycleRevision: accepted.lifecycle.revision,
      },
    }
  }
  setData(key, accepted)
  projectAcceptedArtifactLifecycle(accepted)
  return accepted
}

/** The owner-only list of retained artifacts. */
export function useTrashedArtifacts(enabled = true): QueryState<TrashedArtifact[]> {
  return useQuery(keys.artifactTrash, async () =>
    (await apiGet<TrashedArtifact[]>(paths.artifactTrash)).filter((entry) => !isArtifactPermanentlyAbsent(entry.artifact.id)), enabled)
}

/** One artifact's canonical row plus its independent, monotonically ordered
 * lifecycle state. Disabled until the detail or confirmation UI needs it. */
export function useArtifactLifecycle(id: string, enabled = true): QueryState<ArtifactLifecycleSnapshot> {
  return useQuery(
    keys.artifactLifecycle(id),
    async () => {
      const incoming = await apiGet<ArtifactLifecycleSnapshot>(paths.artifactLifecycle(id))
      if (isArtifactPermanentlyAbsent(id)) throw new ApiRequestError('not_found', 'Artifact was permanently deleted.', 404)
      return acceptArtifactLifecycleSnapshot(mergeArtifactLifecycleSnapshot(
        peek<ArtifactLifecycleSnapshot>(keys.artifactLifecycle(id)), incoming,
      ))
    },
    !!id && enabled,
  )
}

/** Read the exact lifecycle snapshot for controller admission and reconciliation. */
export async function getArtifactLifecycle(id: string, sourceUserId?: string | null): Promise<ArtifactLifecycleSnapshot> {
  if (isArtifactPermanentlyAbsent(id)) throw new ApiRequestError('not_found', 'Artifact was permanently deleted.', 404)
  const incoming = await apiGet<ArtifactLifecycleSnapshot>(paths.artifactLifecycle(id), { expectedSessionUserId: sourceUserId })
  if (isArtifactPermanentlyAbsent(id)) throw new ApiRequestError('not_found', 'Artifact was permanently deleted.', 404)
  return acceptArtifactLifecycleSnapshot(incoming)
}

function refreshArtifactLifecycleProjections(id: string, refreshLifecycle = true): void {
  invalidate(keys.artifacts)
  invalidate(keys.relations)
  invalidate(keys.artifactContent)
  invalidate(keys.artifactTrash)
  if (refreshLifecycle) invalidate(keys.artifactLifecycle(id))
  invalidate(keys.commons)
  invalidatePrefix(keys.grants())
  invalidatePrefix(keys.discussions())
  invalidatePrefix(keys.discussion())
  invalidatePrefix('social-capability')
  invalidatePrefix(keys.socialProposals())
  invalidatePrefix(keys.socialProposal())
  invalidatePrefix(keys.ownerProfile())
  invalidatePrefix(keys.search())
  invalidate(keys.notifications)
}

/** Apply a compare-and-swap lifecycle transition. Only the exact revision
 * represented by this request is an acknowledgement for its logical intent. */
export async function transitionArtifactLifecycle(
  id: string,
  request: ArtifactLifecycleRequest,
  idempotencyKey: string,
  sourceUserId: string | null,
): Promise<ArtifactLifecycleSnapshot> {
  const snapshot = await apiPatch<ArtifactLifecycleSnapshot>(
    paths.artifactLifecycle(id),
    request,
    { idempotencyKey, expectedSessionUserId: sourceUserId },
  )
  const expectedAcknowledgement = request.expectedRevision + 1
  if (snapshot.artifact.id !== id || snapshot.lifecycle.state !== request.state ||
    snapshot.lifecycle.revision !== expectedAcknowledgement) {
    // A later lifecycle cycle cannot prove this earlier user's intent landed.
    refreshArtifactLifecycleProjections(id)
    throw new Error('Artifact lifecycle changed again before this action was confirmed.')
  }
  const accepted = acceptArtifactLifecycleSnapshot(snapshot)
  refreshArtifactLifecycleProjections(id)
  if (accepted.lifecycle.state !== request.state || accepted.lifecycle.revision !== expectedAcknowledgement) {
    throw new Error('A newer artifact lifecycle state replaced this acknowledgement.')
  }
  return accepted
}

/** An uncertain PATCH is settled only by this exact immediately represented
 * transition. A later cycle is a conflict and must remain available to review. */
export async function reconcileArtifactLifecycle(
  id: string,
  state: ArtifactLifecycleState,
  expectedRevision: number,
  sourceUserId: string | null,
): Promise<boolean> {
  let current: ArtifactLifecycleSnapshot
  try {
    current = await getArtifactLifecycle(id, sourceUserId)
  } catch (error) {
    // A typed owner-only not-found is authoritative absence. Dismiss may drop
    // an action for a row that no longer exists; transport failures retain it.
    if (error instanceof ApiRequestError && error.status === 404) return false
    throw error
  }
  refreshArtifactLifecycleProjections(id)
  return current.artifact.id === id && current.lifecycle.state === state &&
    current.lifecycle.revision === expectedRevision + 1
}

/** Revalidate the canonical and derived projections after an authoritative
 * lifecycle event received outside the originating command. */
export function invalidateArtifactLifecycle(id: string): void {
  refreshArtifactLifecycleProjections(id)
}

/** Permanent deletion is authoritative absence, not a trashed lifecycle state.
 *  Drop the old snapshot before refreshing every derived projection. */
export function acceptArtifactLifecycleAbsence(id: string): void {
  markArtifactPermanentlyAbsent(id)
  evict(keys.artifactLifecycle(id))
  refreshArtifactLifecycleProjections(id, false)
}

/** Publish an ambient/event snapshot without allowing a stale event to rewind
 * a read or acknowledgement already accepted for this artifact. */
export function acceptArtifactLifecycle(incoming: ArtifactLifecycleSnapshot): ArtifactLifecycleSnapshot {
  return acceptArtifactLifecycleSnapshot(incoming)
}

export function peekArtifactLifecycle(id: string): ArtifactLifecycleSnapshot | undefined {
  return peek<ArtifactLifecycleSnapshot>(keys.artifactLifecycle(id))
}

/** A live list/graph response can lag the lifecycle acknowledgement. Compare
 * both durable revisions; parity records the alternating lifecycle state on
 * each Artifact row, while an exact snapshot supplies the canonical value. */
export function artifactLifecycleIsActive(
  artifact: ArtifactItem,
  knownSnapshot: ArtifactLifecycleSnapshot | undefined,
): boolean {
  if (isArtifactPermanentlyAbsent(artifact.id)) return false
  const rowRevision = artifact.lifecycleRevision ?? 0
  if (knownSnapshot && knownSnapshot.lifecycle.revision >= rowRevision) {
    return knownSnapshot.lifecycle.state === 'active'
  }
  return rowRevision % 2 === 0
}

export function isArtifactLifecycleActive(artifact: ArtifactItem): boolean {
  return artifactLifecycleIsActive(artifact, peekArtifactLifecycle(artifact.id))
}
