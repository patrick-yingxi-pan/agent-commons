# server/data/ — seed fixtures (loaded when working under server/data/)

The layer's rules are [`server/CLAUDE.md`](../CLAUDE.md); the always-on map is
[`AGENTS.md`](../../AGENTS.md).

## What lives here

The seeded world: sessions, projects, artifacts, repos and diffs, terminal
output, saved contexts, providers, prompts, workers, runners, commissions. This
is the **declared mock boundary** — data is fixture *by design*, deterministic
and reviewable, so a reader can tell what is built from what is staged
([`docs/spec/11-mock-boundary.md`](../../docs/spec/11-mock-boundary.md)).

Beside the fixtures, the suites that hold them to their standard —
`demo-accounts.test.ts` most of all.

## Rules

- **The six demo accounts are a data standard, not a pile of rows.** Each holds
  its own themed world; the worlds are pairwise disjoint; every account carries
  at least one of every core type (sessions, a project, artifacts, a routine
  *with* run history, a dispatch run); scale stays moderate. Roster and
  credentials: [`docs/demo-accounts.md`](../../docs/demo-accounts.md).
- **Tenancy stamps are code-owned.** Seed rows carry an optional `tenantId` and
  `reconcileSeedTenancy` re-applies the stamps after a snapshot restore, so a
  store file written by an older build cannot undo the account split.
- **Seed through the real mutators.** Showcase data is created by driving the
  same code paths a user would, never by hand-assembling store internals — that
  is what keeps fixtures from drifting away from the contract.
- **An existing snapshot is never re-seeded.** Delete `.data/store.json` to
  regenerate.
