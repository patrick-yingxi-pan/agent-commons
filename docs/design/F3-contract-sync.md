# F3 · API contract & sync at scale

> **Foundation.** How the one UI stays a faithful cache of the backend across many
> clients, devices, and server instances — the production form of the contract
> (`contract/`), the read-through cache (`src/api/cache.ts`), and the SSE streams
> (`src/api/events.ts`). Serves spec PORT-1..7.

## 1. Problem & scope

The prototype's sync model is already the right shape: a **versioned same-origin
contract** (`/api/v1`, `contract/api.ts`), a **read-through query cache**
(`src/api/cache.ts`) fed by **one door** (`src/api/client.ts`), and an **ambient SSE
stream** whose events say *what changed* so the client refetches (`src/api/events.ts`,
`contract/events.ts`) — plus a per-turn **reply stream**. What production adds is
**scale and resilience**: many concurrent clients, multiple API instances, multi-device
fan-out, reconnection/resume, idempotency, pagination, and rate limiting.

**Shared vs deployment-specific.** The contract + client cache + event-routing model
are shared. Fan-out infrastructure is web-only (the desktop sidecar has one client, so
its SSE is in-process, exactly as today). The desktop is the degenerate single-node
case of the web design.

## 2. Design

### 2.1 Contract evolution (PORT-1)

The contract's type-identity is the portability guarantee, so it evolves
**additively**: new optional fields, new endpoints, new `Capabilities` flags
(`contract/api.ts`) — never a breaking change within `/v1`. Capability flags already
gate native-vs-web features; the same mechanism gates rollout of new features. A
breaking change is a new version segment with a deprecation window; the UI targets one
version and reads `Capabilities.epoch` to detect a reseed/restart (already wired in
`events.ts`).

### 2.2 Reads, caching & pagination

- The client cache (`cache.ts`) stays the single read surface. Add HTTP-level caching
  (ETags / `Cache-Control`) so a CDN/edge can serve unchanged reads; the cache key
  model already exists (`src/api/keys.ts`).
- **Unbounded lists get cursor pagination** — sessions, messages, runs, audit. The
  prototype returns whole lists; production returns a page + an opaque cursor. Message
  history loads newest-first, page back on scroll (ties to P1 virtualization).

### 2.3 Writes — idempotency & concurrency

- **Idempotency keys on every mutation.** The invoke path already uses `commandId`
  (`contract/agents.ts`) for at-least-once dedup; generalize it: a client mints a key
  per logical mutation so a retry (lost response, reconnect) returns the recorded
  result, not a duplicate. Session/message ids are already server-minted (PORT-7).
- **Optimistic concurrency** on edits (F1 PD2): a stale write → `409`, client re-reads.

### 2.4 The ambient stream at scale (the core of this doc)

The invalidation model — *events carry "what changed", the client refetches the
authoritative value* (`route()` in `events.ts`) — is what makes scaling tractable:
events can be **coalesced and even dropped** without correctness loss, because the
client re-reads the truth. Production wiring:

- **Pub/sub bus** (Redis Streams / NATS / a managed equivalent) between API instances.
  A mutation on any instance publishes to a per-`(tenant,user)` topic; every instance
  holding that user's SSE connection relays it. The desktop keeps the in-process bus it
  has today.
- **Reconnection & resume** — each event gets a monotonic id; the browser `EventSource`
  sends `Last-Event-ID` on reconnect; the server replays the small tail since then (or,
  if the gap is too large / epoch changed, tells the client to do a full refetch — the
  `hello`/epoch reset already models this).
- **Backpressure** — per-connection, coalesce duplicate invalidations (e.g. ten
  `relation.applied` in a burst → one refetch) and cap queue depth; on overflow, send a
  single "resync" marker. Safe precisely because events are advisory, not state.
- **Heartbeats** — periodic comment frames keep proxies from closing idle streams;
  missed heartbeats trigger client reconnect.
- **Multi-device** — the same user on N tabs/devices each holds an SSE connection on
  the same topic, so an edit on one converges everywhere — the production payoff of the
  server-owned-state decision (PERSIST-1).

### 2.5 Rate limiting & quotas

Per-tenant and per-user token-bucket limits at the edge; the `limit_exceeded` error
code + envelope already exist (`contract/api.ts`). Model spend (MODEL-7) and runner
invocations get their own buckets. `Retry-After` on 429.

### 2.6 The reply stream

The per-turn SSE body (`POST /sessions/:id/messages`) is unchanged in shape; at scale
it's pinned to the instance running the generation (sticky for that request) while the
ambient stream is bus-backed. Cancellation on client disconnect already works
(`req.on('close')`).

## 3. Failure modes & edge cases

- **Reconnect storms** (a deploy drops all streams) — jittered backoff (the client
  already backs off on `CLOSED`); resume via `Last-Event-ID` avoids full refetches.
- **Missed events** — bounded by epoch + periodic reconcile; worst case a stale view
  until the next read, never a wrong write.
- **Thundering herd on a hot invalidation** — coalescing + cache/ETags absorb it.
- **Duplicate submits** — idempotency keys.
- **Instance affinity loss mid reply-stream** — the turn fails cleanly; the user retries
  (idempotent by message key).

## 4. Security & multi-tenancy

Every endpoint and the SSE stream are authenticated (F2); topics are per-`(tenant,
user)` so fan-out can't cross tenants; rate limits are a first abuse line; the error
envelope never leaks cross-tenant existence (not-found, not forbidden, for unknown ids).

## 5. Observability & ops

- SSE: open connections, reconnect rate, `Last-Event-ID` resume hit rate, coalesce
  ratio, dropped-frame count, fan-out lag (publish→deliver).
- API: p50/p99 latency per route, 409/429 rates, cache hit ratio.
- Bus health; per-tenant quota saturation; deploy-time connection-drain behavior.

## 6. Open questions & decisions

See [`DECISIONS.md`](DECISIONS.md): **PD13** (pub/sub bus for SSE fan-out + `Last-Event-ID`
resume; in-process on desktop), **PD14** (cursor pagination for unbounded lists),
**PD15** (generalize `commandId` idempotency to all mutations), **PD16** (keep the
advisory-invalidation event model — coalesce/drop-safe — rather than streaming state
diffs), **PD17** (additive-only `/v1` evolution gated by `Capabilities` flags; versioned
break with a deprecation window).
