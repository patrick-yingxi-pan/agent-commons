# F6 · Persistence, storage & ops

> **Foundation.** The concrete storage tiers, the durable-vs-transient split, and how
> the system is deployed, observed, backed up, and scaled — the production form of
> `server/persistence/` (JSON + embedded SQLite behind one port) and the run scripts. Serves spec
> PERSIST-1..7, MOCK-5/6, and grounds [F1](F1-domain-model.md)/[F4](F4-broker-runners.md).

## 1. Problem & scope

The implementation persists one versioned state contract through JSON or embedded
SQLite (`server/persistence/`), including newly authored document bodies keyed by
artifact id, and runs as one Node process (`server/index.ts`) that serves the built
UI + API. Development also boots an in-process mock model; release profiles
deliberately disable it and require a configured provider. Production still needs
the native shell, secrets boundary, object storage for large and binary bodies, and
operational packaging, while both
deployment topologies continue sharing one UI + contract.

## 2. Design

### 2.1 Storage tiers

| Tier | Web | Desktop | Holds |
|------|-----|---------|-------|
| **Relational DB** (system of record) | Postgres (managed, replicas) | embedded SQLite | entities + relation edges + agent-commons registries + audit (F1 PD1) |
| **Object storage** | S3-compatible | local app-data dir | message bodies, artifact bodies, file/photo content, UI-host uploads (F1 PD4) |
| **Coordination / cache** | shared store (Redis/DB) | in-process | reservations/guardian (F4), SSE pub/sub (F3), query caches |
| **Secrets** | KMS/Vault | OS keychain | connector tokens, provider keys (F5) |

**Object storage** is content-addressed (digest = key), per-tenant prefix, served to
the client via **short-lived signed URLs** (so bytes don't round-trip the API, and the
served-fs `<img src>` model from CTX-FS generalizes). Lifecycle rules expire orphaned
blobs.

### 2.2 Durable vs transient (PD5, restated for storage)

- **Durable** (backed up, system of record): the relational entities + graph +
  registries + audit; object-storage blobs.
- **Transient** (rebuildable, not backed up): reservations, the live runner registry,
  usage windows, fs catalogs, the session-workspace projection, query caches. The
  prototype already excludes these from `PersistedState` — production keeps that line.

### 2.3 Migrations

Forward-only, ordered schema migrations (F1 PD6) replace `STORE_VERSION`'s discard-and-
reseed. Migrations run on deploy (web) / app-update (desktop), are tested against a
snapshot of prod-shaped data, and are reversible-by-compensation where feasible. The
`server/data/*` fixtures become dev/demo seeds run through the real write path.

### 2.4 Backup & recovery

- DB: automated backups + point-in-time recovery; replicas for read scale + failover.
- Object storage: versioning + cross-region replication (web); periodic local export
  (desktop).
- `scripts/snapshot.ts` now provides the desktop export/import core: canonical
  backend-neutral JSON, atomic export, validation + forward migration before restore,
  and read-back verification. A JSON export restores into SQLite and vice versa.
  The native shell presents timestamped managed backups, ensures one daily recovery
  point with seven-day automatic retention, and retains whether that attempt actually
  succeeded. Customize receives only generic failure or path-free validated metadata,
  states the observed result, and keeps manual backup actionable. The shell reveals the
  exact OS-owned folder without giving the renderer a path. Native restore accepts only
  a regular managed direct child, defaults its warning to Cancel, and makes a fresh
  safety copy when the app is healthy. It proves the backend stopped, performs a
  validated, read-back-proven replacement in a minimal one-shot worker, and restarts.
  Startup recovery uses the same stopped-server
  path while explicitly disclosing that it cannot make a new safety copy.

### 2.5 Deployment topology

**Delivery sequence (PD74): desktop first, web service later.** The first
production milestone is the native desktop topology. Its acceptance path is a
bundled, updateable shell + sidecar; forward-only SQLite migrations; OS-keychain
secrets; atomic app-data storage with export/restore; co-located runner/MCP
lifecycle; and crash/update recovery that preserves acknowledged work. These are
the near-term deployment priorities because they make the local files/git/tool
workflow real end to end.

The hosted multi-tenant service follows by replacing topology adapters with
Postgres, object storage, pub/sub, KMS and OIDC—not by replacing the UI, contract,
domain model, consent rules, or mutation semantics. Remote-backend tenancy and
access-parity suites therefore stay mandatory throughout desktop work. Web-only
horizontal scaling, anonymous indexing/CDN policy, and service billing/abuse
operations remain designed but do not displace the desktop milestone.

