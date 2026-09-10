/** Write/recovery transport for personal model intent. */
import type { Identity, ModelPreferences, ViewerModelPreferences } from '../../contract/index.ts'
import { accountGeneration, activeAccount } from './account.ts'
import { apiPatch, AccountSwitchedError, ApiRequestError } from './client.ts'
import { peek, setData } from './cache.ts'
import { keys, paths } from './keys.ts'
import {
  assertModelPreferenceScope,
  cachedModelPreferences,
  readModelPreferences,
} from './modelPreferences.ts'
import { applyModelPreferencePatch, sameModelPreferences } from '../lib/modelPrefs.ts'

export interface ModelPreferenceMutationSource {
  readonly tenantId: string
  readonly userId: string
  readonly accountGeneration: number
}

export interface ModelPreferenceMutationIntent extends ModelPreferenceMutationSource {
  readonly patch: Readonly<Partial<ModelPreferences>>
}

const RESOURCE_PREFIX = 'model-preferences:'

export function acceptModelPreferences(incoming: ViewerModelPreferences): ViewerModelPreferences {
  const key = keys.modelPreferences(incoming.userId, incoming.tenantId)
  const current = peek<ViewerModelPreferences>(key)
  if (current && current.userId === incoming.userId && current.tenantId === incoming.tenantId &&
      current.revision > incoming.revision) return current
  setData(key, incoming)
  return incoming
}

export function modelPreferenceMutationResourceId(source: ModelPreferenceMutationSource): string {
  return `${RESOURCE_PREFIX}${JSON.stringify([source.tenantId, source.userId, source.accountGeneration])}`
}

function sourceFromResourceId(resourceId: string): ModelPreferenceMutationSource {
  if (!resourceId.startsWith(RESOURCE_PREFIX)) throw new AccountSwitchedError('model preference identity unresolved')
  let tuple: unknown
  try { tuple = JSON.parse(resourceId.slice(RESOURCE_PREFIX.length)) } catch { throw new AccountSwitchedError('model preference identity unresolved') }
  if (!Array.isArray(tuple) || tuple.length !== 3 || typeof tuple[0] !== 'string' || typeof tuple[1] !== 'string' ||
      !Number.isSafeInteger(tuple[2]) || (tuple[2] as number) < 0) {
    throw new AccountSwitchedError('model preference identity unresolved')
  }
  return { tenantId: tuple[0], userId: tuple[1], accountGeneration: tuple[2] as number }
}

/** This runs before every read or write effect, including explicit Retry. */
export function assertModelPreferenceMutationSource(source: ModelPreferenceMutationSource): Identity {
  const account = activeAccount()
  const identity = peek<Identity>(keys.me)
  if (source.accountGeneration !== accountGeneration() || !identity ||
      identity.tenant.id !== source.tenantId || identity.user.id !== source.userId ||
      (account && (account.tenantId !== source.tenantId || account.userId !== source.userId))) {
    throw new AccountSwitchedError('model preference identity changed')
  }
  return identity
}

async function readFrozenModelPreferences(source: ModelPreferenceMutationSource): Promise<ViewerModelPreferences> {
  const identity = assertModelPreferenceMutationSource(source)
  const record = await readModelPreferences(identity)
  assertModelPreferenceMutationSource(source)
  assertModelPreferenceScope(record, identity)
  return acceptModelPreferences(record)
}

export function cachedModelPreferencesForMutation(resourceId: string): ViewerModelPreferences | undefined {
  const source = sourceFromResourceId(resourceId)
  const identity = assertModelPreferenceMutationSource(source)
  const record = cachedModelPreferences()
  if (record) assertModelPreferenceScope(record, identity)
  return record
}

export function reconcileModelPreferences(resourceId: string): Promise<ViewerModelPreferences> {
  return readFrozenModelPreferences(sourceFromResourceId(resourceId))
}

/** Retry rebases only the named UI fields. Provider/model form one explicit
 * selection group; omitted fields preserve newer choices made on another device. */
export async function patchModelPreferences(
  resourceId: string,
  patch: Partial<ModelPreferences>,
  expectedRevision: number,
  idempotencyKey: string,
): Promise<ViewerModelPreferences> {
  const source = sourceFromResourceId(resourceId)
  const identity = assertModelPreferenceMutationSource(source)
  const current = cachedModelPreferencesForMutation(resourceId)
  if (!current) throw new AccountSwitchedError('model preference identity unresolved')
  if (current.revision !== expectedRevision) {
    throw new ApiRequestError('conflict', 'Your model preference changed elsewhere.', 409)
  }
  const preferences = applyModelPreferencePatch(current.preferences, patch)
  try {
    const saved = await apiPatch<ViewerModelPreferences>(paths.modelPreferences, {
      expectedUserId: source.userId,
      expectedTenantId: source.tenantId,
      expectedRevision,
      preferences,
    }, { idempotencyKey })
    assertModelPreferenceMutationSource(source)
    assertModelPreferenceScope(saved, identity)
    return acceptModelPreferences(saved)
  } catch (error) {
    if (error instanceof AccountSwitchedError) throw error
    // A same-namespace cookie drift can look like an ordinary CAS conflict.
    // Read the frozen viewer once so an exact scope mismatch becomes terminal
    // account recovery, while a real same-viewer conflict remains retryable.
    if (error instanceof ApiRequestError && error.status === 409) {
      try {
        const represented = await readFrozenModelPreferences(source)
        if (represented.revision > expectedRevision && sameModelPreferences(represented.preferences, preferences)) {
          return represented
        }
      } catch (scopeError) {
        if (scopeError instanceof AccountSwitchedError) throw scopeError
      }
      throw error
    }
    if (!(error instanceof ApiRequestError) || error.status === 0 || error.status >= 500) {
      try {
        const represented = await readFrozenModelPreferences(source)
        if (represented.revision > expectedRevision && sameModelPreferences(represented.preferences, preferences)) {
          return represented
        }
      } catch (reconcileError) {
        if (reconcileError instanceof AccountSwitchedError) throw reconcileError
      }
    }
    throw error
  }
}
