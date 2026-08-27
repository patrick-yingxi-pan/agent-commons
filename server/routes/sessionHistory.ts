/** Session-detail projections kept out of the route catalog. The catalog owns
 *  HTTP/access classification; this module owns the bounded message-history
 *  representation shared by its read and mutation responses (PD36). */
import { estimateTokens, type Message, type Session } from '../../contract/index.ts'
import { pageParams, paginateBackwards } from '../pagination.ts'

export type SessionHistoryProjection = Session | 'invalid'

/** Preserve the legacy full read unless `messageLimit` opts into the browser's
 *  newest-tail contract. A continuation walks backward while every page stays
 *  chronological for rendering. */
export function projectSessionHistory(session: Session, url: URL): SessionHistoryProjection {
  const params = pageParams(url, { limit: 'messageLimit', cursor: 'messageCursor' })
  if (params === 'invalid') return 'invalid'
  if (!params) return session

  const allMessages = session.messages ?? []
  const page = paginateBackwards(allMessages, (message) => message.id, params)
  let latestEscalation: { messageId: string; escalation: NonNullable<Message['escalation']> } | undefined
  for (let i = allMessages.length - 1; i >= 0; i -= 1) {
    const message = allMessages[i]
    if (message.escalation) {
      latestEscalation = { messageId: message.id, escalation: message.escalation }
      break
    }
  }
  const olderTokens = allMessages
    .slice(0, page.remainingBefore)
    .reduce((total, message) => total + estimateTokens(message.content), 0)
  return {
    ...session,
    messages: page.items,
    // Archived compaction detail is another potentially unbounded transcript;
    // the active-thread page never needs it to render its summary marker.
    compactedMessages: undefined,
    messagePage: {
      olderCursor: page.nextCursor,
      olderTokens,
      ...(latestEscalation ? { latestEscalation } : {}),
    },
  }
}

/** Mutation responses communicate the changed session fields without echoing
 *  either transcript. A following bounded read is the one history door. */
export function sessionWithoutHistory(session: Session): Session {
  const { messages: _messages, compactedMessages: _compactedMessages, ...projection } = session
  return projection
}
