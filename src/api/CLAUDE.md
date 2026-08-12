# src/api/ — the one door to the backend (loaded when working here)

The layer's rules are [`src/CLAUDE.md`](../CLAUDE.md); the always-on map is
[`AGENTS.md`](../../AGENTS.md).

## What lives here

The only code in the UI that knows the backend exists: `cache.ts` (the read
model), `events.ts` (the SSE router), `hooks.ts` (what components consume),
and the command senders. Wire types come from
[`contract/`](../../contract/CLAUDE.md) verbatim — never re-declared here.

Beside them, the suites that lock the door's contract: optimistic-id
reconciliation, the account guard, freshness/refetch behavior.

## Rules

- **The frontend is a CACHE of the backend, not a second source of truth.**
  Every feature is server-owned; this layer holds a projection of it. No inline
  fixtures, no client-invented entities — if the UI can show it, the server can
  serve it, and it survives a reload because the server said so.
- **One door.** Components read hooks; controllers issue commands. A component
  that learns a URL or an SSE event name has broken the seam that makes the
  contract portable.
- **Optimistic ids reconcile, never leak.** A locally-minted id must be replaced
  by the server's on ack; the lock beside this file exists because a leaked one
  looks correct until a reload.
- **Every declared `ServerEvent` has a producer and a consumer.** The
  contract-level scan (`tests/contract-boundaries.test.ts`) fails on a stale
  handler or an unhandled event — so adding an event means wiring both ends.
- **Absence has fixed meaning (INV-9).** An absent field inherits, means a
  complete-set constant, or means minimal-risk none — it is never resolved into
  a privileged value on the caller's behalf.
