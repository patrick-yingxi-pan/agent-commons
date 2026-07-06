/** ── Contract: the discovery directories (docs/agent-commons.md, D17) ────────
 *  Cross-tenant, read-only listings of what owners made public: shared Projects and
 *  published Agents. A directory NEVER widens visibility — each entry is the row's
 *  existing public face (the P8 `publicSharedProject` redaction; the D18 published
 *  definition) plus aggregates that are themselves public acts (Contributor count,
 *  open work, contributions, forks). Search is a case-insensitive substring over
 *  name/description — a mechanism; ranking is deliberately absent (D17). */
import type { ProjectEffectType } from './coordination.ts'

/** One shared Project in the discovery directory (`GET /directory/projects`). */
export interface ProjectDirectoryEntry {
  id: string
  name: string
  description: string
  /** The owning workspace's display name — WHO shares it (public identity, like the
   *  Contributor list's `agentLabel`). Never the raw tenant id of a foreign tenant. */
  owner: string
  /** Whether the caller's tenant owns this Project (drives "yours" affordances). */
  own: boolean
  /** Whether the Project is a guarded resource (D11) — i.e. cooperable. */
  guarded: boolean
  /** Active Contributors (commissions) on it — the collaboration signal. */
  contributorCount: number
  /** Open work items awaiting a taker (D19) — the "help wanted" signal. */
  openWorkCount: number
  updatedAt: number
}

/** One published Agent in the discovery directory (`GET /directory/agents`) — the
 *  D18 public face: the DEFINITION (label / prompt / tools / instructions) and the
 *  public track record. Authority, budget, and provider binding are structurally
 *  absent: a capability never travels (D18). */
export interface AgentDirectoryEntry {
  id: string
  label: string
  /** The owning workspace's display name (public identity). */
  owner: string
  /** Whether the caller's tenant owns this Agent (its own published rows appear too). */
  own: boolean
  systemPrompt: string
  tools: string[]
  instructions: string
  /** D13 reputation — successful commissioned effects (a public act). */
  contributions: number
  /** How many times this definition was forked (a public act). */
  forks: number
}

/** ── Open work — the Project backlog (docs/agent-commons.md, D19) ────────────
 *  A posted work item: a sub-goal plus the externally-effectful action it needs.
 *  The issues-tray analog — the same object that shows a human what a Project
 *  needs lets a standing Contributor (D19) take it unprompted. */
export interface OpenSubGoal {
  id: string
  projectId: string
  /** The sub-goal label — the Guardian reservation key when it's taken (D11). */
  subGoal: string
  /** The effect the item needs (decides monotonic vs guarded, and D12 reach). */
  type: ProjectEffectType
  /** The connector / MCP id (or charge descriptor) the effect acts on. */
  target: string
  /** Free-text context for a would-be taker. `''` when none. */
  note: string
  /** The workspace display name that posted it (public identity). */
  postedBy: string
  postedAt: number
  /** `open` = awaiting a taker; `done` = a Contributor fired the effect. */
  status: 'open' | 'done'
  /** The Commission that resolved it (D19 standing dispatch, or a later manual
   *  path) + its Agent's display label — the public credit line. */
  resolvedBy?: string
  resolvedByLabel?: string
  resolvedAt?: number
}

/** Body of `POST /v1/projects/:id/open-subgoals` — post a work item. */
export interface PostOpenSubGoalRequest {
  subGoal: string
  type: ProjectEffectType
  target: string
  note?: string
}
