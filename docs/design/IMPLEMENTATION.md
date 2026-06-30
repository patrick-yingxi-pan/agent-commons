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

### Up next (candidate order, not yet built)

- **Identity & tenancy — slice 2** (F2) — the UI consumes `/v1/me` (account label /
  org-aware affordances) and entities become **tenant-scoped** at the store layer (the
  RLS-equivalent boundary, PD9): a `tenantId` on rows + scoping reads/writes, desktop
  being the N=1 case.
- **Error envelope + idempotency keys + pagination** (F3) — wire-protocol hardening
  in the mock router, testable on both backends.
- **Forward-only *data* migrations** (F1 PD6) — replace the version-mismatch ⇒
  discard-and-reseed with real per-version data migrations on the SQLite backend, so a
  store upgrade preserves data. (The schema-migration runner is already in place.)

> Keep this table append-only and honest: a row is `✅ built` only when its locking
> test passes. Partial work stays `🚧` with a note on what's missing.
