/** Transport and exact recovery for one hosted access-token mint ceremony. */
import type { BearerSession, TokenMintRecovery } from '../../contract/index.ts'
import { apiDelete, apiGet, apiPost } from './client.ts'
import { invalidate } from './cache.ts'
import { keys, paths } from './keys.ts'

export interface ApiTokenMintIntent {
  identityKey: string
  label?: string
  intentId: string
}

function refreshRegistry(): void {
  invalidate(keys.apiTokens)
}

export async function applyApiTokenMint(
  intent: ApiTokenMintIntent,
  idempotencyKey: string,
): Promise<BearerSession> {
  const session = await apiPost<BearerSession>(
    paths.authToken,
    intent.label ? { label: intent.label } : {},
    { idempotencyKey },
  )
  refreshRegistry()
  return session
}

/** Read the durable receipt rather than issuing another creation request. */
export async function recoverApiTokenMint(
  _intent: ApiTokenMintIntent,
  idempotencyKey: string,
): Promise<BearerSession | null> {
  const recovery = await apiGet<TokenMintRecovery>(paths.authToken, { idempotencyKey })
  if (recovery.state !== 'active') return null
  refreshRegistry()
  return recovery.session
}

/** Dismiss is a server-acknowledged safety operation, not a local forget. */
export async function cancelApiTokenMint(
  _intent: ApiTokenMintIntent,
  idempotencyKey: string,
): Promise<void> {
  await apiDelete<{ ok: true }>(paths.authToken, undefined, { idempotencyKey })
  invalidate(keys.apiTokens)
}
