/** ── Contract: Projects / Artifacts / Schedules ────────────────────────────
 *  The entity types behind the sidebar's cross-cutting tools. Shared by the UI
 *  and the backend; the seed *data* that fills these shapes lives server-side
 *  (server/data/cowork.ts). */
import type { ArtifactKind } from './entities.ts'
import type { ProjectRole } from './roles.ts'
import type { ScheduledArtifactSpec } from './scheduledArtifact.ts'

/** A scheduled run that belongs to a project (shown in the project's right-hand
 *  panel). Mirrors the shape of the global ScheduledTask but scoped to one
 *  project, so a project can list its own cadence without a join. */
export interface ProjectSchedule {
  name: string
  cadence: string
  enabled: boolean
}

/** A piece of context attached to a project — a folder, a repo, a connector, or
 *  a knowledge doc. Drives the icon + label in the project's "Context" panel. */
export interface ProjectContext {
  kind: 'folder' | 'repo' | 'connector' | 'doc'
  label: string
  meta: string
  /** Stable origin for contexts whose display label is not an identity. In
   * particular, an inspected external MCP connection must survive project
   * round-trips without being reverse-mapped through the fixture catalog. */
  source?: ProjectContextSource
}

/** Stable identity carried by a project context when its display label is not
 * authoritative (currently external MCP connections). Kept deliberately
 * narrow so a persisted/source selector cannot become an execution payload. */
export interface ProjectContextSource {
  kind: 'mcp'
  id: string
}

/** Runtime boundary guard for the optional source selector. This is shared by
 * relation-op admission and snapshot validation; callers must not coerce
 * boxed/array values into an identity. */
export function isProjectContextSource(value: unknown): value is ProjectContextSource {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  const keys = Object.keys(row).sort()
  return keys.length === 2 && keys[0] === 'id' && keys[1] === 'kind' &&
    row.kind === 'mcp' && typeof row.id === 'string' &&
    row.id.length > 0 && row.id.length <= 512 && !/[\u0000-\u001f\u007f]/.test(row.id)
}

export interface Project {
  id: string
  name: string
  description: string
  /** The tenant this project belongs to — the isolation boundary on the web (F2/PD9).
   *  Unset on a seed/legacy project ⇒ the backend's default tenant (personal on desktop).
   *  A created project is stamped with its creator's tenant; `relationGraph(tenantId)`
   *  projects the graph so a tenant sees only its own created projects. */
  tenantId?: string
  /** When the project was last touched (epoch ms). The UI renders a live "time
   *  ago" label from it (src/lib/relativeTime), like an artifact's editedAt. */
  updatedAt: number
  /** Custom instructions Claude follows inside this project (right panel). */
  instructions: string
  /** Recurring runs scoped to this project (right panel). */
  scheduled: ProjectSchedule[]
  /** Folders, repos, connectors, and docs this project carries (right panel). */
  contexts: ProjectContext[]
  /** Sessions that live in this project (main panel) — ids into the session
   *  catalog so each row opens the real thread. */
  sessionIds: string[]
  /** When set, this Project is a *guarded shared resource* (docs/agent-commons.md,
   *  D11): its non-monotonic effects serialize at a resource guardian keyed by this
   *  id — the D5 guardian lifted from a context element to the Project. Unset =
   *  unguarded (coordination-free). */
  guardianId?: string
  /** The **per-commissioner abuse cap** (docs/agent-commons.md, D13): the maximum number
   *  of active Commissions this Project may hold. D13 names this as a cost owner-pays
   *  accepts — "a malicious Project could commission many outsiders' Agents to burn their
   *  plans" — so the Guardian refuses a new Commission past the cap (fail-closed,
   *  `limit_exceeded`). The prototype has one account, so the cap is keyed at the Project
   *  (its Guardian); a true per-*commissioner* identity is forward. Unset = uncapped. */
  commissionCap?: number
  /** The Project's optional **default contributor role** (D14) — a pure UI shortcut
   *  (INV-9, the same shape as a registry's `isDefault`): the role the commissioning
   *  surfaces PRE-SELECT for a new Contributor on this Project. The API never resolves
   *  to it — `CreateCommissionRequest.role` stays required — and unset simply means
   *  "no project preference" (pickers fall back to `writer`, the D14 baseline, chosen
   *  visibly at the edge). Owner-set via the `set-project-default-role` relation op;
   *  served cross-tenant on a shared Project so a visitor's picker pre-selects the
   *  owner's preference too. */
  defaultRole?: ProjectRole
  /** When true, this Project is a **shared workspace** across tenants (P8 — the Agent
   *  Commons "many users' agents on one shared Project"). A shared Project is visible to
   *  every tenant and open to cross-tenant **Contributors**: a *different* tenant may
   *  commission its OWN agent onto it (D13 owner-pays — that tenant's agent, that tenant
   *  pays), where a private Project refuses the cross-tenant commission (F2 isolation).
   *  Unset ⇒ private to its owning `tenantId` (the default). The owner sets it via the
   *  `share-project` relation op; each Contributor's authority is still clamped to the
   *  Project's admitted set (D12) regardless of sharing. */
  shared?: boolean
  /** Projection-stamped public identity: the owning workspace's DISPLAY name — the same
   *  public face the D17 directory shows ("by Ada Lab"), never a raw foreign tenant id.
   *  Set by the server's per-tenant registry/graph projections. Raw seed rows and
   *  older snapshots may omit it. */
  ownerName?: string
  /** Viewer-relative, projection-stamped: whether the CALLER's tenant owns this row.
   *  Drives the owner/visitor affordance split on the project page — owner-only controls
   *  (share, instructions, contexts) render only when this isn't `false`. Unset (seed
   *  rows, older snapshots) ⇒ treat as own. */
  own?: boolean
}

