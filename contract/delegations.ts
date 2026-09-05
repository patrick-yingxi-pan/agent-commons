/** ── Contract: Delegations — judgment as delegable work (CW8, Phase F) ───────
 *  (docs/design/agent-contribution-workflow.md.) A Delegation lets a project
 *  owner hand a JUDGMENT MOMENT — approving an effect envelope, landing a
 *  contribution — to one of their worker Agents, under a written policy. The
 *  governing invariant is the conservation law: **delegation transfers labor,
 *  never liability** — a delegated decision executes AS the delegator, stamped
 *  with BOTH identities, and the delegator owns it as if made personally.
 *
 *  Three structural refusals at the mint funnel (not policy suggestions):
 *  - an EMPTY policy: a delegation with no written judgment is a blank check;
 *  - an escalation set missing `'effectful'`: **the floor is not delegable** —
 *    an irreversible act always escalates back to the human (the Phase C/E
 *    floor survives delegation), so a delegation that wouldn't wake its human
 *    for the hard quadrant is unrepresentable;
 *  - a delegate Agent the delegator doesn't own (judgment can't be outsourced
 *    to a stranger's worker).
 *
 *  The DECISION itself ("does the policy admit this?") is the declared
 *  model-seam — the mock engine always finds the policy satisfied; production
 *  points it at the delegate agent. The ESCALATION TRIGGERS are mechanical
 *  and real: structural conditions checked before any decision runs. */
export type DelegatedActKind = 'approve-envelope' | 'land'
export const DELEGATED_ACT_KINDS: DelegatedActKind[] = ['approve-envelope', 'land']

/** The mechanical escalation vocabulary — conditions that force the delegate
 *  NOT to decide and to wake the human instead. `effectful` (irreversible
 *  envelope lines, declared or executed) is mandatory on every delegation. */
export type EscalationTrigger = 'effectful' | 'unreviewed' | 'stranger'
export const ESCALATION_TRIGGERS: EscalationTrigger[] = ['effectful', 'unreviewed', 'stranger']

export interface Delegation {
  id: string
  projectId: string
  /** The delegate — one of the DELEGATOR's own worker Agents. */
  agentId: string
  agentLabel: string
  actKind: DelegatedActKind
  /** The delegator's judgment criteria, in their words. OWNER-ONLY on the
   *  wire (absent for other viewers): the roster of who-may-decide is public
   *  governance; the judgment text is the delegator's own instrument. */
  policy?: string
  escalation: EscalationTrigger[]
  /** The autonomy rung (CW8's ladder, L1/L2): `draft` records what the
   *  delegate WOULD decide (confirm-the-guess); `decide` executes it.
   *  Promotion is the delegator's explicit edit — offered, never automatic. */
  mode: 'draft' | 'decide'
  createdAt: number
  /** Viewer-relative (computed, never stored): the caller is the delegator. */
  mine?: boolean
}

/** Body of `POST /v1/projects/:id/delegations`. */
export interface CreateDelegationRequest {
  agentId: string
  actKind: DelegatedActKind
  policy: string
  /** Extra triggers beyond the mandatory `effectful` (which the server adds
   *  if omitted — stating it is fine, dropping it is impossible). */
  escalation?: EscalationTrigger[]
  mode?: 'draft' | 'decide'
}

/** Body of `DELETE /v1/projects/:id/delegations/:did`.
 *
 * Delegations are immutable authority rows, so their creation stamp is the
 * complete compare boundary: a revocation may remove only the exact grant the
 * person saw. Omission preserves the legacy unconditional-delete contract for
 * older callers. */
export interface DeleteDelegationRequest {
  expectedCreatedAt?: number
}
