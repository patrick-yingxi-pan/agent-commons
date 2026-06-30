# F6 · Persistence, storage & ops

> **Foundation.** The concrete storage tiers, the durable-vs-transient split, and how
> the system is deployed, observed, backed up, and scaled — the production form of
> `server/persist.ts` (the JSON snapshot) and the run scripts. Serves spec
> PERSIST-1..6, MOCK-5/6, and grounds [F1](F1-domain-model.md)/[F4](F4-broker-runners.md).

## 1. Problem & scope

The prototype persists one atomic JSON snapshot (`server/persist.ts`) and runs as one
Node process (`server/index.ts`) that serves the built UI + API + an in-process mock
model. Production needs real storage tiers, durability/backup, observability, and two
very different deployment topologies sharing one image of the UI + contract.

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
- The prototype's `scripts/snapshot.ts` (save/restore) is the spiritual ancestor of the
  desktop export/import.

### 2.5 Deployment topology

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
- **Desktop disk full / corruption** — atomic writes (the prototype's temp-file+rename
  already), local backup, re-sync from web if linked.

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

See [`DECISIONS.md`](DECISIONS.md): **PD28** (Postgres on web / embedded SQLite on
desktop, forward-only migrations), **PD29** (S3-compatible object storage, content-
addressed, per-tenant prefix, short-lived signed URLs, lifecycle-expired), **PD30**
(stateless autoscaled web API; sticky only for the reply stream; desktop = one bundled
sidecar), **PD31** (OpenTelemetry logs/metrics/traces + SLOs/error budgets), **PD32**
(durable = DB + object store, backed up/PITR; transient stores rebuildable, not backed
up — the prototype's persist/transient line held).