/** The hue of a workflow step's tool chip. Connector/MCP/repo/workspace map onto
 *  the shared palette; 'web' and 'claude' are rendered neutral (a built-in tool /
 *  a pure-reasoning step) so the rail never has a colorless hole. */
export type StepToolTone = 'connector' | 'mcp' | 'repo' | 'workspace' | 'web' | 'claude'

/** The tool a single workflow step leans on — drives the step chip's icon, label,
 *  and tone, and (via `needsAuth`) the amber marker that explains a failed run. */
export interface StepTool {
  id: string
  label: string
  tone: StepToolTone
  needsAuth?: boolean
}

/** One ordered step in a scheduled task's workflow — an imperative action and the
 *  tool it uses. Renders as a single node on the detail page's vertical rail. */
export interface WorkflowStep {
  id: string
  action: string
  tool: StepTool
}

/** Where a task's output lands — the rail's terminal node and the "Delivers to"
 *  side panel. */
export interface ScheduledDelivery {
  tool: StepTool
  target: string
  note?: string
}

/** Queue-time intent, never a substitute for live permission. Null/empty mean
 * no standing output/tool approval; later grants apply only to the next run. */
export interface ScheduledStanding {
  artifact: ScheduledArtifactSpec | null
  tools: StepTool[]
}

/** The authored definition frozen when a durable run is queued. Later routine
 *  edits apply to the next run; live registry/authority/budget state is still
 *  resolved at each attempt so revocation remains immediate. */
export interface ScheduledExecution {
  definitionRevision: number
  trigger: string
  prompt: string
  steps: WorkflowStep[]
  delivery: ScheduledDelivery
  /** Absent only on legacy jobs: current graph state cannot reconstruct their
   * historical approvals, so no standing authority may be inferred from it. */
  standing?: ScheduledStanding
  agentId: string
  providerId: string
  modelId?: string
  effort?: string
}

/** One past execution of a scheduled task. `reachedStep` is how far the run got
 *  (drives the detail rail's relight: steps 0..reachedStep-1 turn green; a failed
 *  run stops red at `reachedStep`). `summary` is the one line of what it produced. */
