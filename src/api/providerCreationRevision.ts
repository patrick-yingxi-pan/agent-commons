import type { CreateProviderRequest, Identity } from '../../contract/index.ts'
import { accountGeneration, activeAccount } from './account.ts'
import { AccountSwitchedError } from './client.ts'
import { peek } from './cache.ts'
import { keys } from './keys.ts'

export interface ProviderCreationSource {
  readonly tenantId: string
  readonly userId: string
  readonly sourceUserId: string | null
  readonly accountGeneration: number
}

export function captureProviderCreationSource(tenantId?: string): ProviderCreationSource {
  const identity = peek<Identity>(keys.me)
  if (!identity) throw new AccountSwitchedError('provider creation identity unresolved')
  const source = {
    tenantId: tenantId ?? identity.tenant.id,
    userId: identity.user.id,
    sourceUserId: identity.via === 'session' ? identity.user.id : null,
    accountGeneration: accountGeneration(),
  }
  assertProviderCreationSource(source)
  return source
}

/** Check the activation identity before each async continuation or effect. */
export function assertProviderCreationSource(source: ProviderCreationSource): void {
  const identity = peek<Identity>(keys.me)
  const account = activeAccount()
  if (source.accountGeneration !== accountGeneration() || !identity ||
      identity.tenant.id !== source.tenantId || identity.user.id !== source.userId ||
      (identity.via === 'session' ? identity.user.id : null) !== source.sourceUserId ||
      (account && (account.tenantId !== source.tenantId || account.userId !== source.userId))) {
    throw new AccountSwitchedError('provider creation identity changed')
  }
}

/** One form submission owns one immutable provider-registration request. The
 * mutable credential fields are process-local ceremony state and are never sent
 * except as a generated reference after the native vault accepts the secret. */
export interface ProviderCreationIntent extends ProviderCreationSource {
  readonly intentId: string
  readonly request: CreateProviderRequest
  deviceSecret?: string
  credentialReference?: string
  /** Once an attempt has uncertain delivery, a later refusal cannot prove that
   * the earlier request did not bind this key to a durable provider. */
  uncertainSubmission?: boolean
}

export const providerCreationResourceId = (intent: ProviderCreationIntent): string =>
  `provider-create:${intent.intentId}`
