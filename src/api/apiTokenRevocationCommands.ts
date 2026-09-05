/** Transport and exact-registry reconciliation for personal token revocation. */
import type { ApiToken } from '../../contract/index.ts'
import { apiDelete, apiGet } from './client.ts'
import { invalidate, mutate, peek, setData } from './cache.ts'
import { mergeApiTokenRevocationRoster } from './apiTokenRevocationRoster.ts'
import { keys, paths } from './keys.ts'

export interface ApiTokenRevocationIntent {
  tokenId: string
  intentId: string
}

function rememberTarget(tokenId: string, represented: ApiToken | undefined): void {
  if (!peek<ApiToken[]>(keys.apiTokens)) return
  mutate<ApiToken[]>(keys.apiTokens, (rows) =>
    mergeApiTokenRevocationRoster(rows ?? [], tokenId, represented))
}

export async function applyApiTokenRevocation(
  intent: ApiTokenRevocationIntent,
  idempotencyKey: string,
): Promise<void> {
  await apiDelete<{ ok: true }>(
    paths.authTokenRevoke(intent.tokenId),
    undefined,
    { idempotencyKey },
  )
  rememberTarget(intent.tokenId, undefined)
  invalidate(keys.apiTokens)
}

/** A registry row's exact absence is durable desired-state proof. Adopt only
 * that row so a crossed read cannot erase a different, newly minted token. */
export async function reconcileApiTokenRevocation(
  intent: ApiTokenRevocationIntent,
): Promise<boolean> {
  const incoming = await apiGet<ApiToken[]>(paths.authTokens)
  const represented = incoming.find((token) => token.id === intent.tokenId)
  if (peek<ApiToken[]>(keys.apiTokens)) rememberTarget(intent.tokenId, represented)
  else setData(keys.apiTokens, incoming)
  return represented === undefined
}
