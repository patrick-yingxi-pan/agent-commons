# P7 · Automation — Scheduled & Dispatch

> **Pillar.** The automation layer: recurring routines and one-off dispatch as real,
> durable, bounded background jobs. Builds on [P4](P4-relations-scheduler.md) (scheduler
> mechanics), [P5](P5-model-tools.md) (run execution + budget), [F4](F4-broker-runners.md)
> (effects). Serves spec ADAPT-8 (Dispatch), ADAPT-9 (Scheduled), REL-4.

## 1. Problem & scope

The product has both shapes: **Scheduled** routines (`ScheduledTask` + durable cursor
and fire-time-keyed runs, `/schedule-templates`) and persisted **Dispatch** one-off runs
(`DispatchRun`, `addDispatch`). Both have live feeds. Routines now execute through
the real bounded model loop; user-created Dispatch rows still finish on a fixture
timer without model work. P4 supplies the desktop cadence core and standing
approval design; P7 designs the **broader automation surface**: one
execution model, concurrency + budget bounding, templates, and the runs feed. **Shared**
model; web runs a real queue/worker fleet, desktop a single in-process worker.

## 2. Design

### 2.1 One job model, two triggers

The target is Scheduled and Dispatch as the **same job executed by the same engine** (P4 §2.3 + the
P5 model+tool loop), differing only in trigger:

- **Dispatch** — a one-shot job enqueued immediately (the prototype's "lands running,
  finishes a beat later").
- **Scheduled** — a recurring job fired by the durable scheduler (P4 PD48), idempotent by
  `(schedule, fire_time)`.

Both produce durable run rows (F1 `schedule_run` / a `dispatch_run`), drive the live
runs feed (the prototype's single live source), and deliver via graph bindings (P4 PD49).

### 2.2 Durability, retries, concurrency

- The desktop cadence producer is durable and idempotent by `(routine, fire time)`.
  Its real in-process Routine executor retries transient failures with durable
  backoff. The hosted queue and real Dispatch executor remain unbuilt.
- **Routine concurrency caps** now bound active calls per process, tenant and
  tenant/Agent (defaults 4/2/1). Excess durable rows wait without spending attempts;
  saturated scopes do not block other eligible scopes. Admission rechecks live
  authority and budget, retries release slots during backoff, and abort-ignoring
  calls retain capacity until settlement. Internal state failures close admission
  before supervisor reporting. These are concurrency limits, not spend reservations
  or a guarantee against concurrent/unreported provider charges (P5 PD53).
- The interrupted-run sweep (already present) reconciles jobs in flight at a crash.

### 2.3 Templates

Schedule templates (`/schedule-templates`, the prototype's catalog) become a **curated +
user-defined library** that seeds new routines (prompt/cadence/delivery/steps). A
template is just a seed run through the real create path.

### 2.4 Delivery & notification

A run delivers via its bindings (save the bound artifact, open/append the bound session,
use bound extra tools — P4 §2.3) and notifies on completion/failure (in-app + optional
email/connector). The routine owns one live artifact refreshed in place (bounded growth).

## 3. Failure modes & edge cases

- **Job storm** (many fire at once) — concurrency caps + the queue smooth it; no
  thundering herd on runners/model.
- **Runner/connector unavailable mid-job** — retry/backoff; surfaced on the run.
- **Runaway recurring job** — budget caps (P5 PD53) + a **circuit breaker**: repeated
  failures or budget breach disables the routine and alerts (no silent infinite spend).
- **Duplicate dispatch / double fire** — idempotency keys (F3 PD15, P4 PD48).
- **Crash mid-run** — durable rows + the interrupted-run sweep mark it failed for retry.

## 4. Security & multi-tenancy

Every job runs under its bound **agent authority** (P4 PD49 — least privilege, not an
ambient super-user), tenant-scoped (F2), budget-enforced (P5 PD53), consent-respecting
(standing approvals for unprompted effects, P4 PD50), and audited (F5 PD27).

## 5. Observability & ops

Queue depth + age; job success/latency by type; retry + circuit-break counts; fire
punctuality (P4); per-tenant automation spend. Alert on queue backlog, failure spikes,
and circuit-breaker trips.

## 6. Open questions & decisions

See [`DECISIONS.md`](DECISIONS.md): **PD60** (one job model, two triggers — Scheduled
recurring + Dispatch one-shot — on one queue/executor, durable + idempotent + retried,
concurrency-capped per tenant/agent), **PD61** (templates = curated + user-defined library
seeding routines through the real create path), **PD62** (automation circuit breaker +
budget caps halt a runaway/failing job to protect cost and shared resources).
