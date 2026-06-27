/** ── Seed: the default worker Agent ──────────────────────────────────────────
 *  The single seeded Agent (docs/agent-commons.md, D6) — the degenerate N=1 case
 *  wrapping today's one implicit model client. Its system prompt is the exact base
 *  framing every session used before worker Agents existed (so token metering and
 *  generation are unchanged for the default), and it may call the whole tool
 *  catalog. A later slice introduces user-created Agents + a registry; for now the
 *  store seeds just this one and every Conversation resolves to it. */
import type { Agent } from '../../contract/index.ts'
import { TOOL_NAMES } from '../model/tools.ts'
import { DEFAULT_SYSTEM_PROMPT_BODY, SP_DEFAULT_ID } from './prompts.ts'

export const DEFAULT_AGENT: Agent = {
  id: 'agent-default',
  label: 'Default agent',
  // Single-sourced from the system-prompt library (D10) so the seeded Agent and its
  // library entry can't drift; this body is the exact base framing used before.
  systemPrompt: DEFAULT_SYSTEM_PROMPT_BODY,
  systemPromptId: SP_DEFAULT_ID,
  tools: TOOL_NAMES,
  instructions: '',
}
