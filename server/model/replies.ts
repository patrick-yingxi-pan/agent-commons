/** ── The mock model's prose ("weights") ─────────────────────────────────────
 *  The canned assistant text the mock model server returns. The *decisions*
 *  (which tools to call) live in intents.ts; this is just the words wrapped around
 *  them. A real Claude would generate both; here the prose is a deterministic
 *  fixture so the demo is reviewable. Two entry points:
 *
 *  • `finalReplyText` — the second-turn prose, after the backend has run the tool
 *    calls and fed the results back (the turn that introduces the proposals).
 *  • `plainReplyText` — the prose for a turn with no tool calls (plain chat). */

/** Second-turn prose, chosen by the tools that ran. The escalations get a
 *  specific line; the relation-op tools share the consent framing (the confirm
 *  cards carry the per-op detail, so the prose stays brief). */
/** The Agent Commons CRUD tools (docs/agent-commons.md) — managed through the same
 *  confirm-card gate, so they share one consent line distinct from the relation edits. */
const COMMONS_TOOLS = ['create_provider', 'create_system_prompt', 'create_agent', 'commission_agent', 'uncommission_agent']

export function finalReplyText(toolNames: string[], toolResults: string[] = []): string {
  // Every call REFUSED (the executor's loud "proposed nothing" — an unmatched
  // name, a missing registry): say so honestly instead of narrating a consent
  // card that doesn't exist. A real model reads its tool_results the same way.
  if (toolResults.length && toolResults.every((r) => /proposed nothing/i.test(r))) {
    const reasons = toolResults
      .map((r) => r.split(/\s+—\s+proposed nothing/i)[0])
      .map((r) => r.charAt(0).toLowerCase() + r.slice(1))
      .join('; ')
    return `I couldn't propose that — ${reasons}. Check the exact name and ask again.`
  }
  if (toolNames.includes('open_workspace')) {
    return 'Opening a workspace with a first pass of drafts on the right, grouped by source. Pick a folder to open it.'
  }
  if (toolNames.includes('connect_repo')) {
    return 'Connecting your repo and the GitHub connector. I branched, made the change, and ran the tests — the diff’s on the right. Approve to attach it to this session.'
  }
  if (toolNames.includes('create_project')) {
    return "Good idea — I'll spin up a project so everything this effort produces sits under one roof. Approve below; you'll get a link to open it whenever you like."
  }
  // Agent Commons CRUD proposals (provider / prompt / agent / commission) — their own
  // consent line; the card carries the detail, and nothing is created or assigned yet.
  if (toolNames.some((n) => COMMONS_TOOLS.includes(n))) {
    return "Here's the change to your Agent Commons setup — confirm below; nothing's created or assigned until you do."
  }
  // P6: connector / MCP tool calls — surfaced on the card above. A read already ran; a
  // write (action) is only *proposed* and waits for the user's confirmation, so the prose
  // must not claim it's done. One line covers both.
  if (toolNames.some((n) => n.startsWith('mcp__') || n.startsWith('connector__'))) {
    return 'I used the connected tools you attached — results, and any writes awaiting your confirmation, are on the card above.'
  }
  // Generated API tools (access-parity INV-11, the in-app leg): reads already ran as
  // you; a mutation is only proposed on the card and waits for your confirmation.
  if (toolNames.some((n) => n.startsWith('api__'))) {
    return 'I went through the workspace API — what I read, and any change awaiting your confirmation, is on the card above.'
  }
  // Relation-op proposals: one shared consent line. Nothing changes until the
  // user confirms the card(s) below.
  return "Here's the edit I'd make — confirm below, nothing changes until you do."
}

/** Prose for a turn with no tool calls. */
export function plainReplyText(userText: string): string {
  const t = userText.toLowerCase()
  // The co-authoring beat (the cross-tenant cooperation E2E): a user asks their
  // commissioned agent to draft a section of the shared article. Only this PROSE is
  // canned (the mock stands in for the model's words, as everywhere) — the cooperation
  // itself (commission, sub-goal reservation, effect) runs through the real backend.
  if (/\bdraft\b/.test(t) && /\barticle\b/.test(t)) {
    return 'Here’s a draft for our shared article, **Coordinating Agent Work**:\n\n> A durable conversation keeps context, decisions, and delegated effects together. Shared Projects coordinate many such work streams through explicit roles and a Guardian.\n\nI’ve claimed this section at the project’s Guardian so we don’t collide with the other contributors — refine away.'
  }
  return 'The model here is a local mock, so free-form chat is canned — but every organizing act is real. Ask me to *open a workspace*, *connect the repo*, *save a document, sheet, or slide deck*, *file this under a project*, or *have a schedule save a digest*.'
}

/** A deterministic but source-derived stand-in for the real model's compaction
 * prose. It deliberately reads the supplied source and stays bounded; the backend
 * still exercises the exact non-streaming Messages seam used in release. */
export function compactionReplyText(userText: string): string {
  const source =
    userText.match(/<untrusted_conversation_source[^>]*>\n([\s\S]*?)\n<\/untrusted_conversation_source>/)?.[1] ??
    userText.match(/<untrusted_partial_briefs[^>]*>\n([\s\S]*?)\n<\/untrusted_partial_briefs>/)?.[1] ??
    userText
  const items: string[] = []
  const seen = new Set<string>()
  const addItem = (item: string) => {
    if (seen.has(item)) return
    seen.add(item)
    items.push(item)
  }
  const push = (role: unknown, content: unknown) => {
    if (typeof content !== 'string' || !content.trim()) return
    const label = role === 'user' ? 'User' : role === 'assistant' ? 'Assistant' : 'Context'
    const compact = content.replace(/\s+/g, ' ').trim()
    addItem(`- **${label}:** ${compact.length > 280 ? `${compact.slice(0, 277)}…` : compact}`)
  }

  for (const line of source.split('\n')) {
    try {
      const message = JSON.parse(line) as { role?: unknown; content?: unknown }
      push(message.role, message.content)
    } catch {
      // A hierarchical merge receives earlier Markdown briefs rather than JSONL.
      // Preserve their substantive bullets without copying their generic heading.
      const bullet = line.match(/^\s*[-*]\s+(.+)/)?.[1]?.trim()
      if (bullet) addItem(`- ${bullet}`)
    }
  }

  if (!items.length) {
    const compact = source.replace(/[{}]/g, ' ').replace(/\s+/g, ' ').trim()
    addItem(`- ${compact.length > 900 ? `${compact.slice(0, 897)}…` : compact}`)
  }
  const kept: string[] = []
  let length = '## Retained context\n\n'.length
  for (const item of items) {
    if (kept.length && length + item.length + 1 > 1_200) break
    kept.push(item)
    length += item.length + 1
  }
  return `## Retained context\n\n${kept.join('\n')}`
}

/** Split text into word-sized chunks (each keeps trailing whitespace, so the
 *  concatenated deltas reconstruct the text exactly) — the unit the model server
 *  streams one `content_block_delta` per. */
export function chunkText(text: string): string[] {
  return text.match(/\S+\s*/g) ?? (text ? [text] : [])
}
