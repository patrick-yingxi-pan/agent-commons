# P4 · Relationship graph & the standing-approval scheduler

> **Pillar.** The relationship graph as a multi-user transactional store, and the
> standing-approval daemon as real job infrastructure. Builds on [F1](F1-domain-model.md)
> (typed edges), [F3](F3-contract-sync.md) (sync/concurrency), [F5](F5-security-consent.md)
> (consent/authority), [P3](P3-escalation-tools.md) (run execution). Serves spec REL-1..7,
> ADAPT-9.

## 1. Problem & scope

The prototype's graph is a pure reducer over an in-memory snapshot (`contract/graph.ts`
`applyGraphOp`, `server/store.ts` `applyRelationOp`), and the schedule daemon is a
`setInterval` that fires runs and applies standing effects (`startRunDaemon`,
`applyStandingEffects`). Production needs **transactional, concurrent-safe** graph edits
and a **durable, exactly-effected** scheduler. **Shared** model; the web runs a real
job system, the desktop a single-process scheduler (same contract).

## 2. Design

### 2.1 Graph edits — transactional + concurrent

Confirmed relation ops apply as **transactions** over the typed edge tables (F1 PD2);
the pure reducer is **kept** as the client's optimistic projection + the op validator.
For concurrency:

- A relation op carries the base **version** of the rows it touches; the server applies
  it with optimistic concurrency. Disjoint edges **commute** (two users filing
  different sessions don't conflict); a same-edge conflict returns `409`, and the client
  re-reads and **re-proposes** — surfacing the consent card again with fresh state (the
  prototype's confirm flow, now conflict-aware).
- Each applied op emits `relation.applied` (`by: 'user' | 'standing'`) over SSE (F3) so
  every device converges.

### 2.2 The scheduler as real job infrastructure

`setInterval` is replaced by a **durable scheduler**:

- Each enabled schedule is a recurring job (a cron/leader on web; an in-process timer on
  desktop). Cadence is **timezone-correct** (the contract already carries `timezone`).
- A run is **idempotent by `(schedule_id, fire_time)`** — a redelivery or a second
  scheduler node can't double-fire. Runs are durable rows (`schedule_run`, F1), so the
  feed survives restarts (the prototype already sweeps interrupted live runs).
- **Retries** with backoff on failure; `notifyOnFailure` (already in the contract)
  drives alerts. A **missed-fire policy** (the process was down at fire time): catch-up
  once vs skip-to-next, configurable per schedule.

### 2.3 Run execution

A run **is a conversation turn** (the prototype synthesizes `srun-*` run sessions).
Production executes the **real model + tool loop** ([P5](P5-model-tools.md)/[P3](P3-escalation-tools.md))
under the schedule's bound **agent authority** (clamped, F5 PD24), then delivers via the
schedule's graph bindings — save the bound artifact (`scheduleArtifact`), open/append
the bound session (`scheduleSession`), using any bound extra tools
(`scheduleExtraTools`). The routine owns one live delivered artifact, refreshed in place
(the prototype's rule, so the snapshot can't grow unbounded).

### 2.4 Standing approvals

A standing approval is a **pre-authorized, revocable grant** (F5 PD23): it lets a run
apply its standing effect **unprompted** (the prototype's `applyStandingEffects`,
`relation.applied by:'standing'`). Production: the daemon acts under that grant, **each
application audited** (F5 PD27), and the grant is listed + revocable (revoking stops
future unprompted effects). This is the "approved once, then runs unprompted" model
from PROPOSAL §4.7 made durable.

## 3. Failure modes & edge cases

- **Concurrent conflicting edits** — `409` + re-read + re-propose; commuting edits both
  land.
- **Missed fire** (downtime) — the configured catch-up/skip policy; never silent
  double-fire (idempotency key).
- **Run failure** — retry/backoff; on exhaustion mark failed + `notifyOnFailure`; the
  interrupted-run sweep (already present) handles a crash mid-run.
- **Scheduler node failure** (web) — leader election / queue redelivery continues
  pending jobs; idempotency prevents duplicates.
- **Standing grant revoked mid-run** — the in-flight run completes under the grant it
  started with; subsequent fires see the revocation.

## 4. Security & multi-tenancy

Graph edits are authorized (F2 + the authority cascade, F5 PD24) and tenant-scoped; the
daemon runs each job under the schedule's **bound agent authority** (not an ambient
super-user), so a scheduled effect can reach only what that agent+project admits (D12);
standing grants are scoped, revocable, and audited.

## 5. Observability & ops

Schedule fire punctuality (scheduled vs actual), run success rate + latency, retry/
catch-up counts, relation-op throughput + conflict (`409`) rate, standing-effect
application volume. Alert on fire lag + run failure spikes.

## 6. Open questions & decisions

See [`DECISIONS.md`](DECISIONS.md): **PD47** (graph edits as transactions with optimistic
concurrency; conflict → `409` → re-propose; reducer kept for optimistic + validation),
**PD48** (durable scheduler replaces `setInterval`: runs idempotent by
`(schedule,fire_time)`, retried with backoff, timezone-correct, configurable missed-fire
policy), **PD49** (a run executes the real model+tool loop under the schedule's bound
agent authority, delivering via the graph bindings), **PD50** (standing approvals =
revocable pre-authorized grants the daemon acts under, every application audited).
