# P4 · Relationship graph & the standing-approval scheduler

> **Pillar.** The relationship graph as a multi-user transactional store, and the
> standing-approval daemon as real job infrastructure. Builds on [F1](F1-domain-model.md)
> (typed edges), [F3](F3-contract-sync.md) (sync/concurrency), [F5](F5-security-consent.md)
> (consent/authority), [P3](P3-escalation-tools.md) (run execution). Serves spec REL-1..7,
> ADAPT-9.

## 1. Problem & scope

The prototype's graph is a pure reducer over an in-memory snapshot (`contract/graph.ts`
`applyGraphOp`, `server/store/index.ts` `applyRelationOp`). The desktop scheduling core
is now durable and exactly-effected (`server/scheduler.ts` + persisted routine/run fields),
but production still needs transactional graph edits, real run failure/retry execution,
and a hosted leader/queue. **Shared** model; the web runs a real job system, the desktop
an in-process scheduler over the same fire-time contract.

## 2. Design

### 2.1 Graph edits — transactional + concurrent

Confirmed relation ops apply as **transactions** over the typed edge tables (F1 PD2);
the pure reducer is **kept** as the transaction validator/projector and deterministic
domain oracle. The client publishes only an acknowledged read projection (PD75).
For concurrency:

- A relation op carries the base **version** of the rows it touches; the server applies
  it with optimistic concurrency. Disjoint edges **commute** (two users filing
  different sessions don't conflict); a same-edge conflict returns `409`, and the client
  re-reads and **re-proposes** — surfacing the consent card again with fresh state (the
  prototype's confirm flow, now conflict-aware).
- One client/account FIFO preserves user intent order. Each logical edit retains one
  idempotency key through an explicit retry; failure blocks later edits, and dismissal
  reconciles because a missing acknowledgement cannot prove the server did not commit.
  A monotonic full-graph revision prevents a crossed HTTP response from rewinding a
  newer ambient read. Consent history is written only after the effect is acknowledged.
- Each applied op emits `relation.applied` (`by: 'user' | 'standing'`) over SSE (F3) so
  every device converges.

### 2.2 The scheduler as real job infrastructure

The first desktop slice of the **durable scheduler** is built:

- Each enabled schedule is a recurring job (a cron/leader on web; an in-process timer on
  desktop). Cadence is **timezone-correct** (the contract already carries `timezone`).
- A run is **idempotent by `(schedule_id, fire_time)`** — a redelivery or a second
  scheduler node can't double-fire. Runs are durable rows (`schedule_run`, F1), so the
  feed survives restarts (the prototype already sweeps interrupted live runs).
- A persisted next-fire cursor plus recursive one-shot timer replaces `setInterval`.
  Old rows adopt a future cursor; an overdue durable cursor is visibly skipped by
  default or caught up once by per-routine choice.

Still pending: **retries** with backoff on real executor failure, with
`notifyOnFailure` driving alerts, and the hosted cron/leader/queue implementation.
The mock run synthesizer has no truthful transient failure to retry, so this remains
attached to the real model/tool executor rather than a fabricated failure switch.

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
from the shared relationship catalog made durable.

## 3. Failure modes & edge cases

- **Concurrent conflicting edits** — `409` + re-read + re-propose; commuting edits both
  land.
- **Missed fire** (downtime) — the configured catch-up/skip policy; never silent
  double-fire (idempotency key).
- **Run failure** — the future real executor retries with backoff; on exhaustion mark failed + `notifyOnFailure`; the
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

The fire-time stamp already makes scheduled-vs-actual lag derivable. Hosted operations
still need exported schedule punctuality, retry/catch-up counts, run success rate +
latency, relation-op throughput + conflict (`409`) rate, and standing-effect volume.
Alert on fire lag + run failure spikes.

## 6. Open questions & decisions

See [`DECISIONS.md`](DECISIONS.md): **PD47** (graph edits as transactions with optimistic
concurrency; conflict → `409` → re-propose; reducer kept for transaction validation),
**PD75** (acknowledgement-gated client FIFO, stable retry key, monotonic snapshot revision),
**PD48** (durable scheduler replaces `setInterval`: runs idempotent by
`(schedule,fire_time)`, retried with backoff, timezone-correct, configurable missed-fire
policy), **PD49** (a run executes the real model+tool loop under the schedule's bound
agent authority, delivering via the graph bindings), **PD50** (standing approvals =
revocable pre-authorized grants the daemon acts under, every application audited).
