/** ── Contract: Commission (the agent→Project assignment — D7 / D13) ──────────
 *  The **act** of assigning a worker Agent to a shared Project (docs/agent-commons.md):
 *  the leaf of the D8 attenuation cascade. A Commission carries an optional authority
 *  grant and token sub-budget, each a **subset of the Agent's** (which is itself a
 *  subset of its provider's) — validated once at the creation funnel. An Agent
 *  Commissioned onto a Project plays the **Contributor** role (a role, not a fifth
 *  entity). The Agent's owner pays for its compute (D13: owner-pays), so committing an
 *  Agent to a public Project is donating your own metered compute.
 *
 *  A first-class entity (not a `RelationGraph` edge) precisely so the Project's Guardian
 *  can key its reservation ledger by `commissionId` (D11). */
import type { Authority } from './authority.ts'
import type { Budget } from './budget.ts'

export interface Commission {
  id: string
  /** The worker Agent commissioned. Its owner pays for the compute (D13). */
  agentId: string
  /** The shared Project it contributes to. */
  projectId: string
  /** The authority this Agent actually carries onto the Project — a subset of the
   *  Agent's (D8/D12), validated at the funnel. Absent = inherit the Agent's authority.
   *  The wall against one Contributor reaching another's accounts (D12). */
  authority?: Authority
  /** A per-commission token sub-budget — a subset of the Agent's (D8). Absent =
   *  inherit. The leaf of the cascade. */
  grant?: Budget
  /** The Guardian reservation this Contributor holds on the Project (D11), if any —
   *  set when a sub-goal is reserved. Forward; unset for now. */
  reservationId?: string
}

/** The POST body to commission an Agent onto a Project — everything but the
 *  server-minted `id` and the forward `reservationId`. */
export interface CreateCommissionRequest {
  agentId: string
  projectId: string
  authority?: Authority
  grant?: Budget
}

/** Re-grant a commission — narrow (or restore) the authority / sub-budget it carries
 *  onto the Project (D8/D12). Re-validated against the Agent's ceiling at the funnel.
 *  A present field is applied; an absent one is left unchanged. */
export interface UpdateCommissionRequest {
  authority?: Authority
  grant?: Budget
}
