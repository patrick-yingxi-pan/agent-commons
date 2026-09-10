import {
  DEFAULT_MODEL_PREFERENCES,
  parseModelPreferences,
  type ModelPreferences,
  type ViewerModelPreferences,
} from '../contract/modelPreferences.ts'
import { ConflictError } from './conflict.ts'

export type PersistedModelPreferences = [string, [string, { revision: number; preferences: ModelPreferences }][]][]

const byTenant = new Map<string, Map<string, { revision: number; preferences: ModelPreferences }>>()

const copyPreferences = (preferences: ModelPreferences): ModelPreferences => ({ ...preferences })
const samePreferences = (left: ModelPreferences, right: ModelPreferences): boolean =>
  left.providerId === right.providerId && left.modelId === right.modelId && left.effort === right.effort &&
  left.ultracode === right.ultracode && left.fast === right.fast

export function getModelPreferences(tenantId: string, userId: string): ViewerModelPreferences {
  const stored = byTenant.get(tenantId)?.get(userId)
  return {
    tenantId,
    userId,
    revision: stored?.revision ?? 0,
    preferences: copyPreferences(stored?.preferences ?? DEFAULT_MODEL_PREFERENCES),
  }
}

export function setModelPreferences(
  tenantId: string,
  userId: string,
  expectedTenantId: string,
  expectedUserId: string,
  expectedRevision: number,
  preferences: ModelPreferences,
): { value: ViewerModelPreferences; changed: boolean } {
  if (expectedTenantId !== tenantId || expectedUserId !== userId) {
    throw new ConflictError('The active account or workspace changed before model preferences were saved.')
  }
  const current = getModelPreferences(tenantId, userId)
  if (expectedRevision !== current.revision) {
    throw new ConflictError(`Model preferences changed elsewhere (expected revision ${expectedRevision}, current revision ${current.revision}).`)
  }
  const parsed = parseModelPreferences(preferences)
  if (!parsed) throw new TypeError('Model preferences are invalid.')
  if (samePreferences(current.preferences, parsed)) return { value: current, changed: false }
  if (!Number.isSafeInteger(current.revision + 1)) {
    throw new ConflictError('Model preference revision is exhausted and cannot advance safely.')
  }
  let users = byTenant.get(tenantId)
  if (!users) {
    users = new Map()
    byTenant.set(tenantId, users)
  }
  const next = { revision: current.revision + 1, preferences: parsed }
  users.set(userId, next)
  return { value: getModelPreferences(tenantId, userId), changed: true }
}

export function persistedModelPreferences(): PersistedModelPreferences {
  return [...byTenant.entries()].map(([tenantId, users]) => [
    tenantId,
    [...users.entries()].map(([userId, row]) => [userId, {
      revision: row.revision,
      preferences: copyPreferences(row.preferences),
    }]),
  ])
}

export function parsePersistedModelPreferences(value: unknown): PersistedModelPreferences {
  if (!Array.isArray(value)) throw new TypeError('Persisted model preferences must be tenant entries.')
  const result: PersistedModelPreferences = []
  const tenants = new Set<string>()
  for (const tenantEntry of value) {
    if (!Array.isArray(tenantEntry) || tenantEntry.length !== 2 || typeof tenantEntry[0] !== 'string' ||
        !tenantEntry[0] || tenantEntry[0].length > 256 || tenantEntry[0].trim() !== tenantEntry[0] ||
        !Array.isArray(tenantEntry[1]) || tenants.has(tenantEntry[0])) {
      throw new TypeError('Persisted model preference tenant entry is invalid.')
    }
    tenants.add(tenantEntry[0])
    const users = new Set<string>()
    const userRows: PersistedModelPreferences[number][1] = []
    for (const userEntry of tenantEntry[1]) {
      if (!Array.isArray(userEntry) || userEntry.length !== 2 || typeof userEntry[0] !== 'string' ||
          !userEntry[0] || userEntry[0].length > 256 || userEntry[0].trim() !== userEntry[0] || users.has(userEntry[0]) ||
          !userEntry[1] || typeof userEntry[1] !== 'object' || Array.isArray(userEntry[1]) ||
          Object.getPrototypeOf(userEntry[1]) !== Object.prototype ||
          Object.keys(userEntry[1]).length !== 2 || !Object.hasOwn(userEntry[1], 'revision') ||
          !Object.hasOwn(userEntry[1], 'preferences')) {
        throw new TypeError('Persisted model preference user entry is invalid.')
      }
      const row = userEntry[1] as Record<string, unknown>
      const preferences = parseModelPreferences(row.preferences)
      if (!Number.isSafeInteger(row.revision) || (row.revision as number) < 1 || !preferences) {
        throw new TypeError('Persisted model preference row is invalid.')
      }
      users.add(userEntry[0])
      userRows.push([userEntry[0], { revision: row.revision as number, preferences }])
    }
    result.push([tenantEntry[0], userRows])
  }
  return result
}

export function rehydrateModelPreferences(value: PersistedModelPreferences | undefined): void {
  byTenant.clear()
  if (value === undefined) return
  for (const [tenantId, rows] of parsePersistedModelPreferences(value)) {
    byTenant.set(tenantId, new Map(rows.map(([userId, row]) => [userId, {
      revision: row.revision,
      preferences: copyPreferences(row.preferences),
    }])))
  }
}
