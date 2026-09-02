/** ── Contract: worker Agents ─────────────────────────────────────────────────
 *  A *worker Agent* — the bare word "Agent" in Agent Commons (docs/agent-commons.md,
 *  decision D6). A user-configured bundle of cognition + tools + instructions that
 *  drives a Conversation. Strictly distinct from a **Runner** (the host-bound
 *  capability server in `agents.ts`): the Agent is the *who/how*, the Runner the
 *  *where*. The two never share the word again.
 *
 *  Agents are account-scoped persisted resources. The seeded default remains a
 *  usable baseline, while registered providers, prompts, budgets, commissions,
 *  and worker management supply the multi-agent platform around it. */

import type { Budget } from './budget.ts'
import type { Authority } from './authority.ts'

/** One built-in material in the Agent tool catalog. The name is the exact grant
 * token; the description is the model-facing explanation of what it can do. */
export interface AgentToolEntry {
  name: string
  description: string
}

/** The explicit grant vocabulary plus its display metadata. `tools` remains the
 * compact list every create/update request sends; `entries` makes each material
 * an honest resource in the UI instead of an unexplained string. */
export interface AgentToolCatalog {
  tools: string[]
  entries: AgentToolEntry[]
}

export interface Agent {
  id: string
  /** Server-owned ordering for editable Agent configuration: definition, provider /
   *  prompt binding, grants, and publication posture. Public `version` is a distinct
   *  authorship/history concept and advances only for published definition changes;
   *  reputation and fork counters are independent activity. Absent on legacy
   *  snapshots means revision 0. */
  revision?: number
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
  /** **Published** (docs/agent-commons.md, D18): the owner shares this Agent's
   *  DEFINITION (label / prompt / tools / instructions) in the agent directory, where
   *  any tenant may fork it. Publishing never shares capability — authority / budget /
   *  provider binding stay private and never travel. Unset/false ⇒ private (default). */
  published?: boolean
  /** Fork lineage (D18): the published Agent this one was copied from, when forked.
   *  The label is captured at fork time (the source may be renamed/unpublished later).
   *  `version` (D25) records WHICH definition version was taken — what "behind the
   *  source" means for a later proposal. Absent on pre-D25 forks. */
  forkedFrom?: { agentId: string; label: string; version?: number }
  /** Import lineage (D20, docs/a2a-integration.md): the remote A2A Agent Card this
   *  definition-stub was minted from — the cross-INSTANCE sibling of `forkedFrom`.
   *  Like a fork, the import carries definition only; capability never travels. */
  importedFrom?: { url: string; name: string }
  /** How many times this Agent's published definition was forked (D18) — a public,
   *  monotonic credit, like `contributions`. Absent/0 ⇒ never forked. */
  forks?: number
  /** The definition VERSION (D25) — bumped whenever the definition fields (label /
   *  prompt / tools / instructions) change while published, and on every merged
   *  proposal. Absent ⇒ 1 (a never-versioned or pre-D25 definition). Private edits
   *  before publication don't version — drafts aren't history. */
  version?: number
  /** The published definition's changelog (D25) — one entry per version bump, the
   *  permanent authorship record (a merged proposal credits its proposer here;
   *  authorship is provenance, deliberately NOT D13 reputation). */
  changelog?: AgentChangelogEntry[]
}

/** One changelog line (D25): who authored version N, and why. */
export interface AgentChangelogEntry {
  version: number
  /** The authoring workspace's display name — the owner, or a merged proposal's
   *  proposer (public identity, like `postedBy`). */
  author: string
  note: string
  at: number
}

/** ── D25 — a change proposal against a published definition (the PR analog) ──
 *  FULL-FIELD: the proposal states the new values outright (no patch algebra); the
 *  owner reviews a side-by-side and merges or declines. Capability is structurally
 *  absent — only definition fields are representable here (the D18 wall, again). */
