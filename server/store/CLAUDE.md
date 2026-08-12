# server/store/ — the in-memory store (loaded when working under server/store/)

The layer's rules are [`server/CLAUDE.md`](../CLAUDE.md); the always-on map is
[`AGENTS.md`](../../AGENTS.md).

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
