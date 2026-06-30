# Implementation log — building the locked-in design

> **What this is.** A running log of the production design (`docs/design/`) being
> **implemented in-repo**, step by step. The design tree was written under a
> *"We design, not build"* stance; that stance was **reversed by the owner** (see
> below). This file tracks what has actually been built against the `PD*` decisions,
> so `docs/design/` stays the blueprint and this file is the build status.

## The reversal (2026-06-30)

The original framing ([`README.md`](README.md): *"We design, not build"*) kept the
prototype a prototype and `docs/design/` a paper blueprint. The owner has decided to
**build the locked-in design details into the repo**, incrementally, prioritizing
software architecture and code quality over speed (each step paired with a code
review).

What this does **not** change — the implementation stays inside the project's other
locked-in constraints, which still hold:

- **Few runtime dependencies.** New infrastructure is built on platform primitives
  where one exists, not new packages. (Step 1 uses core `node:sqlite` — *zero* new
  deps for a real embedded database.)
- **The contract is load-bearing.** `contract/*.ts` stays framework- and Node-free;
  production plumbing lives in `server/`, behind the same wire types.
- **Both deployments share one UI.** Desktop (sidecar) and web differ only behind the
  backend seam, exactly as the design says.
- **Every feature ships with tests.** A step isn't done until `node --test` locks it.
- **Mock by design where it must stay mock.** No real model, no real third-party
  OAuth secrets in-repo, etc. — the build targets the *shape* of production infra that
  can live honestly in this codebase, not external managed services.

Some `PD*` decisions name genuinely external infrastructure (managed Postgres,
Redis, KMS, a CDN, multi-region). Those can't live "in the repo" literally; for them
the build delivers the **in-repo seam** (an interface + the desktop-side concrete
backend) that a web deployment would point at the managed service. Each step says
which it is.

## Approach

