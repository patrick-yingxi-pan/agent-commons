import type { Commission } from '../../contract/index.ts'
import { shouldAcceptEntityRevision } from './entityRevision.ts'

/** Choose the freshest configuration projection across independently populated
 * roster caches. A concrete revision outranks a legacy unrevisioned row. */
export function newestCommissionConfiguration(
  ...candidates: Array<Commission | undefined>
): Commission | undefined {
  let newest: Commission | undefined
  for (const candidate of candidates) {
    if (!candidate) continue
    const candidateRevision = candidate.configurationRevision ?? -1
    const newestRevision = newest?.configurationRevision ?? -1
    if (!newest || candidateRevision > newestRevision) newest = candidate
  }
  return newest
}

/** Merge only editable contributor configuration. Identity and the forward
 * reservation projection can move independently and survive delayed replies. */
export function mergeCommissionConfiguration(current: Commission, incoming: Commission): Commission {
  if (!shouldAcceptEntityRevision(current.configurationRevision, incoming.configurationRevision)) return current
  return {
    ...current,
    role: incoming.role,
    authority: incoming.authority,
    grant: incoming.grant,
    standing: incoming.standing,
    configurationRevision: incoming.configurationRevision,
  }
}
