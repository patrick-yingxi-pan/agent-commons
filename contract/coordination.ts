/** ── Contract: multi-principal coordination (D11) ───────────────────────────
 *  Agent Commons promotes the coordination doc's hardest residue — *different users'*
 *  Contributors on one Project — from edge case to **default** (docs/agent-commons.md,
 *  D11). The mechanism is **sub-goal reservation** at the Project's Guardian: "I'm
 *  handling the auth refactor" is a held, TTL'd, reversible reservation keyed
 *  `${guardianId}:${subGoal}`. Two Contributors on *different* sub-goals proceed
 *  concurrently (distinct resources); a second Contributor reaching for the *same*
 *  sub-goal is refused (`conflict`/409) and **re-reasons** — "conflict is a question,
 *  not an abort". The arbitration policy is **first-come** (the escrow's capacity-1
 *  semantics, now multi-principal). */
import type { ReservationStatus } from './reservations.ts'

/** A sub-goal currently reserved on a Project — one in-flight Contributor claim. */
export interface ProjectSubGoal {
  /** The sub-goal label (e.g. "auth-refactor"). */
  subGoal: string
  /** Who holds it — a Contributor identity (a commission id), or any principal. */
  holder: string
  /** The holder resolved to a human label (the Contributor's Agent label), or the
   *  holder id verbatim when it isn't a known commission. */
  holderLabel: string
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
