<!-- context-schema: v1 -->
# server/store/ — in-memory store module index

## Scope

The layer's rules are [`server/CLAUDE.md`](../CLAUDE.md); the always-on map is
[`AGENTS.md`](../../AGENTS.md).

## Read path

Read the entity's direct store suite, its route context if changing an endpoint,
and [`../persistence/CLAUDE.md`](../persistence/CLAUDE.md) when changing durable
state.

## Rule index

<!-- context-rules:start -->
| ID | Category | Rule | Implementation | Locks | Relations |
|---|---|---|---|---|---|
| STORE-A1 | architecture | Server-owned entities and mutators have one in-memory source of truth. | [`index.ts`](index.ts) | [`index.test.ts`](index.test.ts) | refines ROOT-A1 |
| STORE-D1 | data-access | Tenant visibility is enforced by read-time projection and hides foreign existence. | [`index.ts`](index.ts) | [`project-tenancy.test.ts`](project-tenancy.test.ts) · [`session-tenancy.test.ts`](session-tenancy.test.ts) | refines ROOT-D1; requires SERVER-D2 |
| STORE-D2 | data-access | Seed tenancy is reconciled after rehydrate so old snapshots cannot undo isolation. | [`index.ts`](index.ts) · [`../data/`](../data/) | [`registry-tenancy.test.ts`](registry-tenancy.test.ts) | requires STORE-D1; requires SERVER-D4 |
| STORE-D3 | data-access | Per-viewer session presentation state lives in its narrow user/session module; workspace changes prune dangling focus and session deletion cascades it. | [`../sessionPreferences.ts`](../sessionPreferences.ts) · [`index.ts`](index.ts) | [`../sessionPreferences.test.ts`](../sessionPreferences.test.ts) · [`../routes/session-preferences.test.ts`](../routes/session-preferences.test.ts) | refines SERVER-D5; requires STORE-A1 |
| STORE-V1 | verification | Direct store suites run in memory; HTTP behavior and snapshot round-trips stay with their own modules. | [`index.ts`](index.ts) | [`index.test.ts`](index.test.ts) · [`../persistence/snapshot.test.ts`](../persistence/snapshot.test.ts) | refines SERVER-V1 |
<!-- context-rules:end -->

## What lives here

`index.ts` — the single in-memory store: every entity the backend owns
(sessions, projects, artifacts, schedules, runs, the Agent Commons registries,
the social graph), the mutators that change them, and the tenant-scoped reads
that project them per viewer. It sat at the server root until the locks moved
next to their subjects; promoting it to a directory gave those locks a home
that isn't the root.

Beside it: the suites that exercise the store **directly**, without going
through the router — the tenancy projections (`*-tenancy.test.ts`), the run
bookkeeping, compaction, schedule overlap. Suites that reach the same state
*through* HTTP live in [`../routes/`](../routes/), because what they lock is the
endpoint's contract, not the store's.

## Rules

- **Tenant scoping is a read-time projection, not a caller's responsibility.**
  `rowVisibleTo` decides what a principal can see; a new entity type is not done
  until its reads filter through it and a `*-tenancy.test.ts` covers the
  owner / visitor / foreign-tenant triple. Foreign tenants get existence-hiding
  404s, not 403s.
- **Tests run in-memory.** Filesystem persistence is bypassed under
  `node --test`; the snapshot round-trip is locked in
  [`../persistence/`](../persistence/).
- **Seed tenancy stamps are code-owned.** `reconcileSeedTenancy` re-applies them
  after a snapshot restore, so a store file written by an older build cannot
  undo the account split.

## This module is a monolith

One file, ~7,700 lines, holding every entity in the system. Colocation makes the
cost legible rather than fixing it: the suites beside it name the seams
(sessions, projects, artifacts, registries, usage, audit, schedules), and a
split along those lines is the natural follow-up. New state belongs in the
narrowest module that can hold it, not automatically here.

## Verification

Run the entity's direct store suite, the corresponding route suite when its API
projection changes, and the persistence suite when adding durable state.
