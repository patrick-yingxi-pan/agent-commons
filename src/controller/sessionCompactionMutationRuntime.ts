/** Lazy transport and acknowledgement FIFO behind conversation compaction. */
import { AccountSwitchedError, ApiRequestError } from '../api'
import type { Session } from '../../contract/index.ts'
import {
  applySessionCompaction,
  reconcileSessionCompaction,
  type SessionCompactionIntent,
} from '../api/sessionCompactionCommands.ts'
import { liveFromSession } from '../data/liveSession.ts'
import { createAcknowledgedActionMutationController } from './acknowledgedActionMutationCore.ts'
import { conversations } from './conversationStore.ts'
import { publishSessionCompactionStatus } from './sessionCompactionMutations.ts'
import type { RevisionedMutationFailure } from './revisionedMutationCore.ts'

type TranscriptBaseline = string

const transcriptFingerprint = (sessionId: string): string =>
  JSON.stringify(conversations.get(sessionId).live.messages)

/** Replace only the transcript/archive cursor this operation owns. Context,
 * focus, and any newer local or ambient message projection remain untouched. */
function rememberCompaction(
  intent: SessionCompactionIntent,
  session: Session,
  baseline: TranscriptBaseline,
): void {
  if (transcriptFingerprint(intent.sessionId) !== baseline) return
  const compacted = liveFromSession(session)
  conversations.update(intent.sessionId, (current) => ({
    ...current,
    live: { ...current.live, messages: compacted.messages },
    history: session.messagePage
      ? { ...session.messagePage, loading: false, error: null }
      : { olderTokens: 0, loading: false, error: null },
    reconciled: true,
  }))
}

function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return { message: 'That compaction belonged to the previous account. Dismiss it to continue.', retryable: false }
  }
  if (error instanceof ApiRequestError) {
    if (error.status === 400 || error.status === 404) {
      return { message: 'This exact conversation can no longer be compacted. Dismiss the request and review the current thread.', retryable: false }
    }
    if (error.status === 401 || error.status === 403) {
      return { message: 'Only the conversation owner can compact this thread. Dismiss the request to continue.', retryable: false }
    }
    if (error.status === 409) {
      return { message: `${error.message} Retry safely, or Dismiss to keep the current thread.`, retryable: true }
    }
    if (error.status === 429) {
      return { message: 'Compaction is temporarily rate-limited. Retry shortly.', retryable: true }
    }
  }
  return {
    message: 'Couldn’t confirm whether this conversation was compacted. Retry safely or Dismiss.',
    retryable: true,
  }
}

const controller = createAcknowledgedActionMutationController<SessionCompactionIntent, TranscriptBaseline>({
  resourceId: (intent) => intent.sessionId,
  snapshot: (intent) => transcriptFingerprint(intent.sessionId),
  mutate: async (intent, idempotencyKey) => {
    const baseline = transcriptFingerprint(intent.sessionId)
    rememberCompaction(intent, await applySessionCompaction(intent, idempotencyKey), baseline)
  },
  reconcile: async (intent, _baseline, idempotencyKey) => {
    const baseline = transcriptFingerprint(intent.sessionId)
    const session = await reconcileSessionCompaction(intent, idempotencyKey)
    if (!session) return false
    rememberCompaction(intent, session, baseline)
    return true
  },
  describeFailure,
  setStatus: publishSessionCompactionStatus,
  mintIdempotencyKey: (intent) => intent.intentId,
})

export const enqueueSessionCompactionRuntime = controller.enqueue
export const retrySessionCompactionRuntime = controller.retry
export const discardSessionCompactionRuntime = controller.discard
export const clearSessionCompactions = controller.clearAll