export interface AgentChangeProposal {
  id: string
  /** The proposing workspace's display name (public identity). */
  proposedBy: string
  /** The proposing principal's KIND (FWD-5 Phase 1) — the redaction-safe face of the
   *  server-side `PrincipalRef` stamp; absent = a pre-Phase-1 row. */
  proposedByKind?: import('./identity.ts').PrincipalKind
  /** The proposed replacement values — a present field replaces, an absent one
   *  keeps the current value. */
  fields: {
    label?: string
    systemPrompt?: string
    instructions?: string
    tools?: string[]
  }
  /** Why — the PR description. `''` when none. */
  note: string
  /** The definition version this was authored against. Reviewed at a later
   *  version ⇒ stale (flagged, never auto-rebased). */
  baseVersion: number
  at: number
  status: 'open' | 'merged' | 'declined'
  /** The owner's note on decline. */
  responseNote?: string
  resolvedAt?: number
  /** The proposal's discussion thread (D27) — flat, append-only, writable by
   *  exactly its two parties (proposer ↔ owner) while open. Same row shape as a
   *  work item's thread (one comment primitive platform-wide). */
  comments?: import('./directory.ts').WorkItemComment[]
  /** The review check (D27) — COMPUTED at read time when the proposal changes the
   *  prompt; never stored. The D10 static-tag face: what authored-for tag the
   *  replacement discards, and which provider family it will run on. Advisory,
   *  never gating. */
  check?: ProposalCheck
}

/** The proposal check row (D27) — the honest, knowable facts about a prompt
 *  replacement (a scored probe of untagged bespoke text would be fabricated). */
export interface ProposalCheck {
  /** The provider family the agent's cognition runs on. */
  providerFamily: string
  /** The authored-for family of the prompt being REPLACED (its library tag), when
   *  it had one — the provenance the merge would discard. */
  replacesFamily?: string
  /** One line for the review dialog. */
  note: string
}

/** Body of `POST /agents/:id/proposals/:pid/comments` (D27). */
export interface PostProposalCommentRequest {
  body: string
}

/** Body of `POST /agents/:id/proposals` (D25). */
export interface ProposeAgentChangeRequest {
  fields: AgentChangeProposal['fields']
  note?: string
}

/** Body of `POST /agents/:id/proposals/:pid/decline`. */
export interface DeclineProposalRequest {
  note?: string
}

/** The owner-side aggregate of D13 reputation: standing "accrues to both the Agent and
 *  its owner, linked." The prototype has a single account, so an owner's reputation is the
 *  sum of its Agents' contributions — the accountable human's track record built from its
 *  workers'. Pure (a fold over the registry), so it can't drift from the per-Agent counter. */
export function ownerReputation(agents: readonly Agent[]): number {
  return agents.reduce((sum, a) => sum + (a.contributions ?? 0), 0)
}

/** Create an Agent from the management UI. The server resolves the `systemPrompt` *body*
 *  from `systemPromptId` (the library entry) and validates `authority`/`budget` against
 *  the provider (the D8 funnel). **Strict by design** (INV-9): `providerId` and
 *  `systemPromptId` are required and must name registered entries — the API never
 *  resolves a missing binding to a default (a missing binding is a caller bug, surfaced
 *  now rather than as a surprising resolution later); the *default*-flagged entries
 *  (`isDefault` / `defaultEntry`) are a UI pre-selection shortcut only. An omitted
 *  `tools` is the EMPTY set (minimal risk — the API never widens a grant silently);
 *  the full catalog is an explicit, visible grant made at the edge. */
export interface CreateAgentRequest {
  label: string
  providerId: string
  systemPromptId: string
  instructions?: string
  tools?: string[]
  authority?: Authority
  budget?: Budget
}

/** Patch an Agent's fields. All optional — a present field is applied; an absent one is
 *  left unchanged. Same strictness as create: a present `providerId` / `systemPromptId`
 *  must name a registered entry (empty string is refused, never "clear to default") —
 *  omit the field to keep the current binding, including an Agent's bespoke merged /
 *  forked prompt. A changed provider re-validates authority/budget against it.
 *  `published` is the D18 publish/unpublish act — an explicit owner toggle, deliberately
 *  NOT on `CreateAgentRequest` (a definition is published deliberately, never as a
 *  side-effect of creation). */
export type AgentConfigurationPatch = Partial<CreateAgentRequest> & { published?: boolean }

/** `expectedRevision` is an optional compare-and-swap precondition. Absence keeps
 * the v1 unconditional-write meaning for external/legacy callers; first-party UI
 * edits always send the revision they read. */
export type UpdateAgentRequest = AgentConfigurationPatch & { expectedRevision?: number }

/** Body of `DELETE /v1/agents/:id`. First-party removal pins the Agent
 * definition the person reviewed; omission keeps legacy unconditional delete. */
export interface DeleteAgentRequest {
  expectedRevision?: number
}