- **Desktop** — one bundled artifact: the app shell + the sidecar (Node) + embedded
  SQLite + a co-located runner; the model call goes out to the Anthropic API (or a
  configured gateway). Loopback-bound (INV-3). Updates ship the migration.
- **Web** — a **stateless, autoscaled API tier** (serves the built UI + the contract),
  behind a load balancer/CDN; Postgres (+replicas); object storage; the pub/sub bus
  (F3); the secrets manager (F5); a **model gateway** (P5) mediating the Anthropic API
  (keys, budgets, retries). Runners dial in from edge hosts (F4). The reply-stream
  request is sticky to its instance; everything else is stateless.

### 2.6 Scaling

Stateless API scales horizontally; DB read replicas + connection pooling; the bus
fans SSE; object storage + CDN absorb content; per-tenant rate limits (F3) bound noisy
neighbors. The reply stream is the only sticky path.

## 3. Failure modes & edge cases

- **Instance loss** — stateless tier reschedules; durable state is in the DB/object
  store; in-flight reply-streams fail cleanly and are retried (idempotent, F3 PD15).
- **DB failover** — replica promotion; transient stores rebuild; reservations re-read
  from shared storage (F4).
- **Object-store unavailability** — reads degrade to a placeholder (the prototype's
  gradient/scaffold fallback generalizes); writes retry/queue.
- **Migration failure** — halt deploy, roll back the API image, fix forward; never
  partially-migrate prod (transactional DDL where supported).
- **Desktop renderer loss** — keep the healthy local backend in place and offer one
  native, default-Reopen recovery to the last trusted route. Disclose that acknowledged
  work remains on device while unsaved window text may be lost; Quit is the cancel and
  failed reopening reports generically before an orderly drain, never a silent crash loop.
- **Desktop local-service loss** — before the first window is ready, fail only through
  startup recovery. After readiness, close stale native clients and offer one native,
  default-Restart whole-app boundary or Quit; distinguish saved device state from
  unsaved window text and never leave an apparently live window over a dead service.
- **Desktop disk full / corruption** — atomic JSON/export replacement, transactional
  SQLite under WAL, verified local backup/restore, visible automatic-recovery failure
  with a manual backup action, and re-sync from web if linked. A live
  commit failure returns `storage_unavailable`, flips readiness, and fail-closes product
  traffic until the shell/service supervisor restarts from the last durable snapshot;
  a process whose memory may have advanced past disk never resumes in place (PD76).
  On startup, only genuine store absence seeds: existing unreadable, malformed,
  unrecognized or incompatible storage stops the process before live state is
  rewritten; orphan atomic-temp/WAL/journal companions also prevent a false first
  boot, preserving the recovery source for explicit restore/repair (PD77).

## 4. Security & multi-tenancy

Per-tenant encryption + prefixes in object storage; signed URLs are tenant- and time-
scoped; backups encrypted; secrets isolated (F5); data-residency options select the
DB/object-store region per tenant (web). Audit storage is tamper-evident (F5).

## 5. Observability & ops

- The three pillars via OpenTelemetry: **logs** (structured, tenant-tagged), **metrics**
  (DB latency/connections, object-store throughput, queue depth, bus lag, generation
  success), **traces** (request → DB → model → runner).
- **SLOs**: API availability + p99 latency; generation success rate; sync delivery lag.
  Error budgets gate risky rollouts.
- Runbooks: backup/restore, migration, secret rotation, region failover, runner-fleet
  upgrade.

## 6. Open questions & decisions

See [`DECISIONS.md`](DECISIONS.md): **PD74** (desktop is the first production
release target; hosted multi-tenant web follows without a product/contract fork),
**PD28** (Postgres on web / embedded SQLite on
desktop, forward-only migrations), **PD29** (S3-compatible object storage, content-
addressed, per-tenant prefix, short-lived signed URLs, lifecycle-expired), **PD30**
(stateless autoscaled web API; sticky only for the reply stream; desktop = one bundled
sidecar), **PD31** (OpenTelemetry logs/metrics/traces + SLOs/error budgets), **PD32**
(durable = DB + object store, backed up/PITR; transient stores rebuildable, not backed
up — the prototype's persist/transient line held), and **PD76** (no commit means no
acknowledgement; a failed writer is product-walled until restart), and **PD77** (only
genuine first boot seeds; unusable existing storage fails startup closed).
