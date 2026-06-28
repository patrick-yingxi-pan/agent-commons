# Agent Commons — implementation plan (effect-time enforcement + roles)

> **Status: Phases 1–3 complete ✅** (11 steps; typecheck + 385 tests + build green, each
> step `/code-review`'d). **Phase 4 greenlit and underway** — finishing all planned designs
> (D6 rename, per-axis editor, D8 gaps, D16 hand-off, D15 proxy) as real seams with mock
> fulfilment, same one-step-per-iteration rhythm.
>
> Derived from the settled design ([`agent-commons.md`](agent-commons.md), D6–D16).
> This is the **plan-of-record** *and* the loop's checklist: each iteration does the
> **next unchecked step only** — implement it with tests, run `/code-review` and fix
> every finding immediately, run `npm run typecheck` + `node --test` (and verify a UI
> step live), commit + push to `main`, then tick the box. Stop at the end of Phase 3;
> **do not start Phase 4** without explicit confirmation.

## Goal & scope

Make the **already-built** multi-tenant surface (slices 1–17) **enforced and
role-governed on real paths** — the mechanism the design points to as still unbuilt
(the only remaining "open item" in `agent-commons.md` is `commissionId` on
`CapabilityRequest`):

- **Phase 1 — OQ3:** effect-time D12 enforcement on the host invoke path (`scopes` face).
- **Phase 2 — OQ4:** a static Project-effect monotonicity classifier + a guarded
  Project-effect endpoint that also enforces the **connector** face of D12 (OQ3) and
  wires a real(mock) effect through the guardian (closes slice-4's "forward" note).
- **Phase 3 — D14:** GitHub-style project **roles** (permission baseline + enforcement
  + acquisition-priority arbitration, **no preemption**).

**Out of loop scope — Phase 4 (forward; confirm first):** D15 agent-to-agent proxy,
D16 hand-off + per-turn provenance, D8 spend-time enforcement + parent-shrink
propagation, the per-axis commission editor, the D6 filename rename.

**Conventions** (`AGENTS.md`): every step ships tests; `contract/*.ts` stays erasable +
framework/Node-free; one door to the backend (`src/api`); `typecheck` + `node --test`
green before a step is done; UI steps verified in the running app.

---

## Phase 1 — Effect-time D12 enforcement (OQ3)

- [x] **1.1 Contract — `commissionId?` on `CapabilityRequest`.** Add optional
  `commissionId?: string` to `CapabilityRequest` ([`contract/agents.ts:85`](agents.ts))
  with a doc comment: *the Commission that authorizes this effect; absent ⇒ the legacy
  single-tenant path, unchanged.* Erasable, additive, back-compat. **Lock:** `typecheck`
  + `contract-boundaries.test.ts` green (the field is type-checked; behaviour lands in 1.3).

- [x] **1.2 Store — fail-closed scope admission.** Add
  `store.commissionAdmitsTarget(commissionId, capability, target)` near
  [`commissionCanReach` (`server/store.ts:876`)](../server/store.ts): resolve
  `commissionAuthority` (the D12 clamp); **unknown commission ⇒ `false` (fail closed)**;
  effective `scopes` unrestricted ⇒ `true`; else `target` must fall within an admitted
  scope root (prefix) — reuse the invoke route's `scopeMatches`, lifting it to a shared
  pure helper if it is route-local (form-follows-function). **Tests:** `isolation.test.ts`
  — allow inside a root, deny outside, deny unknown commission, allow when unrestricted.

- [x] **1.3 Invoke route — enforce.** In `/runners/:id/invoke`
  ([`server/routes/index.ts:112`](../server/routes/index.ts)), when `commissionId` is
  present, after context mediation and before `runCapability` (~:170) refuse with
  `forbidden` (403) if `commissionAdmitsTarget` is false. Absent `commissionId` ⇒
  unchanged. **Tests:** `routes-invoke.test.ts` — in-reach 200, out-of-reach 403, unknown
  commission 403, no-`commissionId` unchanged.

## Phase 2 — Project-effect classifier (OQ4) + a guarded real effect

- [x] **2.1 Contract — `isProjectEffectMonotonic`.** Add `ProjectEffectType`
  (`'connector.read' | 'connector.write' | 'mcp.query' | 'mcp.mutate' | 'charge'`) and a
  pure `projectEffectMonotonic(type): boolean` (reads/queries monotonic;
  writes/mutate/charge not) — the non-host analog of `isMonotonic`
  ([`contract/agents.ts:21`](agents.ts)). **Tests:** a table test (one assert per member).

- [x] **2.2 Server — a guarded Project-effect endpoint.** `POST /projects/:id/effects`
  taking `{ commissionId, subGoal, type, target }`: (a) **OQ3 connector face** — enforce
  `commissionCanReach(commissionId, 'connectors', target)` ⇒ 403 if denied; (b) **OQ4 +
  guardian** — if `projectEffectMonotonic(type)` is false, run the mock effect through
  `guardSubGoalEffect(projectId, commissionId, subGoal, …)` (reserve→commit→release; 409
  on a concurrent different principal); monotonic ⇒ run unguarded. Wire through `src/api`
  if the UI needs it; otherwise contract + route only. **Tests:** new routes test —
  denied-connector 403, guarded effect commits, concurrent different principal 409,
  monotonic skips the guard.

## Phase 3 — Project roles (D14)

- [x] **3.1 Contract — role + permission table.** Added `ProjectRole` (owner ⊃ maintainer
  ⊃ writer ⊃ reader) + pure `rolePermits(role, action)` over read/write/reserve/fire/
  commission/configure (reader: read; **writer & maintainer: +write/reserve/fire — same
  actions, per the D14 table**; owner: +commission/configure) and `roleRank` (the lattice
  ordering acquisition-priority, used by Step 3.4). New `contract/roles.ts`. **Tests:**
  baseline + rank + monotone-up-the-lattice.

- [x] **3.2 Commission carries a role.** Add `role?: ProjectRole` to `Commission`,
  `CreateCommissionRequest`, `UpdateCommissionRequest`
  ([`contract/commission.ts:15/35/42`](commission.ts)); default `'writer'` at the funnel
  (`store.createCommission`). Thread create/update + the `commission-agent` RelationOp
  (optional `role?`, `describeOp` naming it). **Tests:** `commission.test.ts` +
  `routes-relations-commons.test.ts`.

- [x] **3.3 Enforce role permissions.** Compose role with the D12 checks: a non-monotonic
  host invoke (Phase 1) and a non-monotonic Project effect (Phase 2) require the
  commission's role to `rolePermits(role, 'fire')`; sub-goal reserve requires `'reserve'`.
  A reader is refused 403. **Tests:** invoke + project-effect + subgoal route tests with a
  reader commission.

- [x] **3.4 Acquisition-priority arbitration (no preemption).** On a sub-goal conflict,
  surface the current holder's role (`projectSubGoals` / the 409 path) so standing is
  visible; **document** that acquisition-priority is a *no-op under the mock's synchronous,
  single-process model* (no true simultaneity to arbitrate) and that **no preemption** of
  an in-flight hold is ever performed (the D14 invariant). **Tests:** a test asserting the
  holder's role is reported on conflict.

- [x] **3.5 UI — role selector + display.** Add a role `<select>` to `CommissionDialog`
  ([`src/components/SectionView.tsx:982`](../src/components/SectionView.tsx)) and show the
  role on `ContributorRow` (:937); default writer. **Verify live** (role persists, shows).

- [x] **3.6 Conversational role.** Let the model set a role when commissioning
  (`server/model/tools.ts` `commission_agent` + `intents.ts`) and surface it in the
  confirm card. **Tests:** `model-tools.test.ts` + `model-intents.test.ts`.

---

## Phase 4 — the forward mechanisms (greenlit — finish all planned designs)

Built as **real wire boundaries with mock fulfilment** (the project rule: build the real
seam now, mock only the model). Ordered safest/most-contained → most-speculative.

- [x] **4.1 D6 filename rename (cosmetic debt).** `server/agent-runtime.ts` →
  `server/runner-runtime.ts`, `server/data/agents.ts` → `server/data/runners.ts`; update the
  ~4 import sites (store, routes, capabilities test). **Lock:** full suite green (no behavior
  change) — closes the last D6 remainder.

- [x] **4.2 Per-axis commission editor (UI).** `CommissionDialog` now edits **both** Project-
  reach axes — connectors **and file scopes** — via a shared `AdmittedChecklist` primitive (same
  role ⇒ same look); re-grant sends both and the leaf funnel re-validates. Verified live (scopes
  narrow + persist) + a node test that narrowing scopes tightens `commissionAdmitsTarget`.
  *Budget deferred (rationale):* a token sub-budget is **agent-bounded (D8), not the Project wall
  (D12)** this dialog is built around — it needs the Agent's effective-window data the dialog
  lacks and is inert for the demo's inheriting agents; a separate control if wanted.

- [x] **4.3 D8 spend-time enforcement.** The usage meter **rejects** a turn that would exceed a
  window ceiling (a per-turn gate in `server/generate.ts`, against the resolved Agent's budget
  → provider plan), not just accumulating. Closes D8's "spend-time" trade-off gap. **Tests.**

- [x] **4.4 D8 parent-shrink propagation.** Narrowing a provider/agent (authority or budget)
  cascades a re-clamp to already-minted children (commissions/agents), so "unrepresentable
  over-grant" holds at runtime, not only at mint. **Tests.**

- [ ] **4.5 D16 per-turn provenance (contract + store).** Stamp each persisted turn with its
  driving Agent (the binding is *current-driver*, not immutable). Additive to the message/turn
  shape; metering attributes per turn. **Tests.**

- [ ] **4.6 D16 hand-off (op + confirm card).** A consent-gated hand-off that re-binds
  `Session.agentId` mid-thread (a `RelationOp` through the same card), each turn stamped (4.5).
  **Tests** (+ card text).

- [ ] **4.7 D15 agent-to-agent proxy (contract).** `ProxyRequest`/`ProxyResult`: cross-user
  access to a *private* resource is a request **to the owner's Agent**, never a credential. The
  wire shape of D15. **Tests** (pure-contract).

- [ ] **4.8 D15 proxy route + mock fulfilment.** `POST` route routing a cross-user resource
  request to the owner's Agent, which acts under **its own** authority + consent and returns
  only the result — the requester holds no credential (the structural D12 wall). Mock
  fulfilment; the seam is real. **Tests.**
