<!-- context-schema: v1 -->
# server/data/ — seed-data module index

## Scope

The layer's rules are [`server/CLAUDE.md`](../CLAUDE.md); the always-on map is
[`AGENTS.md`](../../AGENTS.md).

## Read path

Read [`docs/spec/11-mock-boundary.md`](../../docs/spec/11-mock-boundary.md) and
[`docs/demo-accounts.md`](../../docs/demo-accounts.md), then the fixture family
and its sibling lock.

## Rule index

<!-- context-rules:start -->
| ID | Category | Rule | Implementation | Locks | Relations |
|---|---|---|---|---|---|
| SEED-P1 | product | Seed data is the declared deterministic mock boundary, not hidden production behavior. | [`sessions.ts`](sessions.ts) · [`cowork.ts`](cowork.ts) | [`demo-accounts.test.ts`](demo-accounts.test.ts) | refines ROOT-P2 |
| SEED-D1 | data-access | Each demo account owns a disjoint, moderately complete themed world. | [`sessions.ts`](sessions.ts) · [`cowork.ts`](cowork.ts) | [`demo-accounts.test.ts`](demo-accounts.test.ts) | refines SERVER-O1 |
| SEED-D2 | data-access | Tenancy stamps are code-owned and reconciled after snapshot restore. | [`cowork.ts`](cowork.ts) · [`../store/index.ts`](../store/index.ts) | [`demo-accounts.test.ts`](demo-accounts.test.ts) · [`../store/registry-tenancy.test.ts`](../store/registry-tenancy.test.ts) | refines STORE-D2 |
| SEED-V1 | verification | Showcase state is built through real mutators so fixtures cannot drift from contract behavior. | [`cowork.ts`](cowork.ts) · [`../store/index.ts`](../store/index.ts) | [`demo-accounts.test.ts`](demo-accounts.test.ts) | refines ROOT-V1; requires SEED-D1 |
<!-- context-rules:end -->

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
- **The showcase is development-only first-run content.** Release profiles install
  a clean baseline. An existing snapshot is never reinterpreted: use a new
  `DATA_FILE`/`DATABASE_PATH` to exercise a different first-run world.

## Verification

Run [`demo-accounts.test.ts`](demo-accounts.test.ts) and the affected resource's
store/route suites. Review all six worlds when changing the data standard.
