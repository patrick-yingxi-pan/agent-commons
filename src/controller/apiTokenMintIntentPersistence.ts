/** Browser-retained recovery coordinates for hosted token minting.
 *
 * Only the account scope, frozen label, and opaque idempotency key are stored.
 * The bearer itself remains memory-only. Retention bridges reloads and temporary
 * account switches; the server still authorizes every recovery read. */
import type { ApiTokenMintIntent } from '../api/apiTokenMintCommands.ts'

interface RetainedApiTokenMintIntent extends ApiTokenMintIntent {
  retainedAt: number
}

const STORAGE_KEY = 'agent-commons.api-token-mint-intents.v1'
const MAX_RETAINED_ACCOUNTS = 6

export function parseRetainedApiTokenMintIntents(raw: string | null): RetainedApiTokenMintIntent[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((value): value is RetainedApiTokenMintIntent => {
      if (!value || typeof value !== 'object') return false
      const row = value as Partial<RetainedApiTokenMintIntent>
      return typeof row.identityKey === 'string'
        && row.identityKey.length > 0
        && row.identityKey.length <= 240
        && typeof row.intentId === 'string'
        && row.intentId.length > 0
        && row.intentId.length <= 128
        && (row.label === undefined || (typeof row.label === 'string' && row.label.length <= 80))
        && typeof row.retainedAt === 'number'
        && Number.isFinite(row.retainedAt)
    }).sort((a, b) => b.retainedAt - a.retainedAt).slice(0, MAX_RETAINED_ACCOUNTS)
  } catch {
    return []
  }
}

function loadAll(): RetainedApiTokenMintIntent[] {
  try {
    return parseRetainedApiTokenMintIntents(localStorage.getItem(STORAGE_KEY))
  } catch {
    return []
  }
}

function saveAll(rows: RetainedApiTokenMintIntent[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rows.slice(0, MAX_RETAINED_ACCOUNTS)))
  } catch {
    // Recovery remains available in memory when storage is unavailable.
  }
}

export function retainApiTokenMintIntent(intent: ApiTokenMintIntent): void {
  saveAll([
    { ...intent, retainedAt: Date.now() },
    ...loadAll().filter((row) => row.identityKey !== intent.identityKey),
  ])
}

export function retainedApiTokenMintIntent(identityKey: string): ApiTokenMintIntent | null {
  const row = loadAll().find((candidate) => candidate.identityKey === identityKey)
  if (!row) return null
  const { retainedAt: _, ...intent } = row
  return intent
}

export function releaseApiTokenMintIntent(intent: ApiTokenMintIntent): void {
  saveAll(loadAll().filter((row) =>
    row.identityKey !== intent.identityKey || row.intentId !== intent.intentId,
  ))
}
