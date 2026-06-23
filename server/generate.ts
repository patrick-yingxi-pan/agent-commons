/** ── Reply generation — the Anthropic Messages API seam ─────────────────────
 *  The backend no longer writes the assistant's words itself. It calls an
 *  Anthropic Messages endpoint through the official SDK and streams the reply
 *  back — exactly the call a production backend makes. In development that
 *  endpoint is the local mock model server (server/model), which holds the canned
 *  replies; to go live you repoint `ANTHROPIC_BASE_URL` at `api.anthropic.com`
 *  and set `ANTHROPIC_API_KEY` — no code change.
 *
 *  The *prose* is the model's. The *structured side-effects* (relation proposals)
 *  stay here, app-side: in a fuller build they'd be the model's tool calls; in
 *  this mock they're keyword-matched and overlaid on the streamed text. */
import Anthropic from '@anthropic-ai/sdk'
import type { Message, RelationOp } from '../contract/index.ts'
import { matchRelationOps } from './data/relationIntents.ts'
import { SYSTEM_MARKERS, chunkText } from './model/replies.ts'

const BASE_URL = process.env.ANTHROPIC_BASE_URL ?? `http://127.0.0.1:${process.env.MODEL_PORT ?? 8788}`
const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-8'

/** One door to the model. Points at the mock model server by default; set
 *  `ANTHROPIC_BASE_URL` + `ANTHROPIC_API_KEY` to talk to the real API instead. */
const client = new Anthropic({
  baseURL: BASE_URL,
  apiKey: process.env.ANTHROPIC_API_KEY ?? 'mock-no-key-needed',
  maxRetries: 1, // fail fast to the graceful fallback if the endpoint is down
})

/** The bit of a session the reply depends on (resolved by the route). */
export interface ReplySession {
  id: string
  title: string
  isDemo?: boolean
}

/** Streamed-reply callbacks the route wires to its SSE channel. */
export interface ReplyHandlers {
  /** The assistant message id, as soon as the model's `message_start` arrives. */
  onStart: (messageId: string) => void
  /** A chunk of assistant text to append. */
  onDelta: (text: string) => void
}

/** The app-domain structured side-effects for a turn — relation proposals. Not
 *  part of the Messages API; the route emits them as `message.relations`. */
export function relationActionsFor(session: ReplySession, text: string): RelationOp[] {
  return matchRelationOps(text, { id: session.id, title: session.title })
}

/** The system prompt the backend sends to the model — the same framing a real
 *  Claude would read. The marker phrases (shared with the mock via SYSTEM_MARKERS)
 *  let the mock pick the matching canned reply. */
function systemPrompt(session: ReplySession, hasOps: boolean): string {
  const parts = [
    'You are Claude in the Unified Workspace prototype — one adaptive thread that unifies chat, workspace, and code.',
  ]
  if (session.isDemo) {
    parts.push(`This is the ${SYSTEM_MARKERS.demo}; keep the reply brief and point the user to the guided tour.`)
  }
  if (hasOps) {
    parts.push(
      `The user is asking to ${SYSTEM_MARKERS.organize} — briefly introduce the edits you'll propose and make clear nothing changes until they confirm.`,
    )
  }
  return parts.join(' ')
}

/** Stream an assistant reply from the Anthropic Messages API. Fires the handlers
 *  as the model streams, and resolves with the complete message (with the
 *  app-domain relation proposals overlaid). Degrades to a local fallback message
 *  if the endpoint is unreachable, so the UI never hangs. */
export async function generateReply(
  session: ReplySession,
  text: string,
  handlers: ReplyHandlers,
  signal?: AbortSignal,
): Promise<Message> {
  const ops = relationActionsFor(session, text)
  try {
    const stream = client.messages.stream(
      {
        model: MODEL,
        max_tokens: 1024,
        system: systemPrompt(session, ops.length > 0),
        messages: [{ role: 'user', content: text.trim() || '(the user sent an empty message)' }],
      },
      { signal },
    )
    stream.on('streamEvent', (event) => {
      if (event.type === 'message_start') handlers.onStart(event.message.id)
    })
    stream.on('text', (delta) => handlers.onDelta(delta))

    const final = await stream.finalMessage()
    const content = final.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
    return { id: final.id, role: 'assistant', content, relationActions: ops.length ? ops : undefined }
  } catch (err) {
    if (signal?.aborted) throw err // the client went away — let the route stop quietly
    return fallbackReply(ops, handlers)
  }
}

/** Streamed locally when the model endpoint can't be reached. */
function fallbackReply(ops: RelationOp[], handlers: ReplyHandlers): Message {
  const id = `msg_fallback_${Date.now().toString(36)}`
  handlers.onStart(id)
  const content =
    'I couldn’t reach the model endpoint just now — in this prototype the backend streams replies from a local Anthropic-compatible mock server. Please try again in a moment.'
  for (const c of chunkText(content)) handlers.onDelta(c)
  return { id, role: 'assistant', content, relationActions: ops.length ? ops : undefined }
}
