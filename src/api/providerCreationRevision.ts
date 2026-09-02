import type { CreateProviderRequest } from '../../contract/index.ts'

/** One form submission owns one immutable provider-registration request. The
 * mutable credential fields are process-local ceremony state and are never sent
 * except as a generated reference after the native vault accepts the secret. */
export interface ProviderCreationIntent {
  readonly tenantId: string
  readonly intentId: string
  readonly request: CreateProviderRequest
  deviceSecret?: string
  credentialReference?: string
}

export const providerCreationResourceId = (intent: ProviderCreationIntent): string =>
  `provider-create:${intent.intentId}`
