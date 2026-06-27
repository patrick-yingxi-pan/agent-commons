/** ── Seed: the default worker Agent ──────────────────────────────────────────
 *  The single seeded Agent (docs/agent-commons.md, D6) — the degenerate N=1 case
 *  wrapping today's one implicit model client. Its system prompt is the exact base
 *  framing every session used before worker Agents existed (so token metering and
 *  generation are unchanged for the default), and it may call the whole tool
 *  catalog. A later slice introduces user-created Agents + a registry; for now the
 *  store seeds just this one and every Conversation resolves to it. */
import type { Agent } from '../../contract/index.ts'
import { TOOL_NAMES } from '../model/tools.ts'

export const DEFAULT_AGENT: Agent = {
  id: 'agent-default',
  label: 'Default agent',
  systemPrompt: [
    'You are Claude in the Unified Workspace prototype — one adaptive thread that unifies chat, workspace, and code.',
    'When the user asks to produce documents, change code, or organize their work, manipulate the workspace by calling the provided tools.',
    'A tool call is a *proposal*: nothing is applied until the user confirms it in the thread, so call the tool and then briefly introduce what you proposed.',
  ].join(' '),
  tools: TOOL_NAMES,
  instructions: '',
}
