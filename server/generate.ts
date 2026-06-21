/** ── Reply generation ──────────────────────────────────────────────────────
 *  Turns a session turn into the assistant's reply. The mock keeps the
 *  prototype's honest behavior — a free-typed "organize" request becomes the
 *  matching relation-edit proposals; anything else gets a canned answer — but it
 *  now runs *server-side* and is streamed token-by-token, exactly where a real
 *  backend would call the Anthropic Messages API and proxy its stream. */
import type { Message } from '../contract/index.ts'
import { matchRelationOps } from './data/relationIntents.ts'

let seq = 0
const nextId = () => `a-srv-${Date.now().toString(36)}-${++seq}`

/** The bit of a session the reply depends on (resolved by the route). */
export interface ReplySession {
  id: string
  title: string
  isDemo?: boolean
}

/** Build the full assistant reply for a turn (the route then streams it). */
export function buildReply(session: ReplySession, text: string): Message {
  const ops = matchRelationOps(text, { id: session.id, title: session.title })
  if (ops.length > 0) {
    return {
      id: nextId(),
      role: 'assistant',
      content: "Here's what I can organize — confirm what you'd like, nothing changes until you do:",
      relationActions: ops,
    }
  }
  const content = session.isDemo
    ? 'This is a static prototype, so I won’t actually answer here. Use **Play the tour** above to watch one session flow from chat → workspace → code without switching tabs.'
    : 'This is a static prototype — open the **Insights dashboard launch** session and play the guided tour to see the unified flow. You can also ask me to *file this under a project*, *save a draft as an artifact*, or *have a schedule save a digest*.'
  return { id: nextId(), role: 'assistant', content }
}

/** Split text into word-sized chunks (each keeps its trailing whitespace, so
 *  concatenating the deltas reconstructs the content exactly). */
export function chunkText(text: string): string[] {
  return text.match(/\S+\s*/g) ?? (text ? [text] : [])
}
