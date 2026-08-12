# server/testkit/ — the server's test drivers (loaded when working here)

The layer's rules are [`server/CLAUDE.md`](../CLAUDE.md); testing conventions
are [`tests/CLAUDE.md`](../../tests/CLAUDE.md).

## What lives here

- `http.ts` — `call` / `callRaw`: drive the **real** route table at the handler
  level. Real `buildRouter()`, real store, no port bound and no entry point
  booted; a minimal fake req/res captures status, JSON body and headers. This is
  why a route suite reads like HTTP without the process plumbing.
- `connector.ts` — spawn a relay-connector **process** over stdio JSON-RPC
  against a minimal in-test relay backend. Shared by the source-form lock
  (`routes/relay-connector.test.ts`, which spawns the checked-in TS via Node's
  native type stripping) and the served-form lock
  (`routes/connector-serve.test.ts`, which spawns the byte-for-byte output of
  `GET /connector` with plain Node — proving the public install path runs
  without the repo or TypeScript).

## Why it is here and not under `tests/`

These drivers *are* server code: one constructs the server's router, the other
spawns the server's connector. Kept in a sibling test tree, every server suite
had to reach across the repo to boot its own subject. `tests/helpers/source.ts`
did **not** move — it scans the whole repository, so it stays repo-level.

## Rules

- **Excluded from typecheck** along with all `*.test.ts`
  (`tsconfig.json` → `exclude`), preserving the measured decision in
  [`tests/CLAUDE.md`](../../tests/CLAUDE.md) that the test surface is verified by
  running, not by the compiler.
- **No fixtures here.** A driver boots the real thing; the moment it starts
  *supplying* data, suites begin passing against the kit instead of the server.
  Seed data belongs in [`../data/`](../data/).
