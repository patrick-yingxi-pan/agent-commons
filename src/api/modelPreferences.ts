/** Personal model intent, scoped by server-verified user AND workspace. */
import type { Identity, ViewerModelPreferences } from '../../contract/index.ts'
import { apiGet, AccountSwitchedError } from './client.ts'
import { invalidate, peek } from './cache.ts'
import { keys, paths } from './keys.ts'

export function assertModelPreferenceScope(record: ViewerModelPreferences, identity: Identity): void {
  if (record.userId !== identity.user.id || record.tenantId !== identity.tenant.id) {
    throw new AccountSwitchedError('model preference identity mismatch')
  }
}

export function cachedModelPreferences(): ViewerModelPreferences | undefined {
  const identity = peek<Identity>(keys.me)
  return identity ? peek<ViewerModelPreferences>(keys.modelPreferences(identity.user.id, identity.tenant.id)) : undefined
}

export function retryModelPreferencesRead(): void {
  const identity = peek<Identity>(keys.me)
  if (identity) invalidate(keys.modelPreferences(identity.user.id, identity.tenant.id))
}

export async function readModelPreferences(identity: Identity): Promise<ViewerModelPreferences> {
  const record = await apiGet<ViewerModelPreferences>(paths.modelPreferences)
  assertModelPreferenceScope(record, identity)
  return record
}
