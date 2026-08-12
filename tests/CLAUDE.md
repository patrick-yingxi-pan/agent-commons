# tests/ — testing conventions (loaded when working under tests/)

The always-on map is [`AGENTS.md`](../AGENTS.md).

## Where a suite lives: with the code it locks

**A suite is a module's own file, not a resident of a parallel tree.** It sits
beside the code it locks, under that module's directory, with that module's
`CLAUDE.md` and `SPEC.md` — the same progressive disclosure `CLAUDE.md` gets,
applied to every kind of file. Done for `server/` (see
[`server/CLAUDE.md`](../server/CLAUDE.md) for its module table); `src/` and
`contract/` still route through here and are the next pass.

The rule for *which* module: **a suite belongs to what it locks, not to what it
drives through.** A test that exercises auth over HTTP is an auth test and sits
next to `auth.ts`; a test whose subject is the endpoint's own contract sits in
`server/routes/`. When both are real — a store-level lock and a route-level lock
on one resource — they are two files, and neither is folded into the other.

What stays in `tests/` is what the **repo** owns and no module can: the doc-lint
and cross-layer locks (`context-map`, `spec-conformance`, `review-rulebook`,
`contract-boundaries`, `verify-plan`, `ui-sweep-coverage`) plus
`helpers/source.ts`, which scans the whole tree. This directory is a home, not a
leftover — if a suite here names one module as its subject, it has a better home.

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
