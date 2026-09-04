/** Lazy transport and exact-identity reconciliation for discussion handoff. */
import type { Session } from '../../contract/index.ts'
import { ApiRequestError } from './client.ts'
import { createSession, loadSession } from './commands.ts'
import { invalidate } from './cache.ts'
import { keys } from './keys.ts'
import { sessionCreationId } from './sessionCreationIdentity.ts'

export interface DiscussionSessionLaunchIntent {
  intentId: string
  tenantId: string
  discussionId: string
  digest: string
}

const results = new Map<string, Session>()

function remember(intent: DiscussionSessionLaunchIntent, session: Session): void {
  results.set(intent.intentId, session)
  invalidate(keys.sessions)
}

export async function applyDiscussionSessionLaunch(
  intent: DiscussionSessionLaunchIntent,
  idempotencyKey: string,
): Promise<void> {
  const session = await createSession(intent.digest, {
    idempotencyKey,
    persistFirstMessage: true,
  })
  remember(intent, session)
}

export async function reconcileDiscussionSessionLaunch(
  intent: DiscussionSessionLaunchIntent,
  _baseline: undefined,
  idempotencyKey: string,
): Promise<boolean> {
  const expectedId = await sessionCreationId(intent.tenantId, idempotencyKey)
  try {
    const session = await loadSession(expectedId)
    remember(intent, session)
    return true
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) return false
    throw error
  }
}

export function takeDiscussionSessionLaunchResult(intentId: string): Session | undefined {
  const session = results.get(intentId)
  results.delete(intentId)
  return session
}

export function clearDiscussionSessionLaunchResults(): void {
  results.clear()
}
