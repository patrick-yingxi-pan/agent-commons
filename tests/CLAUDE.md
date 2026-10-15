<!-- context-schema: v1 -->
# tests/ — repository-lock index

## Scope

Only doc-lint and cross-layer locks with no narrower module owner. The always-on
map is [`AGENTS.md`](../AGENTS.md).

## Read path

For a behavioral feature test, go to the owning module instead. Stay here only
when the subject is the repository, a document graph, or a cross-layer seam.

## Rule index

<!-- context-rules:start -->
| ID | Category | Rule | Implementation | Locks | Relations |
|---|---|---|---|---|---|
| TEST-V1 | verification | A suite lives beside what it locks; this directory owns only repository-wide and cross-layer claims. | [`../scripts/verifyPlan.mjs`](../scripts/verifyPlan.mjs) | [`suite-paths.test.ts`](suite-paths.test.ts) · [`verify-plan.test.ts`](verify-plan.test.ts) | refines ROOT-V1 |
| TEST-V2 | verification | Every shipped feature has one uniquely named current spec row naming implementation, lock, and status. | [`../docs/spec/`](../docs/spec/) | [`spec-conformance.test.ts`](spec-conformance.test.ts) | refines ROOT-V1 |
| TEST-V3 | verification | A lock reads the real source, asserts its preconditions, and is watched fail before it is evidence. | [`helpers/source.ts`](helpers/source.ts) · [`../docs/ui-invariants.md`](../docs/ui-invariants.md) | [`context-map.test.ts`](context-map.test.ts) · [`contract-boundaries.test.ts`](contract-boundaries.test.ts) · [`product-identity.test.ts`](product-identity.test.ts) · [`ui-invariants.test.ts`](ui-invariants.test.ts) | refines ROOT-V1 |
| TEST-V4 | verification | Browser-only behavior belongs in E2E; pure behavior moves into a testable module. | [`../e2e/`](../e2e/) · [`../src/lib/`](../src/lib/) | [`verify-plan.test.ts`](verify-plan.test.ts) | refines ROOT-V1; requires E2E-V1 |
| TEST-V5 | verification | A green rendered UI matrix covers every registered top-level section and proves each conversation/draft cell renders its named subject; its owned stack grants the signed-in fixture every conditional surface the matrix claims. Exiting panels must disappear from the DOM before capture, not merely stop intercepting clicks or outlast a fixed sleep. | [`../scripts/ui-sweep-ledger.mjs`](../scripts/ui-sweep-ledger.mjs) · [`../scripts/ui-sweep.mjs`](../scripts/ui-sweep.mjs) | [`ui-sweep-coverage.test.ts`](ui-sweep-coverage.test.ts) | refines ROOT-V1; requires UI-E4 |
| TEST-V6 | verification | The complete local verifier is mandatory before landing. Optional GitHub diagnostics run only by manual dispatch: their checks lane and exact E2E manifest partition execute on isolated hosts, with a read-only token, immutable action revisions, locked dependencies, the minimum Node major, browser prerequisites, measured bounded E2E budgets, cancellation, and finite job timeouts. | [`../docs/agent-workflow.md`](../docs/agent-workflow.md) · [`../.github/workflows/verify.yml`](../.github/workflows/verify.yml) · [`../package.json`](../package.json) · [`../scripts/verify.mjs`](../scripts/verify.mjs) · [`../scripts/verifyPlan.mjs`](../scripts/verifyPlan.mjs) | [`ci-workflow.test.ts`](ci-workflow.test.ts) · [`host-speed.test.ts`](host-speed.test.ts) · [`verify-plan.test.ts`](verify-plan.test.ts) | refines ROOT-V2 |
| TEST-V7 | verification | Controlled local verification interruption stops queued work, fails without publishing success weights, and waits for bounded cleanup of owned POSIX process groups and pipes; a departed leader is not proof its descendants stopped. Synthetic verifier subprocess fixtures fix `E2E_HOST_FACTOR` so startup does not depend on host calibration. | [`../scripts/verify.mjs`](../scripts/verify.mjs) · [`../scripts/dev.mjs`](../scripts/dev.mjs) · [`../scripts/childProcessLifecycle.mjs`](../scripts/childProcessLifecycle.mjs) · [`../playwright.config.ts`](../playwright.config.ts) · [`helpers/verifyInterruptionFixture.mjs`](helpers/verifyInterruptionFixture.mjs) | [`verify-interruption.test.ts`](verify-interruption.test.ts) · [`verify-plan.test.ts`](verify-plan.test.ts) · [`owned-stack-lifecycle.test.ts`](owned-stack-lifecycle.test.ts) · [`owned-process-observation.test.ts`](owned-process-observation.test.ts) · [`playwright-stack-lifecycle.test.ts`](playwright-stack-lifecycle.test.ts) | refines ROOT-V2 |
<!-- context-rules:end -->

## Details

## Where a suite lives: with the code it locks

**A suite is a module's own file, not a resident of a parallel tree.** It sits
beside the code it locks, under that module's directory, with that module's
`CLAUDE.md` and `SPEC.md` — the same progressive disclosure `CLAUDE.md` gets,
applied to every kind of file. Done across all three layers — the module
tables are in [`server/CLAUDE.md`](../server/CLAUDE.md),
[`src/CLAUDE.md`](../src/CLAUDE.md) and
[`contract/CLAUDE.md`](../contract/CLAUDE.md).

