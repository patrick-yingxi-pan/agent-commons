/** Lazy transport, acknowledgement FIFO, and conversation start for discussion handoff. */
import { AccountSwitchedError, ApiRequestError } from '../api'
import {
  applyDiscussionSessionLaunch,
  clearDiscussionSessionLaunchResults,
  reconcileDiscussionSessionLaunch,
  takeDiscussionSessionLaunchResult,
  type DiscussionSessionLaunchIntent,
} from '../api/discussionSessionLaunchCommands.ts'
import { liveFromSession } from '../data/liveSession.ts'
import { createAcknowledgedActionMutationController } from './acknowledgedActionMutationCore.ts'
import { conversations } from './conversationStore.ts'
import { publishDiscussionSessionLaunchStatus } from './discussionSessionLaunchMutations.ts'
import type {
  RevisionedMutationFailure,
  RevisionedMutationOutcome,
} from './revisionedMutationCore.ts'

function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return { message: 'That discussion belonged to the previous account. Dismiss it to continue.', retryable: false }
  }
  if (error instanceof ApiRequestError) {
    if (error.status === 400 || error.status === 404) {
      return { message: 'That discussion can no longer start a conversation. Dismiss it and review the thread.', retryable: false }
    }
    if (error.status === 401 || error.status === 403) {
      return { message: 'You no longer have permission to start this conversation. Dismiss it to continue.', retryable: false }
    }
    if (error.status === 429) {
      return { message: 'Conversation creation is temporarily rate-limited. Retry shortly.', retryable: true }
    }
  }
  return {
    message: 'Couldn’t confirm whether the conversation started. Retry safely or Dismiss.',
    retryable: true,
  }
}

const controller = createAcknowledgedActionMutationController<DiscussionSessionLaunchIntent, undefined>({
  resourceId: (intent) => intent.discussionId,
  snapshot: () => undefined,
  mutate: applyDiscussionSessionLaunch,
  reconcile: reconcileDiscussionSessionLaunch,
  describeFailure,
  setStatus: publishDiscussionSessionLaunchStatus,
  mintIdempotencyKey: (intent) => intent.intentId,
})

export async function enqueueDiscussionSessionLaunchRuntime(
  intent: DiscussionSessionLaunchIntent,
): Promise<RevisionedMutationOutcome> {
  const outcome = await controller.enqueue(intent)
  const session = outcome === 'applied' ? takeDiscussionSessionLaunchResult(intent.intentId) : undefined
  if (session) {
    // The first user turn was committed with the Session. Retry that exact tail
    // so a crash before this point leaves a recoverable row and this process
    // never appends a second copy of the digest.
    conversations.reset(session.id, liveFromSession(session), session.messagePage)
    void conversations.retryTurn(session.id)
  }
  return outcome
}

export const retryDiscussionSessionLaunchRuntime = controller.retry
export const discardDiscussionSessionLaunchRuntime = controller.discard
export function clearDiscussionSessionLaunches(): void {
  controller.clearAll()
  clearDiscussionSessionLaunchResults()
}
