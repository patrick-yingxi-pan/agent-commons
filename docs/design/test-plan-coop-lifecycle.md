# Test plan — cross-tenant multi-agent cooperation lifecycle

> **What this is.** An exhaustive test plan for the workflow the reviewer asked
> about: *multiple users' agents cooperating on one shared project*, end to end —
> **owner creates + shares → other users commission their agents → the agents
> cooperate → the project completes.** It is grounded in a full re-map of the
> current implementation (store, routes, tests, UI, cooperation mechanics,
> completion concept — 2026-07-02), not from memory. Every "gap" and "bug" below
> is cited to `file:line` and confirmed by reading.
>
> This plan drives the next build phases. It is deliberately honest about the
> load-bearing finding (below): the pieces the lifecycle needs exist, but two of
> them live in **different worlds** and don't meet yet.

## 0. The load-bearing finding — membership and cooperation don't meet yet

P8 slice 1 (build-log row 39 / COMMONS-6 🟡) built the **membership** layer of the
lifecycle on **created** projects (`graph.extraProjects`): share-project,
cross-tenant commission, owner-pays *attribution*, redaction. Good.

But the **cooperation runtime** — the D11 guardian, the D12 authority clamp, the
D14 role gate, the effect/sub-goal routes — is wired to **seed** projects only:

| Mechanism | Keyed off | Created shared project has… | Consequence |
|---|---|---|---|
| Guardian coordination (D11) | `project.guardianId` (`guardProjectEffect` store.ts:1697, `guardSubGoalEffect`) | **no `guardianId`** (contract/graph.ts:86–95) | sub-goal reservation reserves nothing / effects run coordination-free — no cross-tenant contention possible |
| Authority clamp (D12) | `projectAdmittedAuthority(project.contexts)` (store.ts:1378) | **empty `contexts`** | admitted set is empty → a cross-tenant contributor is clamped to **deny-all** |
| Route reachability | `store.listProjects()` = seed `PROJECTS` only (store.ts:1685) | not in `PROJECTS` (lives in `extraProjects`) | `POST /commissions` (routes:705), `POST /projects/:id/effects` (routes:785), `GET /projects` (routes:1261) **404 the very project the flow created** |

So today you can create + share + commission onto a shared project, but the agents
**cannot actually cooperate on it** — the coordination/authority/effect tier can't
see it. The `commission-agent` *op* path uses `findProject` (PROJECTS +
extraProjects, store.ts:2088/2095), which is why membership works; the cooperation
tier uses `listProjects()`/`guardianId`, which is why cooperation doesn't.

**This is the single most important thing the plan must reckon with:** stages A/B
(membership) are lockable now; stage C (cooperation) needs a *bridge* build before
it can be tested cross-tenant; stage D (completion) is unbuilt **and** undesigned.

> **UPDATE (Phase 2a, 2026-07-02) — bridged.** Sharing a Project now assigns a
> `guardianId`, all six cooperation methods + the effect route resolve via
> `findProject`, and the D12 clamp reads the admitted set from the authoritative
> `graph.projectContexts`. Membership and the cooperation runtime now **meet** for
> the D11 guardian / D12 clamp / D14 roles tier — locked cross-tenant by
> `tests/cross-tenant-runtime.test.ts` (C1–C5, C12). What remains for Stage C is the
> **authorization + accounting** layer (Phase 2b: caller-identity on the effect
> routes, owner-pays metering, audit tenant).

## 1. Lifecycle stages (the workflow, decomposed)

```
A. OWNER CREATES + SHARES        create-project → share-project(shared:true)
     owner marks a project open to other tenants
        │
B. OTHERS JOIN (commission)      each tenant commissions ITS OWN agent (owner-pays)
     D8 attenuation funnel · D13 cap · role assigned · redacted contributor list
        │
C. AGENTS COOPERATE              on the shared project:
     · D12 authority clamp (each contributor bounded to the project's admitted set)
     · D11 guardian + sub-goal reservations (contention → 409, re-reason)
     · D14 roles gate writes; reader can read, not fire
     · D13 reputation credit per successful effect (agent-scoped)
     · owner-pays metering (D13): a commissioned run charges the AGENT OWNER's tenant
     · D15 audit: every cross-user effect recorded under the right tenant
        │
D. PROJECT COMPLETES / WINDS DOWN
     owner marks done? all sub-goals committed? · standing commissions retired ·
     held reservations released · guardian torn down · un-share
```

## 2. Test taxonomy (the three layers + conventions)

