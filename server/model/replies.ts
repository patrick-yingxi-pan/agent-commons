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
export function finalReplyText(toolNames: string[]): string {
  if (toolNames.includes('open_workspace')) {
    return 'Opening a workspace and pulling in `brand-kit/` and `launch-assets/` for reference. First pass is on the right, grouped by source — the one-pager reuses the value prop above, the email is written for admins, and the hero picks up the brand-kit palette. Pick a folder to open it.'
  }
  if (toolNames.includes('connect_repo')) {
    return 'Connecting your repo and the GitHub connector. I branched `feat/insights-dashboard`, added the flag, and wired the route — tests pass, the diff’s on the right. Approve to attach it to this session.'
  }
  if (toolNames.includes('create_project')) {
    return "Good idea — I'll spin up an **Insights dashboard launch** project so the strategy, the docs, and the code all sit under one roof. Approve below and I'll take you straight to it."
  }
  // Relation-op proposals: one shared consent line. Nothing changes until the
  // user confirms the card(s) below.
  return "Here's the edit I'd make — confirm below, nothing changes until you do."
}

/** Prose for a turn with no tool calls: the tour's chat + wrap beats get their
 *  scripted lines (matched loosely on content); anything else gets the
 *  static-prototype pointer. */
export function plainReplyText(userText: string): string {
  const t = userText.toLowerCase()
  if (t.includes('think through the launch')) {
    return "Let's anchor on three things first:\n\n• **Audience** — workspace admins on Team & Enterprise.\n• **Value prop** — “See what your team actually does with Claude, in one view.”\n• **Channels** — in-app banner, changelog, a short email to admins.\n\nWant me to draft the announcement assets next?"
  }
  if (t.includes('organized') || t.includes('that’s the whole thing') || t.includes("that's the whole thing")) {
    return 'Done — the strategy, the docs, the code, and the schedules now live under one project, all linked to this thread. One surface, one history.'
  }
  return 'This is a static prototype — open the **Insights dashboard launch** session and play the guided tour to see the unified flow. You can also ask me to *save a draft as an artifact*, *file this under a project*, or *have a schedule save a digest*.'
}

/** Split text into word-sized chunks (each keeps trailing whitespace, so the
 *  concatenated deltas reconstruct the text exactly) — the unit the model server
 *  streams one `content_block_delta` per. */
export function chunkText(text: string): string[] {
  return text.match(/\S+\s*/g) ?? (text ? [text] : [])
}
