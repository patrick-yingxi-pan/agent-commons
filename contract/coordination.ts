/** ── Contract: multi-principal coordination (D11) ───────────────────────────
 *  Agent Commons promotes the coordination doc's hardest residue — *different users'*
 *  Contributors on one Project — from edge case to **default** (docs/agent-commons.md,
 *  D11). The mechanism is **sub-goal reservation** at the Project's Guardian: "I'm
 *  handling the auth refactor" is a held, TTL'd, reversible reservation keyed
 *  `${guardianId}:${subGoal}`. Two Contributors on *different* sub-goals proceed
 *  concurrently (distinct resources); a second Contributor reaching for the *same*
 *  sub-goal is refused (`conflict`/409) and **re-reasons** — "conflict is a question,
 *  not an abort". The arbitration policy is **first-come** among equals; a higher project
 *  role (D14, `roleRank`) may win a *free or simultaneously-contested* lease, but **never
 *  preempts an in-flight hold** — and under this synchronous single-process mock there is no
 *  true simultaneity, so acquisition-priority is a no-op here (the rank is surfaced on the
 *  sub-goal for a real, async arbiter). */
import type { ReservationStatus } from './reservations.ts'
import type { ProjectRole } from './roles.ts'

/** The classes of **externally-effectful** Project action (D11/D12) — what a
 *  Contributor's effect on the shared Project does to the outside world. Distinct from
 *  the host `CapabilityType` (fs/terminal/process): these reach connectors, MCP servers,
 *  and billing — the Project-level effect axis the host classifier never covered. The
 *  union derives from the runtime list so a route can validate an incoming `type`. */
export const PROJECT_EFFECT_TYPES = [
  'connector.read',
  'connector.write',
  'mcp.query',
  'mcp.mutate',
  'charge',
] as const
export type ProjectEffectType = (typeof PROJECT_EFFECT_TYPES)[number]

/** Is a Project-level effect **monotonic** (CALM)? A monotonic effect only observes /
 *  queries — it adds no irreversible outside change another Contributor acted on, so it
 *  is coordination-free and bypasses the Guardian. Non-monotonic effects (a connector
 *  write, an MCP mutation, a charge) are the irreversible, one-timeline surface (D11's
 *  hard quadrant) and must hold a sub-goal reservation. The Project-level analog of
 *  `isMonotonic` (host capabilities) — the classifier OQ4 asked for, named to match it.
 *  See docs/agent-commons.md (D11, OQ4). */
export function isProjectEffectMonotonic(type: ProjectEffectType): boolean {
  return type === 'connector.read' || type === 'mcp.query'
}

/** Body of `POST /v1/projects/:id/effects` — a Contributor fires an externally-effectful
 *  action on a shared Project. The server enforces the Commission's connector/MCP reach
 *  (D12) and serializes a non-monotonic effect on its sub-goal reservation (D11). */
export interface ProjectEffectRequest {
  /** The Commission firing the effect — its Project-clamped reach is the D12 wall. */
  commissionId: string
  /** The sub-goal this effect belongs to — the reservation key (D11). */
  subGoal: string
  /** What the effect does to the outside world (decides monotonic vs guarded). */
  type: ProjectEffectType
  /** The connector / MCP id (or charge descriptor) the effect acts on. */
  target: string
}

/** Result of a Project effect — mock fulfilment; the wire shape is real. */
export interface ProjectEffectResult {
  projectId: string
  commissionId: string
  type: ProjectEffectType
  target: string
  /** Whether the Guardian serialized this effect (non-monotonic on a guarded Project) or
   *  it ran coordination-free (monotonic, or an unguarded Project). */
  guarded: boolean
  output: string
}

/** A sub-goal currently reserved on a Project — one in-flight Contributor claim. */
export interface ProjectSubGoal {
  /** The sub-goal label (e.g. "auth-refactor"). */
  subGoal: string
  /** Who holds it — a Contributor identity (a commission id), or any principal. */
  holder: string
  /** The holder resolved to a human label (the Contributor's Agent label), or the
   *  holder id verbatim when it isn't a known commission. */
  holderLabel: string
  /** The holder's **project role** (D14), when the holder is a Contributor — the standing
   *  a contender is up against. Surfaced so acquisition-time arbitration *could* rank by it;
   *  it never preempts this in-flight hold (a contender is refused, not the holder displaced).
   *  Absent for a non-commission principal. */
  holderRole?: ProjectRole
  /** The underlying reservation, so a holder can release its claim. */
  reservationId: string
  status: ReservationStatus
}

/** Body of `POST /v1/projects/:id/subgoals` — claim a sub-goal on a Project. */
export interface ReserveSubGoalRequest {
  /** The Contributor (or principal) claiming the sub-goal. */
  holder: string
  /** The sub-goal label to reserve. */
  subGoal: string
}