Foundations first (matching [`PLAN.md`](PLAN.md)'s order), in **manageable steps**,
each: implement → `npm run typecheck` + `node --test` (+ runtime smoke where it
proves the boot path) → `/code-review` → fix issues → commit. The persistence layer
is first because every other foundation (identity rows, audit, registries) sits on
it.

## Status

| Step | Design | What landed | Status |
|------|--------|-------------|--------|
| 1 | F6 PD28 / PD32, F1 PD1 | **Persistence port + embedded SQLite backend.** `server/persistence/` — a `PersistenceBackend` port (`format.ts`), the original JSON snapshot behind it (`json.ts`), and a real relational store on core `node:sqlite` with forward-only migrations (`sqlite.ts`), driven off one `SLICE_KIND` manifest so it can't drift from `PersistedState`. `server/persist.ts` is now the facade; `PERSIST_BACKEND=sqlite` opts in (default stays JSON, so tests + desktop are unchanged). Locked by `tests/persist-backend.test.ts` (cross-backend round-trip, version/fresh-db → null, migration idempotency, uncategorized-slice guard) + a two-process store boot smoke. | ✅ built |
| 2 | F2 PD8 / PD9 | **Identity & tenancy — slice 1 (the wire surface).** `contract/identity.ts` (`User` / `Tenant` / `TenantRole` / `Identity`); `server/identity.ts` resolves it — desktop/mock = a single local user in a `personal` tenant; the remote web server resolves a tenant-scoped principal from the auth seam (request headers stand in for verified OIDC claims, PD8; tenant scoping per PD9). `store.identity(headers)` + `GET /v1/me` (the account the UI labels itself with, P1 §4). Locked by `tests/identity.test.ts` (route + resolver: local invariance, web defaults, the header seam, role/tenant overrides, unknown-user fallback). | ✅ built |
| 3 | F3 PD15 | **Idempotency keys for create-mutations.** `server/idempotency.ts` — a TTL cache + response capture/replay; an opt-in router wrapper replays the first response for a given (tenant, `Idempotency-Key`) so a retried create can't duplicate. Applied to `POST /sessions`, `/dispatch`, `/schedules`, `/relations/ops`; transparent without the header (every existing test unaffected); only 2xx is cached; keyed per tenant (slice 1). `IDEMPOTENCY_HEADER` documented in `contract/api.ts`; `headerValue()` shared in `respond.ts`. Locked by `tests/idempotency.test.ts` (same-key dedups to one effect + identical body, no-key is transparent, distinct keys don't collide, plus cache/capture/replay units). Concurrency + eviction limits documented in the module. | ✅ built |
| 8 | F1 PD6 | **Forward-only data migrations.** `server/persistence/migrate.ts` — `migrateState` walks a loaded snapshot one version at a time up to `STORE_VERSION` (a gap or a newer-than-build snapshot ⇒ null ⇒ reseed); both backends route `load()` through it, replacing the version-mismatch discard. The **first real migration** now lives here — v4→v5 backfills `AuditEntry.tenantId` (step 11) so a legacy store upgrades in place instead of reseeding. Locked by `tests/persist-migrate.test.ts` (engine: passthrough/garbage/newer/chain/gap; the v4→v5 backfill unit test; **+ SQLite and JSON backend integrations** proving a legacy v4 store upgrades during `load()`). | ✅ built |
| 7 | F3 / obs | **Request correlation ids.** A first-registered router middleware stamps every response (including a short-circuited 429) with `X-Request-Id` — the seam logs/traces correlate on (F6 OpenTelemetry). Locked by `tests/ops.test.ts` (present + unique + present-on-error). | ✅ built |
| 6 | F6 | **Ops endpoints.** `GET /healthz` (liveness + epoch) and `GET /readyz` (readiness via a cheap store probe → 503 to drain on failure) for the autoscaled web tier behind a load balancer. Locked by `tests/ops.test.ts`. | ✅ built |
| 5 | F3 | **Per-tenant rate limiting.** `server/ratelimit.ts` — a fixed-window `RateLimiter` (injectable clock) keyed by tenant (identity F2). Wired as a **router middleware** (new `Router.use()` hook) that bounds mutations per tenant per minute, replying 429 `limit_exceeded` + `Retry-After`. Opt-in via `RATE_LIMIT_PER_MIN` (read per request ⇒ off by default, suite unaffected); GETs never limited. Locked by `tests/ratelimit.test.ts` (limiter window/reset/per-key units; router off-by-default, 429+Retry-After when configured, GET-exempt). Also fixed the HTTP test helper to emit the request body on `end`-listener registration (robust to pre-handler `await`s like middleware). | ✅ built |
| 4 | F3 PD14 | **Cursor pagination (keyed).** `contract` `Page<T>` + `server/pagination.ts` — a reusable pager whose cursor anchors to an item id (stable under appends: no skip/dupe across pages, unlike offset). Opt-in via `?limit[&cursor]`; without `limit` the full array is returned (the UI reads the array until it virtualizes, P1 PD36). Applied through one shared `sendList` helper to `GET /sessions`, `/audit`, `/dispatch`, `/artifacts` (form-follows-function — every paginated list reads/validates identically). Locked by `tests/pagination.test.ts` (pager walk + the keyed-stability-under-prepend property + lenient/empty/invalid cases; route back-compat, page-walk reassembly, invalid-limit 400, across all four endpoints). | ✅ built |
| 9 | P5 | **Model round-trip timeout → graceful fallback.** `server/generate.ts` combines the caller's abort with a per-call `MODEL_TIMEOUT_MS` deadline (`AbortSignal.any`/`.timeout`), so a hung/slow endpoint can't wedge the turn — on expiry the stream aborts and the turn degrades to the local fallback (the timeout trips the combined signal, not the caller's, so it's distinguished from a client close). SDK retries configurable via `ANTHROPIC_MAX_RETRIES`. Locked by `tests/generate-timeout.test.ts` (points the SDK at a never-responding server, short timeout, asserts the fallback). | ✅ built |
| 10 | F3 | **Conditional GET / ETag.** `server/http/respond.ts` `weakETag` + `sendJsonCached` — a weak validator (dependency-free FNV-1a) on cacheable reads; a matching `If-None-Match` returns 304 (empty body). Applied to `GET /capabilities` (stable per process) and `/relations` (changes only on a confirmed op). Locked by `tests/conditional-get.test.ts`. | ✅ built |
| 11 | F5 / F2 PD9 | **Tenant-scoped audit trail.** `AuditEntry.tenantId` (contract); `recordAudit` stamps it (default = the local/personal tenant); `listAuditLog(tenantId)` filters; `GET /audit` scopes to `store.identity(...).tenant.id` — the RLS-equivalent boundary on the first entity (a tenant sees only its own trail). Locked by `tests/audit-tenant.test.ts`. | ✅ built |
| 12 | F6 PD31 | **`/metrics` endpoint.** A counter middleware + `GET /metrics` in Prometheus text exposition: per-method request counts, process uptime, the store epoch as an info label (`sendText` helper). Rounds out the ops trio (healthz/readyz/metrics). Locked by `tests/metrics.test.ts`. | ✅ built |
| 13 | F4 | **Stale-runner reaping (liveness TTL).** `RunnerRegistry.reapStale(ttlMs)` marks online runners whose last heartbeat is older than the TTL as offline (durable identity kept), emitting `runner.disconnected`; the run daemon calls it each tick (`RUNNER_TTL_MS`). The always-up co-located sidecar seed is **pinned** (`registry.pin`) and exempt — it has no external heartbeat client but is reachable for the process's life. `find()` filters to online, so routing stops targeting a reaped runner. Locked by `tests/registry.test.ts` (reap past TTL, strict TTL boundary, pinned-exempt, no-op for offline/fresh, heartbeat rescue). | ✅ built |
| 14 | F4 | **Runner enrollment + reconnect auth.** A single `enrollmentAllowed(req)` gate on **every** state-changing runner-lifecycle route — `POST /runners`, `POST /runners/:id/heartbeat` (reconnect), `PATCH …/capabilities`, `DELETE /runners/:id` — so a heartbeat can't bypass the token to resurrect a reaped runner. `RUNNER_ENROLL_TOKEN` via `Authorization: Bearer` (case-insensitive) or `x-runner-token`; **constant-time** compare (`timingSafeEqual`); unset ⇒ open (loopback default). Locked by `tests/runner-enroll.test.ts` (all four routes gated, OR-semantics, case-insensitive Bearer). | ✅ built |
| 15 | P7 | **No overlapping scheduled runs.** `runSchedule` returns the in-flight run instead of starting a second when one is already `running` (the daemon can tick before a run finishes). Locked by `tests/schedule-overlap.test.ts`. | ✅ built |
| 16 | F6 PD31 / F4 | **Runner gauges in `/metrics`.** `runners_total{status="online|offline"}` from the broker registry. Locked by `tests/metrics.test.ts`. | ✅ built |
| 17 | F5 | **Baseline security headers.** `SECURITY_HEADERS` (nosniff, `X-Frame-Options: DENY`, CSP `frame-ancestors 'none'`, `Referrer-Policy: no-referrer`) on **every** API response via the exported shared `BASE_HEADERS` — buffered JSON (success + error + 304), text (`/metrics`), bytes (`/fs/content`), the idempotency-replay path, and the SSE stream (nosniff) — plus the served UI/asset responses (`server/index.ts`). Locked by `tests/security-headers.test.ts` (each sender pinned independently). | ✅ built |
| 18 | F3 / obs | **Honour inbound `X-Request-Id`.** The correlation middleware propagates a *safe* (bounded charset, ≤128 chars) inbound id for distributed tracing, else mints one — the validation prevents log-injection / unbounded cardinality from a client-set header. Locked by `tests/request-id.test.ts`. | ✅ built |
| 19 | F6 | **Graceful-shutdown draining.** SIGTERM/SIGINT flips a drain latch (`store.beginDraining`) → `GET /readyz` returns 503 `draining` (LB stops routing new traffic) while `/healthz` stays up; then `server.close()` lets in-flight requests finish before exit, force-closing lingering streams (SSE) after a short grace and a bounded `DRAIN_GRACE_MS` hard-exit fallback — instead of exiting in the same tick (which made the drain unobservable). Latch + `/readyz` locked by `tests/draining.test.ts`; the signal-path wiring verified by a boot smoke (the handler fires on Linux/macOS; Windows SIGTERM hard-kills regardless). | ✅ built |