export interface ScheduledRun {
  /** Opaque durable identity. A keyed manual request derives the same id across
   * response loss or server restart; callers must not parse its representation. */
  id: string
  status: 'ok' | 'failed' | 'running' | 'skipped'
  duration: string
  reachedStep: number
  summary: string
  /** When the run executed (epoch ms). Backs both the live "time ago" label
   *  (src/lib/relativeTime) and the newest-first ordering of the left rail's
   *  "recent runs" across routines. Larger = more recent. */
  at: number
  /** The cadence occurrence this run satisfies (epoch ms). Present for
   *  scheduler-fired runs and absent for manual run-now. Together with the
   *  routine id this is the durable idempotency key. */
  scheduledFor?: number
  /** Durable execution state. A running row survives process restart and the
   *  routine worker resumes at `nextAttemptAt`; absence marks a legacy synthetic
   *  run, which the rehydrate sweep may safely fail closed. */
  attempts?: number
  maxAttempts?: number
  nextAttemptAt?: number
  execution?: ScheduledExecution
  failureCode?:
    | 'model_unavailable'
    | 'model_loop_limit'
    | 'context_unavailable'
    | 'authority_denied'
    | 'budget_exceeded'
    | 'execution_error'
  /** The output this specific run produced — the body of its session thread, so
   *  two runs of the same routine read as distinct history (the briefing it
   *  wrote, the digest it posted, what tripped a failure). Optional: a run
   *  without one falls back to a recap generated from its steps + summary. */
  detail?: string
}

/** A scheduled task isn't a cron toggle — it's a recurring agentic workflow: on a
 *  cadence Claude runs an ordered sequence of steps (each using a tool) and
 *  delivers the result somewhere. */
export interface ScheduledTask {
  id: string
  /** Monotonic server-owned revision of the routine's editable definition
   *  (name, prompt, cadence, workflow, delivery, model, and enabled state).
   *  Run progress/history is deliberately orthogonal, so a routine firing does
   *  not manufacture a conflict with a human definition edit. Absent on a
   *  legacy snapshot is revision 0. */
  revision?: number
  /** The tenant this routine belongs to — the isolation boundary on the web
   *  (F2/PD9). Unset on a legacy routine ⇒ the backend's default tenant; the
   *  six demo accounts' seed routines are stamped (docs/demo-accounts.md).
   *  `listSchedules(tenantId)` filters on it, like sessions. */
  tenantId?: string
  /** VIEWER-RELATIVE: does the reader own this routine? Computed at serve time
   *  (the `mine` pattern — never stored), because a social grant widens READS
   *  without widening ownership: a granted visitor opens a shared routine and
   *  may discuss or propose changes to it, but only the owner lands them or
   *  edits it directly. Absent ⇒ not owned. */
  own?: boolean
  name: string
  cadence: string
  /** Server-owned durable cursor for the next cadence occurrence (epoch ms).
   *  Optional so snapshots written before the scheduler upgrade still load. */
  nextFireAt?: number
  next: string
  enabled: boolean
  lastStatus: 'ok' | 'failed' | 'pending'
  /** Plain-language one-liner for the row + detail header sub-line. */
  subtitle: string
  /** The human "when" sentence for the workflow's WHEN band (no cron syntax). */
  trigger: string
  /** The verbatim instruction every run executes against. */
  prompt: string
  /** The ordered workflow — the detail page's centerpiece. */
  steps: WorkflowStep[]
  /** The terminal: where each run's output goes. */
  delivery: ScheduledDelivery
  /** Recent executions, newest first. */
  runs: ScheduledRun[]
  /** Model + effort the task runs on, e.g. "Claude Opus 4.8 · High". */
  model: string
  /** The worker identity and endpoint/model binding used by headless runs.
   *  Optional only for snapshots written before real routine execution; legacy
   *  rows resolve to the shared default Agent and their label is backfilled. */
  agentId?: string
  providerId?: string
  modelId?: string
  effort?: string
  /** Whether a failed run pings the owner. A routine-local setting (like
   *  `enabled`), not a cross-entity relation. Absent = on (the prior UI default). */
  notifyOnFailure?: boolean
  timezone?: string
  /** What to do with a cursor found overdue after process downtime. Absence is
   *  the conservative default: record the miss and skip to the next occurrence. */
  missedFirePolicy?: 'skip' | 'catch-up-once'
  /** Faint "Started … · N runs" stamp for the Schedule panel. */
  startedLabel?: string
  /** Home project, if any — cross-links into the Projects section. */
  projectId?: string
  /** The context elements this routine's runs operate through — so a scheduled
   *  (unprompted) run's effects inherit the same mediation as an interactive turn
   *  (Tier C of docs/shared-resource-coordination.md). Ids into the session ↔
   *  context binding; absent / empty = the routine produces no resource-scoped
   *  effects. */
  contextIds?: string[]
}

