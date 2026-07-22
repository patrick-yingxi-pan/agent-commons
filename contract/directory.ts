/** ── Contract: the discovery directories (docs/agent-commons.md, D17) ────────
 *  Cross-tenant, read-only listings of what owners made public: shared Projects and
 *  published Agents. A directory NEVER widens visibility — each entry is the row's
 *  existing public face (the P8 `publicSharedProject` redaction; the D18 published
 *  definition) plus aggregates that are themselves public acts (Contributor count,
 *  open work, contributions, forks). Search is a case-insensitive substring over
 *  name/description — a mechanism; ranking is deliberately absent (D17). */
import type { ProjectEffectType } from './coordination.ts'
import type { PrincipalKind } from './identity.ts'
import type { AgentChangelogEntry } from './workers.ts'

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
  /** The definition version (D25) — what a fork takes, what a proposal targets. */
  version: number
  /** The published changelog (D25) — the definition's public authorship record. */
  changelog: AgentChangelogEntry[]
}

/** One comment on a work item (D23) — the flat discussion thread that makes open
 *  work a coordination medium, not just a queue. Lives ON the item, so its
 *  visibility can never diverge from the backlog's. Append-only (no edit/delete —
 *  a public act, like the audit trail); attribution is the display name. */
export interface WorkItemComment {
  id: string
  /** The commenting workspace's display name (public identity, like `postedBy`). */
  author: string
  /** What KIND of principal authored it (FWD-5 Phase 1) — the redaction-safe face of
   *  the server-side `PrincipalRef` stamp. Absent = unattributed (a pre-Phase-1 row,
   *  or a foreign A2A commenter — then `author` is the verified peer name, D28). */
  authorKind?: PrincipalKind
  body: string
  at: number
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
  /** Viewer-relative: may the caller retract it? Standing is the POSTER or the
   *  Project OWNER, both compared by raw tenant id server-side — which the wire
   *  face deliberately strips, so a client CANNOT derive this correctly. Gating
   *  on `postedBy === myName` (as the UI did) is wrong in both directions: a
   *  renamed workspace loses the control it holds, and a colliding display name
   *  is shown one that 403s. Computed by the same predicate `retractOpenSubGoal`
   *  enforces. */
  canRetract?: boolean
  /** The posting principal's KIND (FWD-5 Phase 1) — see `WorkItemComment.authorKind`. */
  postedByKind?: PrincipalKind
  postedAt: number
  /** `open` = awaiting a taker; `done` = a Contributor fired the effect;
   *  `retracted` = closed unresolved by its poster or the Project owner (D23 —
   *  open items only: a `done` item is immutable history, credit already accrued). */
  status: 'open' | 'done' | 'retracted'
  /** The flat discussion thread (D23). Optional: items minted before the feature
   *  (older persisted snapshots) carry none — read as `?? []`. */
  comments?: WorkItemComment[]
  retractedAt?: number
  /** Who closed it (display name) — the poster or the Project owner. */
  retractedBy?: string
  /** The retracting principal's KIND (FWD-5 Phase 1). */
  retractedByKind?: PrincipalKind
  /** How the item arrived: unset = the native route; `'a2a'` = posted by a foreign
   *  agent through the A2A edge (D20). Provenance only — never an authority
   *  distinction (both paths pass the identical walls). */
  via?: 'a2a'
  /** D28 — the REGISTERED name of the verified peer that posted it (present only
   *  when the A2A call carried a valid peer credential; `postedBy` then equals it).
   *  A verification stamp, still never an authority distinction. */
  verifiedPeer?: string
  /** The Commission that resolved it (D19 standing dispatch, or a later manual
   *  path) + its Agent's display label — the public credit line. The resolving
   *  principal needs no separate stamp (FWD-5): a resolution is definitionally an
   *  AGENT act, and this field already records the GRANT it acted under — the
   *  full attribution chain (who / under what authority / on whose thing). */
  resolvedBy?: string
  resolvedByLabel?: string
  /** The resolving Agent's OWNER namespace display name (FWD-5 Phase 3) —
   *  captured at resolution time like `resolvedByLabel` (the act's record, not a
   *  live lookup that a later commission delete would erase). Completes the
   *  attribution chain's owner leg on the wire; absent on pre-Phase-3 rows. */
  resolvedByOwner?: string
  resolvedAt?: number
}

/** ── The workspace profile — a name's ONE public face (D21) ─────────────────
 *  `GET /directory/owners/:name` (URL-encoded display name — the public identity
 *  the directories and `postedBy` already use; a raw tenant id never crosses).
 *  A pure aggregation of rows that are ALREADY public: the workspace's shared
 *  Projects, its published Agents, stats that are themselves public acts, and a
 *  recent-activity feed of those acts. Viewer-independent except the
 *  viewer-relative `own` flags (COMMONS-13 posture); a name with no public rows
 *  404s (existence-hiding, extended to identities). */
