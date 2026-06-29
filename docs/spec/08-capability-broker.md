# 08 · Capability broker & Agent Commons

> **Intent.** A conversation's effects on real hosts and shared resources run through
> a broker, not ad-hoc. The **built** half: a live **runner registry** (one per
> host) advertising capabilities (`fs.read`/`fs.list`/`fs.write`/`terminal`/
> `process`), capability **invocation** routed + mediated + journaled, and a
> **resource guardian** that serializes irreversible effects via reservations. On top
> sits **Agent Commons** — model providers, system prompts, worker agents, and
> commissions — bound by an attenuation cascade so a delegated grant can never exceed
> its parent. The **exploration** half (the control-plane architecture, the general
> shared-resource coordination model, context compaction) is recorded in `docs/` as
> forward-looking design and is **not** built behavior — the spec marks it 🧭 so it's
> never mistaken for shipped.

## Built — runner broker (L2)

| ID | Requirement | Implementation | Verified by | Status |
|----|-------------|----------------|-------------|--------|
| BROKER-1 | A live runner registry: enroll / heartbeat / re-advertise / deregister, broadcasting `runner.*` events; identity is durable across reconnect. | `server/registry.ts`, `server/routes/index.ts`, `Runner` in `contract/agents.ts` | `tests/registry.test.ts`, `tests/routes-agents.test.ts` | ✅ |
| BROKER-2 | Capability invocation (`POST /runners/:id/invoke`) routes to the runner, enforces the host grant (D3) **and** context mediation (D5 — target within an attached context's scope), idempotent by `commandId` (D2). | `server/routes/index.ts`, `server/runner-runtime.ts`, `server/store.ts`, `CapabilityRequest` in `contract/agents.ts` | `tests/routes-invoke.test.ts`, `tests/capabilities.test.ts` | ✅ |
| BROKER-3 | Effect journal: each runner's authoritative log + the server's projection (`?since` tail); an outbox `sync` merges idempotently by `commandId`. | `server/journal.ts`, `server/routes/index.ts`, `CapabilityEffect` in `contract/agents.ts` | `tests/journal.test.ts`, `tests/routes-effects.test.ts` | ✅ |
| BROKER-4 | Resource guardian + reservations: per shared resource, a capacity-bounded ledger (`/resources/:key`, `/reservations/:id`); non-monotonic effects reserve/commit, monotonic ones (`fs.read`/`fs.list`) bypass (CALM); a concurrent writer is refused `409`. | `server/guardian.ts`, `server/routes/index.ts`, `contract/reservations.ts`, `isMonotonic` in `contract/agents.ts` | `tests/guardian.test.ts`, `tests/routes-reservations.test.ts`, `tests/isolation.test.ts` | ✅ |
| BROKER-5 | `fs.read` / `fs.list` are real host reads scoped by the runner's advertised grant (the seam a production runner implements) — backing the runner filesystem source (CTX-FS-3). | `server/runner-runtime.ts`, `server/data/runners.ts` | `tests/runner-fs.test.ts`, `tests/capabilities.test.ts` | ✅ |

## Built — Agent Commons (L2)

| ID | Requirement | Implementation | Verified by | Status |
|----|-------------|----------------|-------------|--------|
| COMMONS-1 | Providers / prompts / worker agents / commissions are CRUD-managed, with the D8 attenuation cascade (authority + token budget) enforced at the single creation funnel — an over-grant is unrepresentable at mint. | `server/store.ts`, `server/authority.ts`, `server/usage.ts`, `contract/workers.ts`, `contract/providers.ts`, `contract/authority.ts`, `contract/budget.ts`, `contract/commission.ts` | `tests/routes-worker-agents.test.ts`, `tests/routes-providers.test.ts`, `tests/routes-system-prompts.test.ts`, `tests/routes-commission-crud.test.ts`, `tests/authority.test.ts`, `tests/budget.test.ts` | ✅ |
| COMMONS-2 | D12 isolation: a commission's effective authority is the agent's grant **clamped** to the Project's admitted set; a cross-user effect beyond that reach is refused and audited. | `server/store.ts`, `contract/isolation.ts`, `contract/coordination.ts`, `server/authority.ts` | `tests/isolation.test.ts`, `tests/routes-project-effects.test.ts`, `tests/proxy.test.ts`, `tests/audit.test.ts`, `tests/audit-log.test.ts` | ✅ |
| COMMONS-3 | D11 multi-principal coordination: sub-goal reservation on a Project's guardian; first-come among equals; a conflicting claim is refused (`409`) to re-reason. | `server/store.ts`, `server/guardian.ts`, `contract/coordination.ts` | `tests/project-subgoals.test.ts`, `tests/project-guardian.test.ts` | ✅ |
| COMMONS-4 | D14 project roles gate actions; D13 per-Project commission caps + Contributor reputation bound abuse. | `contract/roles.ts`, `server/store.ts`, `server/limit.ts` | `tests/roles.test.ts`, `tests/reputation.test.ts`, `tests/commission.test.ts` | ✅ |
| COMMONS-5 | D10 opt-in prompt-fit probe scores a prompt against the chosen provider's model family. | `contract/probe.ts`, `server/store.ts`, `server/routes/index.ts` | `tests/probe.test.ts`, `tests/routes-probe.test.ts` | ✅ |

## Exploration — forward-looking, not built (L2)

| ID | Requirement | Design record | Status |
|----|-------------|---------------|--------|
| BROKER-EXP-1 | The control-plane architecture (relay-default + co-located fast path, agents as the system of record for their host, server-side content audit, ambient agent identity). Settled *within the exploration*, not implemented. | `docs/capability-broker-architecture.md` | 🧭 |
| BROKER-EXP-2 | The general shared-resource coordination model (the CALM monotonicity boundary, escrow/reservation as the taming primitive, the D5 resource-guardian principle). | `docs/shared-resource-coordination.md` | 🧭 |
| BROKER-EXP-3 | Context-compaction UI pattern for when the context window fills (the sequel to the usage gauge). | `docs/context-compaction.md` | 🧭 |
| BROKER-EXP-4 | The Agent Commons rationale + staged build plan that the COMMONS-* rows realize. | `docs/agent-commons.md`, `docs/agent-commons-impl-plan.md` | 🧭 |
