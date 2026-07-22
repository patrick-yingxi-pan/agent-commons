# tests/ — testing conventions (loaded when working under tests/)

The always-on map is [`AGENTS.md`](../AGENTS.md).

- **Every feature ships with complete automated tests.** A change isn't done
  until its behavior is locked by tests that fail on a regression —
  reducer/contract behavior in `tests/*.test.ts`, server routes via the HTTP
  helper, and the boundary contracts in `tests/contract-boundaries.test.ts`
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
  `tests/snapshot.test.ts`.
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
