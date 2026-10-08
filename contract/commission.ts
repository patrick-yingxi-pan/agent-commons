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
import type { ProjectRole } from './roles.ts'

export interface Commission {
  id: string
  /** Viewer-relative write ownership. Server list/detail projections always
   * stamp this for authenticated reads; absent remains legacy-compatible. */
  mine?: boolean
  /** Server-owned ordering for editable contributor configuration (role, standing,
   *  authority, and grant). Legacy/seeded absence reads as revision 0. */
  configurationRevision?: number
  /** The tenant that created it (F2/PD9). Unset ⇒ a seeded/shared entry visible to every
   *  tenant; a created one is private to its tenant. */
  tenantId?: string
  /** The worker Agent commissioned. Its owner pays for the compute (D13). */
  agentId: string
  /** The shared Project it contributes to. */
  projectId: string
  /** The commissioned Agent's display label, resolved by the SERVER on the **public
   *  (cross-tenant) face** of a shared Project's Contributor (P8): a non-owner can't
   *  resolve a foreign `agentId` against its own registry, and "who contributes" is
   *  exactly what the shared list exposes. Identity only — never authority/grant.
   *  Absent on a caller's own commissions (the UI resolves those locally). */
  agentLabel?: string
  /** The Contributor's **role** on the Project (D14) — owner / maintainer / writer /
   *  reader: the permission baseline (`rolePermits`) and the arbitration rank
   *  (`roleRank`). Required at the creation funnel (INV-9: an unset role is refused,
   *  never defaulted — the commissioning surface pre-selects the Project's optional
   *  `defaultRole`, a UI shortcut). Optional HERE only for rows stored before that
   *  strictness, which READ as `'writer'` — legacy tolerance, not a write path. */
  role?: ProjectRole
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
  /** **Standing** (docs/agent-commons.md, D19): this Contributor volunteers to take the
   *  Project's open work. Development simulates dispatch in role-rank order
   *  through the guarded fixture effect path; releases leave posted work open.
   *  Set by the commission's OWNER, but this saved configuration does not grant
   *  real unattended execution or external-tool authority (MOCK-9).
   *  Unset/false ⇒ no simulated standing dispatch (default). */
  standing?: boolean
}

/** The POST body to commission an Agent onto a Project — everything but the
 *  server-minted `id` and the forward `reservationId`. */
export interface CreateCommissionRequest {
  agentId: string
  projectId: string
  /** The role to grant (D14). **Required** (INV-9): the API never picks a role for the
   *  caller — a missing role is refused (400). The commissioning UI pre-selects the
   *  Project's optional `defaultRole` (else `writer`), visibly, before the request. */
  role: ProjectRole
  authority?: Authority
  grant?: Budget
  /** Volunteer for the Project's open work (D19). Absent ⇒ false. */
  standing?: boolean
}

/** Re-grant a commission — narrow (or restore) the authority / sub-budget it carries
 *  onto the Project (D8/D12). Re-validated against the Agent's ceiling at the funnel.
 *  A present field is applied; an absent one is left unchanged. */
export interface CommissionConfigurationPatch {
  /** Re-assign the Contributor's role (D14). Absent ⇒ unchanged. */
  role?: ProjectRole
  /** Sparse by authority dimension: omitted tools/connectors/scopes remain unchanged;
   * a present array replaces only that dimension. */
  authority?: Authority
  grant?: Budget
  /** Flip the D19 standing flag. Absent ⇒ unchanged. */
  standing?: boolean
}

/** `expectedRevision` is an optional compare-and-swap precondition. Absence keeps
 * the legacy unconditional-write meaning; first-party editors always send it. */
export type UpdateCommissionRequest = CommissionConfigurationPatch & {
  expectedRevision?: number
}

/** Body of `DELETE /v1/commissions/:id`. A supplied configuration revision
 * pins removal to the Contributor the person reviewed; absence preserves the
 * legacy unconditional-delete meaning for existing API clients. */
export interface DeleteCommissionRequest {
  expectedRevision?: number
}
