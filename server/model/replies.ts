/** ── The mock model's "weights" ─────────────────────────────────────────────
 *  The canned assistant prose the mock model server returns. In the real product
 *  this is the model's generation; here it's a deterministic fixture chosen from
 *  the system prompt the backend sends (the same prompt a real Claude would read)
 *  plus the user's message. This is the *only* place reply text lives now — the
 *  app backend owns the structured side-effects (relation proposals), not the
 *  prose. */

/** Markers the backend embeds in the system prompt; the mock keys its reply on
 *  them exactly as a real model would read the same framing. Kept here so the
 *  backend (server/generate.ts) and the mock agree on the wording. */
export const SYSTEM_MARKERS = {
  /** The user asked to reorganize — introduce the proposed edits. */
  organize: 'reorganize their workspace',
  /** The scripted demo session — keep it brief and point to the guided tour. */
  demo: 'scripted demo session',
} as const

/** Pick the assistant text for a turn from the system prompt + the user message.
 *  Deterministic and dependency-free — this server is a stand-in for the Anthropic
 *  Messages API, so it only sees what a real model would (system + messages). */
export function mockReplyText(system: string, _userText: string): string {
  if (system.includes(SYSTEM_MARKERS.organize)) {
    return "Here's what I can organize — confirm what you'd like, nothing changes until you do:"
  }
  if (system.includes(SYSTEM_MARKERS.demo)) {
    return 'This is a static prototype, so I won’t actually answer here. Use **Play the tour** above to watch one session flow from chat → workspace → code without switching tabs.'
  }
  return 'This is a static prototype — open the **Insights dashboard launch** session and play the guided tour to see the unified flow. You can also ask me to *file this under a project*, *save a draft as an artifact*, or *have a schedule save a digest*.'
}

/** Split text into word-sized chunks (each keeps trailing whitespace, so the
 *  concatenated deltas reconstruct the text exactly) — the unit the model server
 *  streams one `content_block_delta` per. */
export function chunkText(text: string): string[] {
  return text.match(/\S+\s*/g) ?? (text ? [text] : [])
}
