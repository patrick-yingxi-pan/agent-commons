# F4 · Capability broker & runner protocol

> **Foundation.** How the web server safely brokers effects on hosts it doesn't run —
> the production form of the runner registry (`server/registry.ts`), the effect journal
> (`server/journal.ts`), the guardian (`server/guardian.ts`), and the runner runtime
> (`server/runner-runtime.ts`). Serves spec BROKER-1..5 and promotes the exploration
> in [`docs/capability-broker-architecture.md`](../capability-broker-architecture.md)
> + [`docs/shared-resource-coordination.md`](../shared-resource-coordination.md).

## 1. Problem & scope

The prototype's broker is real-shaped but in-process and mock-fulfilled: a registry,
a journal (D2), a guardian (D5), and `runCapability` enforcing the host grant (D3) —
all in one Node process. Production distributes this: **runners are separate processes
on separate hosts**, reached over a network, with real identity, transport, durability,
and high availability.

**Shared vs deployment-specific.** The *protocol* (enroll → advertise → invoke →
journal → reserve) is shared. **Desktop** = one **co-located** runner in the sidecar
process (the broker doc's "fast path"; `LOCAL_RUNNER_SEED`). **Web** = many remote
runners dialing in, brokered with **relay** as the default.

## 2. Design

### 2.1 Runner identity, enrollment & transport

- **Enrollment** — a runner is bound to a user/org and registered with a scoped,
  revocable enrollment token (F2 PD12), not user credentials. First enrollment mints a
  **durable id** (broker-doc D4; already in `contract/agents.ts` — identity persists
  across reconnect so "my laptop" stays stable). Runner ids are validated to a safe
  slug (already enforced at `POST /runners`).
- **Transport** — the runner **dials out** to the broker over an authenticated,
  persistent stream (WebSocket or gRPC bidi), so it works behind NAT/firewalls and the
  broker never needs an inbound route to the host. Auth is the enrollment token (mTLS
  optional for high-assurance fleets). Heartbeats keep liveness (the registry already
  models `lastSeen` / online-offline).
- **Co-located fast path (desktop)** — the sidecar's runner is in-process; "transport"
  is a function call. Same protocol, zero network — the relay/fast-path duality from
  the broker doc's D1.

### 2.2 The invoke path (reference monitor)

The route is already the right shape (`POST /runners/:id/invoke`,
`server/routes/index.ts`). Production keeps the broker as the **policy decision point**
and the runner as the **policy enforcement point** (D3), layering the checks the
prototype already performs:

1. Resolve runner + liveness (tenant-scoped, F2).
2. **Context mediation (D5)** — the effect must name a context attached to the session
   and fall within its scope.
3. **Commission reach (D12)** + **role (D14)** — for agent-driven effects on a shared
   Project.
4. **Reservation (D11)** — a non-monotonic effect acquires an escrow on the resource;
   monotonic ones (`fs.read`/`fs.list`) bypass (CALM).
5. Route to the runner; the runner enforces its **host grant (D3)** and executes.
6. **Journal (D2)** the effect; project it; emit `runner.effect`.

Idempotent by `commandId` (F3 PD15): a retried invoke replays the recorded effect.

### 2.3 Journal as a durable event log

Each runner's authoritative effect log (`server/journal.ts`) becomes a **durable,
append-only event log in shared storage** (so any API instance can read/project it and
survive failover). The server projection is a rebuildable cache. The **outbox/sync**
path (already present: `POST /runners/:id/sync`) lets a runner replay effects it ran
out-of-band (the co-located fast path, or while the broker was unreachable), merged
idempotently — the at-least-once delivery guarantee.

### 2.4 Guardian / reservations at scale

The per-resource reservation ledger (`server/guardian.ts`, D5) moves to **shared
storage** (the same DB / a coordination service), not per-instance memory, so escrow
is correct across a horizontally-scaled API tier and survives instance failover. TTLs
+ a sweeper reclaim abandoned holds. This is the production form of the
shared-resource-coordination escrow — a second session's irreversible write on a held
resource is refused (`409`) regardless of which instance it lands on.

### 2.5 Content audit

Per the broker doc's D3 (server-side content audit), effect inputs/outputs crossing the
broker can be audited/scanned server-side (DLP, policy) before projection — the broker
is the natural chokepoint. Recorded in the audit trail (F5).

## 3. Failure modes & edge cases

- **Runner offline mid-invoke** — bounded timeout → `capability_unavailable`; the
  client retries with the same `commandId` (idempotent) when the runner returns.
- **Network partition / broker failover** — journal + reservations in shared storage,
  so a different instance continues; the runner re-dials and resumes; in-flight effects
  reconcile via the outbox.
- **Stale reservation** — TTL + sweeper; a crashed holder's escrow lapses so the
  resource frees.
- **Duplicate effects** — `commandId` dedup at append.
- **A compromised/buggy runner** — the host grant (D3) bounds blast radius to its
  advertised scopes; the broker's mediation bounds it to attached contexts; content
  audit can quarantine.

## 4. Security & multi-tenancy

The registry, journal, and guardian are **tenant-scoped** (F2 PD9) — one tenant can't
address, observe, or reserve another's hosts. Enrollment tokens are least-privilege +
revocable. The broker is the reference monitor; the runner is the enforcement point;
neither the requester nor the model ever holds a host credential (the structural wall
the prototype already encodes for agent-to-agent proxy, D15).

## 5. Observability & ops

- Runner liveness/online count per tenant; invoke latency + error rate by capability;
  journal append/projection lag; reservation contention + TTL-sweep rate; outbox replay
  volume; fast-path-vs-relay ratio (desktop vs web).
- Runner version/compat tracking; staged rollout of runner builds.

## 6. Open questions & decisions

See [`DECISIONS.md`](DECISIONS.md): **PD18** (runner dials out over an authenticated
persistent stream; broker routes), **PD19** (relay default + co-located fast path per
deployment), **PD20** (journal = durable append-only event log in shared storage,
idempotent by `commandId`, projection rebuildable), **PD21** (reservations/guardian in
shared storage for HA/failover, TTL-swept), **PD22** (broker = reference monitor / PDP,
runner = PEP; layered mediation→commission→role→reservation→host-grant).
