/** Browser-retained, non-secret recovery coordinates for Session-secret rotation. */
import type { ProviderSecretRotationIntent } from '../api/providerSecretRotationCommands.ts'

interface RetainedProviderSecretRotationIntent extends ProviderSecretRotationIntent {
  retainedAt: number
}

const STORAGE_KEY = 'agent-commons.provider-secret-rotation-intents.v1'
const MAX_RETAINED_ACCOUNTS = 6

export function parseRetainedProviderSecretRotationIntents(
  raw: string | null,
): RetainedProviderSecretRotationIntent[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((value): value is RetainedProviderSecretRotationIntent => {
      if (!value || typeof value !== 'object') return false
      const row = value as Partial<RetainedProviderSecretRotationIntent>
      return typeof row.identityKey === 'string'
        && row.identityKey.length > 0
        && row.identityKey.length <= 240
        && typeof row.tenantId === 'string'
        && row.tenantId.length > 0
        && row.tenantId.length <= 128
        && typeof row.providerId === 'string'
        && row.providerId.length > 0
        && row.providerId.length <= 240
        && typeof row.expectedRevision === 'number'
        && Number.isInteger(row.expectedRevision)
        && row.expectedRevision >= 0
        && typeof row.intentId === 'string'
        && row.intentId.length > 0
        && row.intentId.length <= 128
        && typeof row.retainedAt === 'number'
        && Number.isFinite(row.retainedAt)
    }).sort((a, b) => b.retainedAt - a.retainedAt).slice(0, MAX_RETAINED_ACCOUNTS)
  } catch {
    return []
  }
}

function loadAll(): RetainedProviderSecretRotationIntent[] {
  try {
    return parseRetainedProviderSecretRotationIntents(localStorage.getItem(STORAGE_KEY))
  } catch {
    return []
  }
}

function saveAll(rows: RetainedProviderSecretRotationIntent[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rows.slice(0, MAX_RETAINED_ACCOUNTS)))
  } catch {
    // Recovery remains available in memory when browser storage is unavailable.
  }
}

export function retainProviderSecretRotationIntent(intent: ProviderSecretRotationIntent): void {
  saveAll([
    { ...intent, retainedAt: Date.now() },
    ...loadAll().filter((row) => row.identityKey !== intent.identityKey),
  ])
}

export function retainedProviderSecretRotationIntent(
  identityKey: string,
): ProviderSecretRotationIntent | null {
  const row = loadAll().find((candidate) => candidate.identityKey === identityKey)
  if (!row) return null
  const { retainedAt: _, ...intent } = row
  return intent
}

export function releaseProviderSecretRotationIntent(intent: ProviderSecretRotationIntent): void {
  saveAll(loadAll().filter((row) =>
    row.identityKey !== intent.identityKey || row.intentId !== intent.intentId,
  ))
}
