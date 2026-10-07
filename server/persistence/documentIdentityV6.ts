import { historyBodyWithoutRevision, parseArtifactHistoryEntries, type ArtifactHistoryVersion } from '../../contract/artifactHistory.ts'
import type { ArtifactContent } from '../../contract/content.ts'
import { identifyDocumentBody } from '../documentIdentity.ts'
import type { PersistedState } from './format.ts'

function documentAtRevision(artifactId: string, body: ArtifactContent, revision: number): ArtifactContent {
  if (body.type !== 'doc') return body
  return identifyDocumentBody(artifactId, { ...body, revision } as ArtifactContent)
}

function historyBody(body: ArtifactContent): NonNullable<ReturnType<typeof historyBodyWithoutRevision>> {
  const parsed = historyBodyWithoutRevision(body)
  if (!parsed) throw new TypeError('Document identity migration encountered an invalid artifact body.')
  return parsed
}

function identifyHistory(artifactId: string, versions: ArtifactHistoryVersion[]): ArtifactHistoryVersion[] {
  const identified: ArtifactHistoryVersion[] = []
  for (const version of versions) {
    const body = version.body
    if (body.type !== 'doc') {
      identified.push({ ...version, body })
      continue
    }

    if (version.reason === 'restore') {
      const source = identified.find((candidate) => candidate.revision === version.restoredFromRevision)
      if (!source) throw new TypeError('Document identity migration restore source is missing.')
      // A restore is the one event that explicitly proves identity with its source.
      // Reuse the source's already identified body rather than minting IDs for this
      // revision or guessing continuity from matching indexes/text.
      identified.push({ ...version, body: source.body })
      continue
    }

    const withRevision = { ...body, revision: version.revision } as ArtifactContent
    const identifiedBody = documentAtRevision(artifactId, withRevision, version.revision)
    identified.push({ ...version, body: historyBody(identifiedBody) })
  }
  return identified
}

/** Pure v5 → v6 transform: give retained legacy Document versions deterministic,
 *  revision-local identities. Numeric legacy discussion/proposal loci are purposely
 *  left untouched; old indexes are not proof of stable block identity. */
export function migrateDocumentIdentityV6(state: PersistedState): PersistedState {
  const bodies = state.artifactBodies ?? []
  const originalCurrent = new Map<string, ArtifactContent>()
  for (const entry of bodies) {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || !entry[0] ||
      originalCurrent.has(entry[0])) throw new TypeError('Document identity migration found malformed artifact bodies.')
    originalCurrent.set(entry[0], entry[1])
  }

  const parsedHistory = parseArtifactHistoryEntries(state.artifactHistory ?? [])
  const histories = new Map<string, ArtifactHistoryVersion[]>()
  for (const [artifactId, versions] of parsedHistory) {
    const current = originalCurrent.get(artifactId)
    const latest = versions.at(-1)!
    if (!current || (current.revision ?? 0) !== latest.revision ||
      JSON.stringify(historyBody(current)) !== JSON.stringify(latest.body)) {
      throw new TypeError('Document identity migration requires current body to match latest history.')
    }
    histories.set(artifactId, identifyHistory(artifactId, versions))
  }

  const migratedBodies: Array<[string, ArtifactContent]> = bodies.map(([artifactId, body]) => {
    const versions = histories.get(artifactId)
    if (!versions) return [artifactId, identifyDocumentBody(artifactId, body)] as [string, ArtifactContent]
    const latest = versions.at(-1)!
    if (body.type !== 'doc' || latest.body.type !== 'doc') return [artifactId, body] as [string, ArtifactContent]
    // The pre-migration exact equality check established this current body is the
    // latest historical body. Preserve current revision metadata, but use the single
    // canonical migrated identity array retained by history.
    return [artifactId, { ...body, blocks: latest.body.blocks } as ArtifactContent]
  })

  return {
    ...state,
    ...(state.artifactBodies === undefined ? {} : { artifactBodies: migratedBodies }),
    ...(state.artifactHistory === undefined ? {} : { artifactHistory: [...histories.entries()] }),
  }
}