export interface OwnerActivity {
  /** `posted` = put a work item on a shared Project's backlog; `resolved` = one of
   *  this workspace's Agents fired the effect that completed an item (D19 credit);
   *  `authored` = this workspace's merged proposal became version N of ANOTHER
   *  owner's published definition (D27 — provenance surfaced, not D13 reputation). */
  kind: 'posted' | 'resolved' | 'authored'
  at: number
  /** The Project door (`posted`/`resolved` kinds). */
  projectId?: string
  projectName?: string
  /** The work item's sub-goal — or, for `authored`, the changelog note. */
  subGoal?: string
  /** `resolved`: the acting Agent's label; `authored`: the evolved definition's. */
  agentLabel?: string
  /** `authored` only — the version this workspace's merge became. */
  version?: number
  /** `authored` only — the OTHER owner whose definition this evolved (a public display
   *  name, so the activity line can be a ref link to their profile, matching the
   *  posted/resolved project doors); plus the definition's public id. Never a tenant id. */
  owner?: string
  agentId?: string
}

/** One item a published Agent resolved on a SHARED Project (D13 — the concrete acts
 *  behind the contribution count, the way a contribution graph links to the actual
 *  work). Public-face and P8-REDACTED: only resolutions on shared Projects are served —
 *  a private-Project resolution never appears here (it isn't publicly visible). */
export interface AgentResolvedItem {
  projectId: string
  projectName: string
  /** The resolved work item's own id — the row's door to the item's canonical page
   *  (`/projects/:id/work/:itemId`), whose timeline IS the contribution's detail. */
  itemId: string
  subGoal: string
  resolvedAt: number
}

/** One PUBLIC fork of a published definition (D18) — a directory entry whose
 *  `forkedFrom` names this agent. Deliberately a SUBSET of the fork counter:
 *  a fork lives in its owner's private registry until published, so this list
 *  enumerates only the forks that are themselves public acts (GitHub's
 *  public-forks shape — the count may honestly exceed the list). */
export interface AgentPublicFork {
  agentId: string
  label: string
  owner: string
  /** Viewer-relative (computed, never stored): this fork is yours. */
  own: boolean
  /** The source version the fork was taken at. */
  forkedAtVersion?: number
}

export interface OwnerProfileStats {
  sharedProjects: number
  publishedAgents: number
  /** D13 reputation earned by this workspace's published Agents. */
  contributions: number
  /** Times this workspace's published definitions were forked (D18). */
  forks: number
  /** Open items awaiting a taker across this workspace's shared Projects. */
  openWork: number
  /** Work items this workspace posted on shared Projects (any status). */
  workPosted: number
  /** Work items this workspace's Agents resolved — including on OTHERS' Projects. */
  workResolved: number
}

export interface OwnerProfile {
  /** The display name — the profile's handle and its public identity. */
  name: string
  /** Whether the caller's tenant IS this workspace (drives "(you)" chrome only —
   *  the page's content is identical for every viewer; that's the point). */
  own: boolean
  /** FWD-6 O3 — present when this name is an ORG the VIEWER holds a seat in
   *  (computed, viewer-relative — never stored). Unlocks the member panel and
   *  keeps the page serving for members before anything public exists. */
  org?: { id: string; role: import('./identity.ts').TenantRole }
  projects: ProjectDirectoryEntry[]
  agents: AgentDirectoryEntry[]
  stats: OwnerProfileStats
  /** Recent public acts, newest first (capped server-side). */
  activity: OwnerActivity[]
}

/** Body of `POST /v1/projects/:id/open-subgoals/:itemId/comments` (D23). */
export interface PostWorkItemCommentRequest {
  body: string
}

/** One row of the caller's cross-cutting "Your work" view: a work item THEY
 *  posted, decorated with the door coordinate the dashboard needs (the project's
 *  name — the id is already on the item). Same public redaction as the backlog. */
export interface MyWorkItem extends OpenSubGoal {
  projectName: string
}

/** A change proposal the caller AUTHORED against a published definition,
 *  decorated with the definition's public face (label + owner display name) so
 *  the dashboard row can name and open it. Same redaction as the review read.
 *  (An intersection, not `extends` — `AgentChangeProposal` lives in workers.ts,
 *  which already imports this module; the alias keeps the type cycle inert.) */
export type MyWorkProposal = import('./workers.ts').AgentChangeProposal & {
  agentId: string
  agentLabel: string
  agentOwner: string
}

/** Answer of `GET /v1/me/work` — the caller's coordination dashboard (the GitHub
 *  "your issues / your pull requests" analog): everything they are waiting on or
 *  following to a verdict, open items first. Both lists are the caller's OWN acts
 *  — tenancy is the filter itself, never a parameter. */
export interface MyWork {
  posted: MyWorkItem[]
  proposals: MyWorkProposal[]
}

/** Body of `POST /v1/projects/:id/open-subgoals` — post a work item. */
export interface PostOpenSubGoalRequest {
  subGoal: string
  type: ProjectEffectType
  target: string
  note?: string
}
