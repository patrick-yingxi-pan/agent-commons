# Agent Commons — implementation plan (effect-time enforcement + roles)

> **Status: Phases 1–4 COMPLETE ✅ · Phases 5–7 IN PROGRESS** (Phases 1–4: typecheck + 401
> tests + build green, each step `/code-review`'d). Phases 1–4 built every planned *mechanism*
> from `agent-commons.md` (D6–D16, OQ3/OQ4). **Phases 5–7** move the remaining open-question
> *design residue* into implementation (greenlit "all three"): **D13 economics** (reputation +
> the per-commissioner abuse cap), the **D15/OQ7 detective audit**, and the opt-in **D10/OQ5
> prompt-fit probe**.
>
> Derived from the settled design ([`agent-commons.md`](agent-commons.md), D6–D16, Open
> Questions). This is the **plan-of-record** *and* the loop's checklist: each iteration does the
> **next unchecked step only** — implement it with tests, run `/code-review` and fix
> every finding immediately, run `npm run typecheck` + `node --test` (and verify a UI
> step live), commit + push to `main`, then tick the box.

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

- [x] **4.5 D16 per-turn provenance (contract + store).** `Message.agentId` stamps each
  persisted assistant turn with its driving Agent (the binding is *current-driver*, not
  immutable) — on both the persisted message and the `message.end` SSE. Additive/optional →
  back-compat, no version bump. *(Per-owner metering attribution rides D13 forward — the
  prototype's meter is account-global; the stamp is the handle for it.)* **Tested** (a persisted
  turn carries `agentId`).

- [x] **4.6 D16 hand-off (op + confirm card).** A consent-gated hand-off that re-binds
  `Session.agentId` mid-thread (a `RelationOp` through the same card), each turn stamped (4.5).
  **Tests** (+ card text).

- [x] **4.7 + 4.8 D15 agent-to-agent proxy (contract + route).** *Delivered together — the
  `contract-boundaries` test couples a `*Request` DTO to its route consumer, so the wire shape
  and its route can't ship apart.* `contract/proxy.ts` defines `ProxyRequest`/`ProxyResult`
  (structurally **no credential channel**) + `accessChannel` (the D15↔D11 partition: shared →
  Guardian, private → agent-proxy). `POST /agents/:id/proxy` → `store.runAgentProxy`, where **B
  acts under its *own* authority** (the requester's is never used) and returns only the result —
  A holds no B credential (the structural D12 wall). *Consent is modeled as "B's authority admits
  the target"; explicit owner-side human approval is forward (single-user prototype).* **Tests:**
  pure-contract (`accessChannel`, the no-credential shape) + route (B denies what its own
  authority excludes, regardless of A; 404/400).

---

## Phase 5 — D13 economics made real (OQ1's settled sub-parts)

The incentive is intrinsic (resolved); its *mechanism* — reputation and the abuse cap — was
unbuilt. Artifact Project-ownership is **already structural** (`ArtifactItem.projectId`,
[`contract/cowork.ts:155`](../contract/cowork.ts)) — committing an Agent already donates a
Project-owned artifact — so Phase 5 builds the two genuine gaps: the donation's *reputation*
credit and the owner-pays *abuse cap*.

- [x] **5.1 Contract — reputation, linked.** Add `contributions?: number` to `Agent`
  ([`contract/workers.ts`](../contract/workers.ts)) — a worker's monotonic track record — plus a
  pure `ownerReputation(agents)` aggregate (the GitHub "accrues to both Agent and owner, linked"
  shape; single-account ⇒ sum over the account's Agents). Erasable, additive. **Tests:** the
  aggregate sums; a fresh Agent reads 0.

- [x] **5.2 Store — credit a successful commissioned effect.** `store.recordContribution(commissionId)`
  (resolves commission→Agent, fail-quiet) fired at the two **commissioned-Project** success seams:
  `runProjectEffect`'s `fulfil` closure (the guarded path throws before it, so success-only) and the
  host invoke route after commit (`request.commissionId`). Monotonic, never decrements. *The D15
  proxy is deliberately excluded — it is private cross-user access, not a Project contribution; it
  belongs to the Phase-6 audit, and crediting it would conflate the two channels.* **Tests:**
  `reputation.test.ts` — a Project effect bumps the Contributor; a commissioned invoke bumps; a
  legacy (no-commission) invoke credits nobody; an unknown commission is a fail-quiet no-op.

- [x] **5.3 Contract + store + route — per-commissioner abuse cap.** D13 names this as a cost it
  accepts ("a malicious Project could commission many outsiders' Agents to burn their plans"). Add
  `Project.commissionCap?: number` (max active commissions the Guardian admits); enforce
  **fail-closed at `store.createCommission`** — over-cap ⇒ refuse (`limit_exceeded` 429). Keyed at
  the Project (its Guardian) since the prototype has no separate per-user identity; documented.
  **Tests:** at-cap creation 429; under-cap 200; absent cap ⇒ unlimited (back-compat).

- [x] **5.4 UI — reputation chip + cap.** Show `contributions` on `ContributorRow`
  ([`src/components/SectionView.tsx:~971`](../src/components/SectionView.tsx)) and the Agent card;
  show a Project's `commissionCap` (used/limit) in the commissions view. **Verify live.**

- [ ] **5.5 Conversational — manage the cap through the shared card.** A `set-commission-cap`
  `RelationOp` + a `set_commission_cap` model tool + intent, surfaced through the **same**
  `RelationActionCard` the other relation edits use (the "one gate, managed by hand *and*
  conversationally" rule). **Tests:** `model-tools` + `model-intents` + reducer/relations.

## Phase 6 — D15/OQ7 detective audit (the taint *backstop*)

Settled **detective-audit-only — no provenance taint engine**: a server-side watch over the
cross-user channels, best-effort backstop to the attenuation wall, not a guarantee.

- [ ] **6.1 Contract — `AuditEntry`.** A pure record `{ id, channel: 'proxy'|'project-effect'|
  'host-invoke', actorAgentId?, commissionId?, capability, target, outcome, at }` + a pure
  builder/`summarizeAudit`. Not a `*Request` ⇒ no contract-boundaries coupling. **Tests:** the
  builder shape; the channel union.

- [ ] **6.2 Store — append-only log at the three channels.** An `auditLog: AuditEntry[]` slice +
  `store.recordAudit(entry)` appended on every `runAgentProxy`, `runProjectEffect`, and
  commissioned host invoke. Persist **additively** — optional `auditLog?` on `PersistedState`,
  **no `STORE_VERSION` bump** (old snapshots load `?? []`; a bump would discard live data).
  **Tests:** each channel appends exactly one entry with the right `channel`/`outcome`.

- [ ] **6.3 Route + api hook — read the trail.** `GET /audit` (mirror `GET /agents`) + a
  `useAuditLog` read hook through `src/api` (one door) + cache invalidation on a new
  `audit.entry` SSE event. **Tests:** `GET /audit` returns the appended entries; a denied proxy
  still logs an entry (detective = records attempts, not just successes).

- [ ] **6.4 UI — an Audit surface in the Agents hub.** A read-only **Audit** tab beside
  Agents/Providers/Prompts/Commissions ([`SectionView.tsx:~2318`](../src/components/SectionView.tsx)),
  each row = channel · actor · capability · target · outcome. **Verify live.**

## Phase 7 — D10/OQ5 prompt-fit probe (opt-in upgrade)

The static target-family tag stays the **default** (`promptFitWarning`, unchanged); the probe is
the *optional later upgrade* D10 named — strictly more accurate than the tag, opt-in because it
costs a model call. Built as a real seam with **mock fulfilment** (the project rule).

- [ ] **7.1 + 7.2 Contract + route — `ProbeRequest`/`ProbeResult` + the probe seam.** *Delivered
  together (the `contract-boundaries` `*Request`↔route coupling).* `contract/probe.ts`:
  `ProbeRequest { systemPromptId, providerId? }`, `ProbeResult { score, verdict, aspects, detail }`,
  and a pure `probeScore(targetFamily, modelFamily)` (deterministic mock — family match ⇒ high; a
  mismatch scores the tool-use / consent-gate degradation the tag only flags binary). `POST
  /system-prompts/:id/probe` → `store.runProbe`, real-seam-shaped (a model tool-use conformance
  check in prod; canned score in the mock). **Tests:** pure scorer (match vs mismatch) + route
  (200 with a score, 404 unknown prompt, 400 bad body).

- [ ] **7.3 UI — opt-in "Run fit probe".** A button beside the **static** warning in `AgentDialog`
  ([`SectionView.tsx:~2694`](../src/components/SectionView.tsx)) and `PromptsTab` (~2886) that
  runs the probe and shows the score/aspects — the tag stays the always-on default; the probe is
  the on-demand deepening. **Verify live.**

> **Not built — honest non-build.** OQ6 (multi-principal consent under *adversarial* load) is
> settled in design and "*watched in practice*", not a mechanism: the actor-self-confirm + role-
> grant-as-up-front-consent is already built (D14). The only buildable slice — making that consent
> legible — is folded into 5.5's card text, not a phase.
