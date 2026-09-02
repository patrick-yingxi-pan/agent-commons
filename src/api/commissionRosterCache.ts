/** Shared non-rewinding projection for one addressed Contributor across the
 * project roster and the optional account-wide roster cache. */
import type { Commission } from '../../contract/index.ts'
import { mutate, peek } from './cache.ts'
import { keys } from './keys.ts'
import { mergeCommissionConfiguration } from './commissionRevision.ts'

export function mergeCommissionIntoCachedRosters(commission: Commission, projectId: string): void {
  for (const key of [keys.commissions(projectId), keys.commissions()]) {
    if (!peek<Commission[]>(key)) continue
    mutate<Commission[]>(key, (current) => {
      const rows = current ?? []
      const existing = rows.find((row) => row.id === commission.id)
      if (!existing) return [...rows, commission]
      const merged = mergeCommissionConfiguration(existing, commission)
      return rows.map((row) => row.id === commission.id ? merged : row)
    })
  }
}