- **L1 — store/contract unit** (`node --test`, in-memory `store`). Reducers,
  guards (`opDeniedForTenant`), projections (`projectGraphForTenant`,
  `publicSharedProject`, `publicCommission`), guardian, authority clamp, roles,
  reputation, metering. The bulk of the exhaustive matrix lives here.
- **L2 — route/HTTP** (`node --test` via the HTTP helper), run on **both**
  backends: default single-tenant *and* `BACKEND=remote` multi-tenant with
  `x-user-id`/`x-tenant-id` headers (as `tests/capability-remote.test.ts` does).
  This is where cross-tenant isolation + reachability + status codes are locked.
- **L3 — end-to-end UI**. *No automated browser/DOM harness exists today* (no
  Playwright / vitest / jsdom / testing-library anywhere; all ~105 tests are
  `node --test`; "UI" tests assert against raw source text via
  `tests/helpers/source.ts`). See §5 — this layer needs a decision + prerequisite
  UI before it can exist.
- **Convention — bite-proofing.** Every new locking test must be shown to *fail*
  when its guard/fix is neutered, then restored (the repo's standing rule).

## 3. Exhaustive case matrix

Legend for **Now?**: ✅ lockable today · 🔧 needs a small fix first (see §4) ·
🏗 needs a feature build first · 🎨 design-first.

### Stage A — owner creates + shares

| ID | Case | Layer | Now? | Notes / current coverage |
|----|------|-------|------|--------------------------|
| A1 | create-project stamps creator's tenant; lives in extraProjects | L1 | ✅ | covered (project-tenancy) |
| A2 | share-project(true) sets `shared`; owner-only | L1+L2 | ✅ | covered (cross-tenant-cooperation:55, capability-remote:429) |
| A3 | non-owner share/un-share → denied (404) | L1+L2 | ✅ | covered |
| A4 | shared project visible cross-tenant, **redacted** (`publicSharedProject`: sessionIds/contexts/scheduled/instructions stripped) | L1 | ✅ | covered (:64) |
| A5 | private project **not** visible cross-tenant | L1 | ✅ | covered (:106) |
| A6 | **un-share after contributors joined** — `shared:false` while foreign commissions + in-flight reservations exist: what happens to them? | L1+L2 | 🎨 | **gap + undefined behavior.** Un-share is only tested as a permission denial, never as a successful toggle with live cross-tenant state. Decide + lock: do foreign commissions get frozen / released / orphaned? |
| A7 | share-project on a **seed** id no-ops (documented LOW) | L1 | ✅ | make the documented no-op an explicit assertion |

### Stage B — others commission their own agent (join)

| ID | Case | Layer | Now? | Notes |
|----|------|-------|------|-------|
| B1 | tenant B commissions **its own** agent onto A's shared project → allowed (owner-pays) | L1+L2 | ✅ | covered (cross-tenant-cooperation:20, capability-remote:441) |
| B2 | private foreign project refuses cross-tenant commission | L1+L2 | ✅ | covered (:41, :456) |
| B3 | no conscription — commissioning a **foreign** agent onto your own shared project → denied | L1 | ✅ | covered (:47) |
| B4 | contributor list public cross-tenant; foreign contributor **redacted** (`publicCommission` — no authority/grant/reservationId) | L1+L2 | ✅ | covered (:80, capability-remote:450) |
| B5 | `commissionOwnerTenant` attributes to the **agent owner**, not project owner | L1 | ✅ | covered as a *value* (:37) — see C7 for the effect |
| B6 | **`POST /commissions` (direct REST) onto a shared *created* project** | L2 | 🔧 | **BUG-1:** 404s (guard uses seed-only `listProjects()`, routes:705) though the op path succeeds. Write the test asserting 200; it will fail → fix. |
| B7 | **D13 cap on a shared project counts across tenants** — one tenant's commissions can exhaust the owner's `commissionCap` against other tenants | L1 | 🔧/🎨 | `activeCommissionCount` counts all tenants (store.ts:1302). Decide: is that correct abuse-control or a cross-tenant DoS? Lock the chosen behavior. Created projects also have **no `commissionCap`** — cap is currently unenforceable on them. |
| B8 | role a self-commissioning cross-tenant contributor may grant **itself** — can B self-assign `owner`/`maintainer` on A's project? | L1+L2 | 🔧 | **gap:** role is the committer's claim; no check bounds it. Decide + lock the max self-grantable role for a non-project-owner. |

### Stage C — agents cooperate (the heart of the reviewer's question)

> **STATUS (Phase 2a+2b, 2026-07-02) — BUILT end to end.** The bridge (2a) + the
> authorization/accounting layer (2b) landed. Locked cross-tenant by
> `tests/cross-tenant-runtime.test.ts` + `tests/capability-remote.test.ts`:
> **C1/C2/C3** guardian contention (D11), **C4** clamp (D12), **C5** roles (D14),
> **C6** reputation (agent-scoped, credits the contributor), **C8** caller-identity
> (act only as your own commission), **C10** the shared-gate (un-share revokes;
> omitted commissionId can't reach a cross-tenant shared effect), **C11** audit under
> the agent owner's tenant (D13 owner-pays *attribution*), **C12** CALM monotonic
> bypass. **C7 owner-pays *compute* metering is DEFERRED** (needs a commissioned-
> *generation* path — metering mock effects would be mock-gilding; the attribution
> primitive is wired into audit + reputation instead). **C9 raw
> `/reservations/:id/release|commit` authorization** is a remaining item (the
> cooperation path is guarded via `/subgoals`; the low-level escrow route is a
> follow-up). Original pre-build matrix kept below for provenance.

| ID | Case | Layer | Now? | Notes |
|----|------|-------|------|-------|
| C1 | two **different-tenant** commissions reserve **different** sub-goals on one shared project → both proceed (D11 concurrency) | L1+L2 | 🏗 | headline cooperation case; needs guardian on created projects |
| C2 | two different-tenant commissions reserve the **same** sub-goal → second refused **409**, re-reasons | L1+L2 | 🏗 | the contention case; single-tenant analog covered (project-subgoals:36) |
| C3 | release-then-retake across the tenant boundary (B releases, C takes) | L1+L2 | 🏗 | |
| C4 | **D12 clamp cross-tenant** — B's agent granted `*` is walled to the shared project's admitted set; reaching A's un-admitted connector → **403 + audit** | L1+L2 | 🏗 | the make-or-break isolation property; needs created projects to *have* an admitted set (contexts). Single-tenant analog covered (routes-project-effects:13) |
| C5 | **D14 role gate cross-tenant** — a `reader` contributor from B is denied a write on A's shared project; a `writer` is allowed | L1+L2 | 🏗 | single-tenant analog covered (project-subgoals:90) |
| C6 | **D13 reputation cross-tenant** — a successful effect credits **B's** agent (the contributor), not A's | L1 | 🏗 | recordContribution is agent-scoped (store.ts:1768) so should hold; never asserted across tenants |
| C7 | **owner-pays metering (D13)** — a commissioned run charges `commissionOwnerTenant`'s meter, not the project owner's and not nobody's | L1+L2 | 🏗 | **BUG-4:** `commissionOwnerTenant` is **dead code** (defined store.ts:1265, called nowhere). A commissioned effect is currently **free**. Needs the commissioned-execution seam. |
| C8 | **caller-identity authorization** — a caller may act only as a commission **whose agent it owns**; forging another tenant's `commissionId` on `/projects/:id/effects` \| `/subgoals` \| `/runners/:id/invoke` → denied | L2 | 🔧/🏗 | **BUG-3:** these routes never resolve `store.identity(headers)`; commissionId/holder is client-supplied and trusted (routes:759/780/327). Latent auth hole + coverage gap. |
| C9 | **reservation release authorization** — a tenant cannot `release`/`commit` a reservation it doesn't hold (routes:841/833) | L2 | 🔧 | **BUG-3b:** `/reservations/:id/release` is unauthenticated; any caller can free another's claim by guessing the id |
| C10 | D12 bypass via **omitted** commissionId — the "legacy single-tenant path" on `/runners/:id/invoke` (routes:367) must not skip the clamp on a shared project | L2 | 🔧 | make commission attribution mandatory on shared-project effects |
| C11 | **audit lands under the right tenant** — a cross-tenant effect is recorded in the **commission owner's** Audit hub, not the backend/reader tenant | L1+L2 | 🔧 | `recordAudit` stamps the backend-resolved tenant (store.ts:1741); store comment itself flags this as a later slice |
| C12 | monotonic effects (`fs.read`/`fs.list`) bypass the guardian cross-tenant (CALM); non-monotonic serialize | L1 | 🏗 | isProjectEffectMonotonic; lock cross-tenant |

### Stage D — completion / wind-down

> **Entirely unbuilt and un-designed.** No `status`/`completedAt` on Project or
> Commission (contract/cowork.ts:24, contract/commission.ts:16); no
> complete/archive/close op or route; the docs define no terminal stage either
> (agent-commons.md OQ1–OQ8 don't cover it). Closest primitives: reservation
> commit/release (per-effect), un-commission (per-contributor, cascade-releases
> holds), Session.status archive (wrong altitude).

| ID | Case | Layer | Now? | Notes |
|----|------|-------|------|-------|
| D1 | owner marks a shared project **complete/closed**; effect on contributors, held reservations, guardian | L1+L2 | 🎨 | needs a design: what marks done? owner action vs all-sub-goals-committed? |
| D2 | un-commission a foreign contributor → **cascade-releases** its in-flight sub-goals (frees them for others) | L1 | 🔧 | `deleteCommission` already cascade-releases (store.ts:1360) — lock it **cross-tenant** (currently only single-tenant with bare strings) |
| D3 | a completed/closed project refuses new commissions + new effects | L1+L2 | 🎨 | needs the D1 status field |
| D4 | grant exhaustion / commission terminal state (a contributor "done") | L1 | 🎨 | no `active`/`endedAt` on Commission today |

## 4. Bugs & inconsistencies found (each becomes a failing test → fix)

Ordered by severity for the cooperation lifecycle.

1. **BUG-2 (structural, HIGH) — created shared projects can't be cooperated on.**
   Created projects have no `guardianId` and empty `contexts`
   (contract/graph.ts:86–95), so the D11 guardian and D12 clamp can't engage; and
   the effect/sub-goal/commission routes 404 them via seed-only `listProjects()`.
   The *whole* cooperation tier is wired to seed projects. **Fix (the bridge):**
   mint a `guardianId` (and a default `commissionCap`) for created projects, admit
   the project's attached contexts into its authority set, and switch the three
   routes to `findProject` (PROJECTS + extraProjects). Everything in Stage C
   depends on this.
2. **BUG-3 (auth, HIGH) — cooperation routes have no caller-identity guard.**
   `POST /projects/:id/effects` (780), `/subgoals` (759), `/runners/:id/invoke`
   (327), and `/resources|/reservations/*` (813–841) never resolve
   `store.identity(headers)`; `commissionId`/`holder` is client-supplied and
   trusted. A caller can fire effects **as any commission**, squat/steal a
   sub-goal, or release another's reservation. **Fix:** at these routes resolve the
   caller's tenant and require `commissionOwnerTenant(commissionId) === caller`
   (you may act only as a commission whose agent you own); derive `holder` from the
   principal; authorize release against the holder.
3. **BUG-1 (reachability, MED) — `POST /commissions` 404s shared created
   projects** (routes:705, seed-only `listProjects()`) while the op path succeeds.
   Two nominally-parallel commission paths disagree on which projects exist.
   **Fix:** use `findProject`; fold into the BUG-2 route sweep.
4. **BUG-4 (metering, MED) — owner-pays is dead code.** `commissionOwnerTenant` is
   defined (store.ts:1265) and **called nowhere**; a commissioned effect is never
   metered. **Fix:** on a commissioned effect, `recordUsage(..., commissionOwner)`
   / `overSpendLimit(grant, commissionOwner)`. Needs the commissioned-execution
   seam (C7); converges with the deferred "commission-attributed budgets" item.
5. **BUG-5 (consistency, LOW) — `GET /commissions/:id/authority` inconsistent.**
   It 404s a shared-project contributor that `GET /commissions/:id` **and** the
   list reveal, because its guard omits the `projectId` that flips `onShared`
   (routes:684, store.ts:1233). **Fix or intentionally document** (effective reach
   is more sensitive than identity — but then make that explicit + tested).
6. **BUG-6 (audit, MED) — cross-tenant effect audited under the wrong tenant.**
   `recordAudit` stamps the backend-resolved tenant, not the commission owner
   (store.ts:1741). A shared-project effect lands in the reader's Audit hub.
   **Fix:** resolve the commission's owning tenant per effect (C11).
7. **BUG-7 (policy, LOW/design) — cross-tenant role self-assignment unchecked**
   (B8) and **cross-tenant D13 cap semantics undefined** (B7). Decide policy, then
   lock.

## 5. End-to-end UI plan — and the two prerequisites + the harness fork

The cross-tenant lifecycle **cannot be driven through the running UI today**:

- **No share UI.** `Project.shared` + the `share-project` op exist in the
  contract/reducer, but **no component renders a share toggle** and **no model
  tool proposes the op** (only commission/uncommission/cap tools exist). A user
  cannot flip a project to shared by any path (hand or conversational).
- **No way to act as a second tenant.** `AccountChip` is **read-only** (no
  switcher); the mock/desktop backend always resolves the single local tenant. A
  second tenant exists only in server-side tests via header injection.
- **No completion UI** (Stage D has no model, so nothing to render).
- **No E2E/DOM harness at all.**

So E2E of this workflow requires, in order:

1. **Build the share affordance** — a share toggle on the project detail
   (form-follows-function: reuse the existing consent-card + AddTrigger idiom) **and**
   a `share_project` model tool so it's reachable conversationally through the same
   confirm card as every other relation edit (P8 slice 5, currently a follow-up).
2. **Provide a browser path to a second tenant** — a **dev-only tenant switcher**
   (or "act-as" control) that sets the `x-user-id`/`x-tenant-id` the remote backend
   already understands, so two tenants' agents can be staged from the UI. (Design
   decision: dev-only, gated to `BACKEND=remote`.)
3. **Pick an E2E harness** — see the fork below.

**E2E scenarios to script once the above exist (E2E-1…E2E-6):** owner shares a
project (E2E-1) → switch to tenant B, discover the shared project redacted (E2E-2)
→ B commissions its own agent (E2E-3) → both tenants' contributors visible in the
list, foreign one identity-only (E2E-4) → an agent fires an effect / reserves a
sub-goal, contention shows a 409 in the Coordination panel (E2E-5) → owner
completes / un-shares, contributors wind down (E2E-6).

**Harness fork — DECIDED (2026-07-02): (a) Playwright, checked-in headless
suite.** Real E2E regression coverage that runs in CI as a gate; a new **dev**
dependency (not runtime — the locked "few deps" rule governs runtime deps), added
in Phase 3 alongside the prerequisite share-toggle + dev tenant-switch UI.
Rejected: (b) preview-MCP scripted (no CI gate) and (c) jsdom+testing-library (not
true end-to-end).

## 6. Execution phases (the "fix issues found, and repeat" loop)

**Sequencing — DECIDED (2026-07-02): phase order 1 → 2 → 3 → 4** (low-risk-first;
completion included as Phase 4, design-first).

Each phase: implement → `npm run typecheck` + `node --test` → adversarial
`/code-review` (Workflow) → fix → commit/push. Bite-proof every new test.

- **Phase 1 — membership hardening (everything testable *without* the bridge).**
  Fix **BUG-1** (POST /commissions reachability + cross-tenant authorization) and
  **B8** (clamp a cross-tenant self-joiner's role to ≤`writer` in `createCommission`
  — only the owner grants elevated roles). Resolve **BUG-5** as *intended* (the
  `/authority` cross-tenant 404 is the coherent "who-contributes, not
  what-they-reach" posture — matching `publicCommission`; document + lock it). Lock
  A6 (un-share with a foreign contributor attached — current behavior + open Q),
  A7 (seed no-op), B7 (created project has no cap → uncapped; note). High value,
  low risk, directly "fix issues found."
  *Grounding refinement:* BUG-3 (caller-identity auth), BUG-4 (owner-pays metering),
  and BUG-6 (audit tenant) are only *meaningfully* testable once cross-tenant
  cooperation on a shared project is reachable, so they move to **Phase 2** with the
  bridge (all seed-project commissions are the single default tenant, so there's no
  foreign commission to fire cross-tenant until created projects become cooperable).
- **Phase 2 — the bridge + the cooperation auth/metering (BUG-2/3/4/6).**
  guardianId + admitted contexts + default cap for created projects + `findProject`
  on the effect/sub-goal routes (BUG-2); caller-identity authorization on
  effect/sub-goal/invoke/reservation routes — you may act only as a commission whose
  agent you own (BUG-3, C8/C9/C10); owner-pays metering via `commissionOwnerTenant`
  (BUG-4, C7); per-effect audit under the commission owner's tenant (BUG-6, C11).
  Then lock the full Stage C cross-tenant matrix (C1–C12). This is the heart of the
  reviewer's question — *agents actually working together across tenants.*
  *Known limitation to design here:* cross-tenant role **elevation** — the commission
  is owned by the contributing tenant (only it can PATCH, via `denyForeignEntry`), yet
  it may not self-elevate (B8), so no path currently promotes a cross-tenant
  contributor to maintainer/owner. An owner-driven cross-tenant grant path is a
  Phase 2 design item.
- **Phase 3 — E2E UI.** Build the share affordance + dev tenant switch, then the
  chosen harness + E2E-1…E2E-6.
- **Phase 4 — completion (Stage D).** Design first (a short design note answering
  D1's open questions), then build the status model + op + UI, then lock D1–D4.

## 7. What's already well-covered (don't re-litigate)

Isolation floor is strong and stays green: private-project refusal, no
conscription, owner-only share, redaction of session ids / authority / grant,
owner-pays *attribution*, registry + relation tenancy on both backends, the D8
attenuation funnel + D13 cap (single-tenant), the guardian/roles/clamp mechanics
(single-tenant). Phase 1 extends these across the tenant boundary rather than
rebuilding them.
