import type { ApiToken } from '../../contract/index.ts'

/** Adopt one exact token result without replacing unrelated credentials that
 * may have been minted while the authoritative registry read was in flight. */
export function mergeApiTokenRevocationRoster(
  current: ApiToken[],
  tokenId: string,
  represented: ApiToken | undefined,
): ApiToken[] {
  if (!represented) return current.filter((token) => token.id !== tokenId)
  return current.some((token) => token.id === tokenId)
    ? current.map((token) => token.id === tokenId ? represented : token)
    : [...current, represented]
}