The rule for *which* module: **a suite belongs to what it locks, not to what it
drives through.** A test that exercises auth over HTTP is an auth test and sits
next to `auth.ts`; a test whose subject is the endpoint's own contract sits in
`server/routes/`. When both are real — a store-level lock and a route-level lock
on one resource — they are two files, and neither is folded into the other.

What stays in `tests/` is what the **repo** owns and no module can: the doc-lint
and cross-layer locks (`context-map`, `context-structure`, `spec-conformance`, `doc-paths`,
`suite-paths`, `review-rulebook`, `contract-boundaries`, `verify-plan`,
`ui-sweep-coverage`, `access-surface-parity`, `product-identity`) plus
`helpers/source.ts`, which scans the whole tree. This
directory is a home, not a leftover — if a suite here names one module as its
subject, it has a better home.

Two of those exist because *this* refactor broke things a run would only find
late: `suite-paths` checks that every path a suite names still resolves from
where the suite now lives and that no suite hand-counts its own repo ROOT;
`doc-paths` checks that prose naming a file names one that exists, with
deliberate references to history declared individually. Both are static and
sub-second — the alternative oracle was "run 1,679 tests and read the
failures", which is a consequence rather than a check.

Suites are excluded from `tsconfig.json` (`**/*.test.ts`) so that colocating
them inside `src`/`server`/`contract` does not silently reverse the measured
decision below that the test surface is verified by running, not by compiling.

## The conventions

- **Every feature ships with complete automated tests.** A change isn't done
  until its behavior is locked by tests that fail on a regression —
  reducer/contract behavior in `tests/*.test.ts`, server routes via the HTTP
  helper ([`server/testkit/http.ts`](../server/testkit/http.ts)), and the
  boundary contracts in `tests/contract-boundaries.test.ts`
  extended whenever a new cross-component seam appears. UI-only behavior the
  `node --test` harness can't exercise (it has no DOM) is verified in the
  running app and called out as such — or locked at the DOM level in `e2e/`
  (see [`e2e/CLAUDE.md`](../e2e/CLAUDE.md)). This holds **across clones**:
  write the tests every time rather than leaning on a particular clone's
  existing coverage.
- **Keep the spec ledger current.** When a feature lands, add its requirement
  row(s) to the relevant [`docs/spec/`](../docs/spec/README.md) pillar —
  statement, implementation pointer, locking test, status — so the spec stays
  the system of record for *what's built vs mocked*.
  `tests/spec-conformance.test.ts` fails if a spec reference rots; the named
  locking tests are what prove the behavior.
  Attachment IDs referenced across the ledger must still resolve to their
  authoritative rows; adding a format cannot silently replace an existing row.
- **Tests run in-memory.** The store's filesystem persistence is bypassed
  under `node --test`; snapshot round-trips are locked by
  `server/persistence/snapshot.test.ts`.
- **Locking tests read the source, not copies.** A lock that pins prose to
  behavior (e.g. `tests/relay-primer.test.ts`, `tests/context-map.test.ts`)
  extracts the fact from the implementation file and asserts the document
  states it — never hardcodes a second copy that can drift.
- **A new lock is not evidence until you have watched it FAIL.** Before
  claiming a behavior is locked, break the thing it guards — flip the predicate,
  delete the arm, revert the widening — run the test, and confirm it fails
  naming the offender; then restore. A green suite proves nothing about a test
  that cannot fail. Three vacuous assertions shipped in one session (2026-07-22)
  before this was written down, each green and each worthless:
  - a **source-scan regex built from a JS string** — `'\.'` in a string literal
    is `.`, `'\s*'` is `s*`, so the pattern matched nothing. Prefer
    whitespace-collapsed `includes()` over hand-escaped `new RegExp(...)`.
  - an **e2e precondition that only holds on a clean store** ("the audience sees
    nothing yet") — true on the first run, false forever after, because the e2e
    store persists. Assert preconditions in `node --test`, where the store is
    in-memory; let `e2e/` assert the DOM wiring.
  - a **conditional guard around the key assertion** (`if (res.status === 200)`)
    whose route did not exist, so the branch never ran. If a step may legitimately
    not apply, assert that it applied.
- **`tests/` and `e2e/` are deliberately NOT typechecked** — measured, not
  assumed (2026-07-22). `npm run typecheck` covers `src` + `contract` + `server`
  (FWD-8 put the backend in; a server type error used to reach runtime). Adding
  the test tree costs **574 errors** after declaring `node:test` /
  `node:assert/strict`: 124 possibly-undefined, 118 missing-property, 93
  argument-type, 74 arity, 48 implicit-any — overwhelmingly test-local looseness
  (untyped HTTP-helper responses indexed directly), not defects. Fixing them
  means retyping the suite's helper surface, i.e. editing the safety net itself
  at ~574 sites, for a payoff that runtime already delivers in seconds: a broken
  test fails loudly the first time it runs.
  **What that forgoes, concretely:** an invented union member is caught by the
  compiler, not by the run. A test here once constructed a `RelationOp` with a
  `kind` that does not exist; it crashed with an unrelated `TypeError` instead of
  saying "no such kind", and the real name had to be found by reading the
  reducer. Accepted — but if this bites repeatedly, the measurement above is the
  starting point, and `node:test`/`node:assert` declarations are the first step.

## Verification

Run the new or changed lock once against an intentional mutation, restore the
subject, then run `node --test` (and `npm run verify` before landing).
