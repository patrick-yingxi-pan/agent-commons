/** ── Contract: worker Agents ─────────────────────────────────────────────────
 *  A *worker Agent* — the bare word "Agent" in Agent Commons (docs/agent-commons.md,
 *  decision D6). A user-configured bundle of cognition + tools + instructions that
 *  drives a Conversation. Strictly distinct from a **Runner** (the host-bound
 *  capability server in `agents.ts`): the Agent is the *who/how*, the Runner the
 *  *where*. The two never share the word again.
 *
 *  Forward-looking: today there is exactly one, seeded, wrapping the single implicit
 *  model client — the degenerate N=1 case (`server/data/workers.ts`). Multi-agent
 *  management, model providers, and budgets are later slices; `providerId` and a
 *  budget are deliberately absent until the slices that enforce them land. */

import type { Budget } from './budget.ts'

export interface Agent {
  id: string
  /** Human label, shown wherever an Agent is chosen. */
  label: string
  /** The system prompt this Agent drives the model with — provider-optimized
   *  (docs/agent-commons.md, D10). The cognition half of the bundle. */
  systemPrompt: string
  /** The tool names this Agent may call — a subset of the catalog
   *  (`server/model/tools.ts` `TOOL_NAMES`). The degenerate Agent carries them all;
   *  `[]` is a valid Agent that calls no tools. */
  tools: string[]
  /** The user's custom instructions, appended after the system prompt. `''` when
   *  none. */
  instructions: string
  /** The Model provider this Agent's cognition comes from. Optional until the
   *  provider registry lands (a later slice); the degenerate Agent omits it and
   *  uses the single implicit client. */
  providerId?: string
  /** An optional token budget — tighter than the provider plan (the D8 cascade).
   *  Validated at the creation funnel (`store.createAgent`); unset = no Agent-level
   *  cap beyond the plan. Authority attenuation is a later slice. */
  budget?: Budget
}
