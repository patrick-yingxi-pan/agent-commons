/** ── Contract: Projects / Artifacts / Schedules ────────────────────────────
 *  The entity types behind the sidebar's cross-cutting tools. Shared by the UI
 *  and the backend; the seed *data* that fills these shapes lives server-side
 *  (server/data/cowork.ts). */
import type { ArtifactKind } from './entities.ts'

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

/** One past execution of a scheduled task. `reachedStep` is how far the run got
 *  (drives the detail rail's relight: steps 0..reachedStep-1 turn green; a failed
 *  run stops red at `reachedStep`). `summary` is the one line of what it produced. */
export interface ScheduledRun {
  id: string
  status: 'ok' | 'failed' | 'running' | 'skipped'
  duration: string
  reachedStep: number
  summary: string
  /** When the run executed (epoch ms). Backs both the live "time ago" label
   *  (src/lib/relativeTime) and the newest-first ordering of the left rail's
   *  "recent runs" across routines. Larger = more recent. */
  at: number
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
  name: string
  cadence: string
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
  /** Whether a failed run pings the owner. A routine-local setting (like
   *  `enabled`), not a cross-entity relation. Absent = on (the prior UI default). */
  notifyOnFailure?: boolean
  timezone?: string
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
  kind: ArtifactKind
  meta: string
  /** The tenant this artifact belongs to — the isolation boundary on the web (F2/PD9).
   *  Unset on a seed/legacy artifact ⇒ the backend's default tenant. A created artifact is
   *  stamped with its creator's tenant; `relationGraph(tenantId)` projects the graph so a
   *  tenant sees only its own created artifacts. (Independent of `projectId`, since an
   *  artifact can be saved without a project.) */
  tenantId?: string
  /** The conversation that produced it. */
  source: string
  /** The project it belongs to (groups the Artifacts gallery). */
  projectId: string
  /** A one-line preview shown on the card and in the viewer. */
  excerpt?: string
  /** When it was last edited (epoch ms). The UI renders a live "time ago" label
   *  from it (src/lib/relativeTime) so the stamp advances instead of freezing. */
  editedAt: number
}

export interface DispatchRun {
  id: string
  title: string
  status: 'running' | 'done' | 'failed'
  /** When the run started (epoch ms). The UI renders a live "time ago" label —
   *  "started 4 minutes ago" while running, "4 minutes ago" once it's settled. */
  startedAt: number
  detail: string
}
