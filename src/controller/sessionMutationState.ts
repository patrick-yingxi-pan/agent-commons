/** Shared authoritative snapshot/reconciliation for conversation-row writes. */
import type { Session } from '../../contract/index.ts'
import { acceptSessionMetadata, keys, loadSession, peek } from '../api'

export function cachedSession(sessionId: string): Session | undefined {
  const detail = peek<Session>(keys.session(sessionId))
  const row = peek<Session[]>(keys.sessions)?.find((candidate) => candidate.id === sessionId)
  if (!detail) return row
  if (!row) return detail
  return (detail.metadataRevision ?? 0) >= (row.metadataRevision ?? 0) ? detail : row
}

export async function reconcileSession(sessionId: string): Promise<Session> {
  const session = await loadSession(sessionId)
  acceptSessionMetadata(session)
  return session
}