/** A starter a user can spin up from "New schedule" — a fully-formed workflow
 *  (steps, cadence, delivery, prompt) seeded into state as a new, paused task. */
export interface ScheduleTemplate {
  category: string
  name: string
  preview: string
  /** Everything but the id — the id is minted when the user adds it. */
  seed: Omit<ScheduledTask, 'id'>
}

export interface ArtifactItem {
  id: string
  name: string
  /** Display-name ordering only; document content has its own body revision. */
  metadataRevision?: number
  /** Independent Trash/restore ordering; absent legacy state is active at zero. */
  lifecycleRevision?: number
  /** Immutable save provenance, stamped by the materializer, never renamed.
   * Keeps historical save proposals recognized after the display name changes. */
  saveOrigin?: { name: string; source: string }
  kind: ArtifactKind
  meta: string
  /** The tenant this artifact belongs to — the isolation boundary on the web (F2/PD9).
   *  Unset on a seed/legacy artifact ⇒ the backend's default tenant. A created artifact is
   *  stamped with its creator's tenant; `relationGraph(tenantId)` projects the graph so a
   *  tenant sees only its own created artifacts. (Independent of `projectId`, since an
   *  artifact can be saved without a project.) */
  tenantId?: string
  /** VIEWER-RELATIVE: does the reader own it? Computed at serve time (the `mine`
   *  pattern), because a social grant widens READS without widening ownership —
   *  a granted reader opens a shared artifact and must not get its filing or
   *  deletion controls. Absent on payloads served without a reader in hand;
   *  treat absent as NOT owned. */
  own?: boolean
  /** The conversation that produced it — its TITLE (display only). */
  source: string
  /** The producing conversation's ID — the stable join the "From ‹conversation›"
   *  door resolves by (a title is mutable: a rename must not break the door, and
   *  two sessions can share one). Unset on seed/legacy artifacts, which fall back
   *  to a title lookup. */
  sourceSessionId?: string
  /** Server-owned standing delivery binding. A routine refreshes this one
   * artifact across runs and renames; display names never authorize a write.
   * Absent on independent and legacy artifacts (no inferred write authority). */
  sourceScheduleId?: string
  /** The project it belongs to (groups the Artifacts index). */
  projectId: string
  /** A one-line synopsis shown in the index and on the artifact page. */
  excerpt?: string
  /** Server-stamped provenance: body previews follow current saved content.
   * Absence preserves an explicit or legacy synopsis without guessing intent. */
  excerptSource?: 'body'
  /** When it was last edited (epoch ms). The UI renders a live "time ago" label
   *  from it (src/lib/relativeTime) so the stamp advances instead of freezing. */
  editedAt: number
}

export interface DispatchRun {
  /** Opaque durable identity. A keyed first-party create derives the same id
   * for this tenant across response loss or server restart. */
  id: string
  /** The tenant this one-off run belongs to (F2/PD9) — unset ⇒ the backend's
   *  default tenant, mirroring sessions/routines. */
  tenantId?: string
  title: string
  status: 'running' | 'done' | 'failed'
  /** When the run started (epoch ms). The UI renders a live "time ago" label —
   *  "started 4 minutes ago" while running, "4 minutes ago" once it's settled. */
  startedAt: number
  detail: string
  /** Absent on historical simulations. A real run owns one ordinary private
   * conversation; replied means a model reply is saved, not that its proposed
   * external actions were executed. Interrupted work never resumes itself. */
  execution?: import('./dispatchExecution.ts').DispatchBinding & {
    kind: 'conversation'
    sessionId: string
    state: 'running' | 'replied' | 'failed' | 'interrupted' | 'cancelled'
    messageId?: string
  }
}