| 20 | P1 PD33 (FWD-1) | **Pre-attached entry shortcuts.** `newSession(seed?)` takes an optional context seed; a fresh thread can land already-escalated with a repo/folder/connector pre-attached and its panel open — the old per-mode entries as shortcuts, not tabs (one code path, the same attach funnel). An `EmptyState` launcher ("Start with a repo, folder, or connector…") reuses the whole Add-context picker. Also fixed a real gap: contexts attached to a *draft* (pre-first-send) were lost on materialize — now held in `pendingDraftContexts` and persisted onto the real session on first send. UI-verified in the running app (controller hook isn't `node --test`-exercisable); typecheck + build clean. | ✅ built (UI) |

| 21 | P1 PD34 (FWD-2) | **Per-conversation panel memory.** `src/lib/panelPrefs.ts` remembers which right-panel a session had open (a `PanelFocus`, or `null` for explicitly closed) — restored in `selectSession` (and the async reconcile), written on the explicit panel actions (toggle / close / attach-opens-it). `strongestFocus` stays the default when there's no stored choice; the absent-vs-explicit-null distinction is the load-bearing bit. localStorage-backed (the design's documented fallback for a forthcoming server-side cross-device `ui_prefs`). Store logic locked by `tests/panelPrefs.test.ts`; UI-verified in-app (close → switch away/back → reload, panel stays closed, overriding the auto-open). | ✅ built (UI) |

### Up next (candidate order, not yet built)

- **Identity & tenancy — slice 2** (F2) — extend the tenant-scoping pattern (now
  proven on the audit trail, step 11) to the rest of the entities at the store layer
  (the RLS-equivalent boundary, PD9): a `tenantId` on rows + scoped reads/writes,
  desktop being the N=1 case.
- **UI consumes `/v1/me`** (F2 / P1 §4) — surface the account/tenant. *Deferred:
  needs a placement/design decision (no account chip exists today) — flagged for the
  owner rather than invent UI autonomously.*

> Keep this table append-only and honest: a row is `✅ built` only when its locking
> test passes. Partial work stays `🚧` with a note on what's missing.
