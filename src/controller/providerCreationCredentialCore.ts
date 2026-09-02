/** Process-local lifecycle for a provisional OS-encrypted provider key. */
export interface ProviderCreationCredentialAttempt {
  deviceSecret?: string
  credentialReference?: string
}

export interface ProviderCreationCredentialDependencies {
  provision(secret: string): Promise<string>
  bind(reference: string, providerId: string): Promise<void>
  discard(reference: string): Promise<void>
}

export async function prepareProviderCreationCredential(
  attempt: ProviderCreationCredentialAttempt,
  deps: ProviderCreationCredentialDependencies,
): Promise<void> {
  if (attempt.credentialReference || !attempt.deviceSecret) return
  attempt.credentialReference = await deps.provision(attempt.deviceSecret)
  // The vault reference is sufficient for every retry; do not retain the raw
  // key in renderer memory after successful provisioning.
  attempt.deviceSecret = undefined
}

export async function bindProviderCreationCredential(
  attempt: ProviderCreationCredentialAttempt,
  providerId: string,
  deps: ProviderCreationCredentialDependencies,
): Promise<void> {
  if (!attempt.credentialReference) return
  await deps.bind(attempt.credentialReference, providerId).catch(() => {})
}

export async function discardProviderCreationCredential(
  attempt: ProviderCreationCredentialAttempt,
  deps: ProviderCreationCredentialDependencies,
): Promise<void> {
  if (!attempt.credentialReference) return
  const reference = attempt.credentialReference
  attempt.credentialReference = undefined
  await deps.discard(reference).catch(() => {})
}
