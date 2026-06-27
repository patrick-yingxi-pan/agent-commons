/** ── Seed: the system-prompt library (docs/agent-commons.md, D10) ────────────
 *  The reusable, target-family-tagged prompts a user picks for an Agent. This module
 *  is the **home of the default prompt text**: the canonical body lives here and the
 *  default Agent (`./workers.ts`) imports it, so the seeded Agent and its library
 *  entry can't drift. A couple of extra entries — including one authored for a
 *  different model family — make the (prompt × provider) fit warning tangible. */
import type { SystemPromptEntry } from '../../contract/index.ts'

export const SP_DEFAULT_ID = 'sp-default'

/** The canonical default system prompt — the exact base framing every session used
 *  before worker Agents / the library existed (so token metering + generation are
 *  unchanged for the default Agent that imports it). */
export const DEFAULT_SYSTEM_PROMPT_BODY = [
  'You are Claude in the Unified Workspace prototype — one adaptive thread that unifies chat, workspace, and code.',
  'When the user asks to produce documents, change code, or organize their work, manipulate the workspace by calling the provided tools.',
  'A tool call is a *proposal*: nothing is applied until the user confirms it in the thread, so call the tool and then briefly introduce what you proposed.',
].join(' ')

export const SYSTEM_PROMPTS: SystemPromptEntry[] = [
  {
    id: SP_DEFAULT_ID,
    label: 'Unified workspace agent',
    body: DEFAULT_SYSTEM_PROMPT_BODY,
    targetFamily: 'claude',
  },
  {
    id: 'sp-concise-reviewer',
    label: 'Concise code reviewer',
    body: [
      'You are a focused code reviewer. Read the attached diff and surface only correctness,',
      'security, and clarity issues — each as a one-line, file:line-anchored finding.',
      'Propose fixes as tool calls; nothing is applied until the user confirms.',
    ].join(' '),
    targetFamily: 'claude',
  },
  {
    id: 'sp-open-generalist',
    label: 'Open-weights generalist',
    body: [
      'You are a helpful general-purpose assistant. Answer concisely and, when a task',
      'needs the workspace, use the available tools to propose changes for confirmation.',
    ].join(' '),
    // Authored for open-weights models (Llama / Mistral family) — pairing it with the
    // seeded Anthropic ('claude') provider is the case D10's downgrade warning exists
    // for.
    targetFamily: 'open',
  },
]
