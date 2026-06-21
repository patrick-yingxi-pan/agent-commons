/** ── Commands ──────────────────────────────────────────────────────────────
 *  The UI's writes. Reads come back through hooks + the cache; writes go here.
 *  Phase 3 starts with the streaming send — the one command whose response is
 *  itself a stream (the assistant turn), mirroring the Anthropic Messages API. */
import type { ReplyStreamEvent, SendMessageRequest } from '../../contract/index.ts'
import { API_BASE } from './client.ts'
import { paths } from './keys.ts'

/** Callbacks for a streamed assistant turn. Each fires as its event arrives. */
export interface SendHandlers {
  /** The (empty) assistant message shell — append it, then fill via deltas. */
  onStart?: (messageId: string, message: Extract<ReplyStreamEvent, { type: 'message.start' }>['message']) => void
  /** A chunk of assistant text to append to the message. */
  onDelta?: (messageId: string, text: string) => void
  /** A mid-turn escalation (attach a workspace / repo). */
  onEscalate?: (messageId: string, escalate: 'workspace' | 'repo') => void
  /** A mid-turn relation proposal (render the confirm card). */
  onRelations?: (messageId: string, relationActions: Extract<ReplyStreamEvent, { type: 'message.relations' }>['relationActions']) => void
  /** The final, complete assistant message (authoritative). */
  onEnd?: (message: Extract<ReplyStreamEvent, { type: 'message.end' }>['message']) => void
}

/** Send a turn and stream the reply. Resolves when the stream ends. The optional
 *  AbortSignal lets the caller cancel an in-flight turn (e.g. on session switch). */
export async function sendMessage(
  sessionId: string,
  text: string,
  handlers: SendHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const body: SendMessageRequest = { text }
  const res = await fetch(`${API_BASE}${paths.session(sessionId)}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok || !res.body) throw new Error(`send failed: ${res.status}`)

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    // SSE frames are separated by a blank line.
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''
    for (const frame of frames) {
      const line = frame.split('\n').find((l) => l.startsWith('data:'))
      if (!line) continue
      let event: ReplyStreamEvent
      try {
        event = JSON.parse(line.slice(5).trim()) as ReplyStreamEvent
      } catch {
        continue
      }
      dispatch(event, handlers)
    }
  }
}

function dispatch(event: ReplyStreamEvent, h: SendHandlers): void {
  switch (event.type) {
    case 'message.start':
      h.onStart?.(event.message.id, event.message)
      break
    case 'message.delta':
      h.onDelta?.(event.messageId, event.text)
      break
    case 'message.escalate':
      h.onEscalate?.(event.messageId, event.escalate)
      break
    case 'message.relations':
      h.onRelations?.(event.messageId, event.relationActions)
      break
    case 'message.end':
      h.onEnd?.(event.message)
      break
  }
}
