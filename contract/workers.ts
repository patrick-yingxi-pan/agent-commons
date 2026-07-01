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
import type { Authority } from './authority.ts'

export interface Agent {
  id: string
  /** The tenant that created it (F2/PD9). Unset ⇒ a seeded/shared entry visible to every
   *  tenant (the default toolkit is shared infra); a created one is private to its tenant. */
  tenantId?: string
  /** Human label, shown wherever an Agent is chosen. */
  label: string
  /** The system prompt this Agent drives the model with — provider-optimized
   *  (docs/agent-commons.md, D10). The cognition half of the bundle. */
  systemPrompt: string
  /** The system-prompt library entry this Agent was built from (D10), if any — the
   *  provenance that lets a picker check the prompt's authored-for family against the
   *  chosen provider's model family (`promptFitWarning`). Optional: an Agent may carry
   *  a bespoke `systemPrompt` with no library entry behind it. */
  systemPromptId?: string
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
  /** An optional token budget — tighter than the provider plan (the D8 cascade, token
   *  face). Validated at the creation funnel (`store.createAgent`); unset = no
   *  Agent-level cap beyond the plan. */
  budget?: Budget
  /** An optional **authority** grant — a subset of the provider's (the D8 cascade's
   *  primary face: tools / connectors / scopes). Validated at the same funnel
   *  (`overAuthority`); unset = inherit the provider's authority. A Commission later
   *  attenuates this further. */
  authority?: Authority
  /** This Agent's **reputation** — a monotonic count of successful commissioned effects
   *  it has performed on a shared Project (docs/agent-commons.md, D13 / OQ1). The
   *  GitHub-style worker track record; it only ever increments (a contribution is never
   *  un-donated) and aggregates to the owner via `ownerReputation` ("accrues to both the
   *  Agent and its owner, linked"). Absent / `0` ⇒ a worker that has not yet contributed. */
  contributions?: number
}

/** The owner-side aggregate of D13 reputation: standing "accrues to both the Agent and
 *  its owner, linked." The prototype has a single account, so an owner's reputation is the
 *  sum of its Agents' contributions — the accountable human's track record built from its
 *  workers'. Pure (a fold over the registry), so it can't drift from the per-Agent counter. */
export function ownerReputation(agents: readonly Agent[]): number {
  return agents.reduce((sum, a) => sum + (a.contributions ?? 0), 0)
}

/** Create an Agent from the management UI. The server resolves the `systemPrompt` *body*
 *  from `systemPromptId` (the library entry), defaults `tools` to the full catalog when
 *  omitted, and validates `authority`/`budget` against the provider (the D8 funnel). An
 *  empty-string `providerId` / `systemPromptId` means "none / default". */
export interface CreateAgentRequest {
  label: string
  providerId?: string
  systemPromptId?: string
  instructions?: string
  tools?: string[]
  authority?: Authority
  budget?: Budget
}

/** Patch an Agent's fields. All optional — a present field (including an empty-string
 *  `providerId` / `systemPromptId` meaning "clear to default") is applied; an absent one
 *  is left unchanged. A changed provider re-validates authority/budget against it. */
export type UpdateAgentRequest = Partial<CreateAgentRequest>
