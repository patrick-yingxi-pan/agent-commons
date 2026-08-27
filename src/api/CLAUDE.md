<!-- context-schema: v1 -->
# src/api/ — backend-door module index

## Scope

The layer's rules are [`src/CLAUDE.md`](../CLAUDE.md); the always-on map is
[`AGENTS.md`](../../AGENTS.md).

## Read path

Read [`contract/CLAUDE.md`](../../contract/CLAUDE.md) for wire types,
[`../controller/CLAUDE.md`](../controller/CLAUDE.md) for command sequences, and
[`docs/mcp-access.md`](../../docs/mcp-access.md) for reachability parity.

## Rule index

<!-- context-rules:start -->
| ID | Category | Rule | Implementation | Locks | Relations |
|---|---|---|---|---|---|
| API-A1 | architecture | Hooks are the component read door and command senders are the controller write door. | [`hooks.ts`](hooks.ts) · [`commands.ts`](commands.ts) | [`../../tests/contract-boundaries.test.ts`](../../tests/contract-boundaries.test.ts) | refines UI-A1 |
| API-D1 | data-access | Cache and events project server-owned truth; the client invents no entities. | [`cache.ts`](cache.ts) · [`events.ts`](events.ts) | [`connectivity-freshness.test.ts`](connectivity-freshness.test.ts) | refines UI-D1 |
| API-D2 | data-access | Every UI operation uses a declared `paths.*` builder visible to the parity scanner. | [`keys.ts`](keys.ts) · [`hooks.ts`](hooks.ts) · [`commands.ts`](commands.ts) | [`../../tests/access-surface-parity.test.ts`](../../tests/access-surface-parity.test.ts) | refines UI-D2; requires API-A1 |
| API-D3 | data-access | Optimistic IDs reconcile on acknowledgement and every server event has producer and consumer. | [`cache.ts`](cache.ts) · [`events.ts`](events.ts) | [`optimistic-id.test.ts`](optimistic-id.test.ts) · [`../../tests/contract-boundaries.test.ts`](../../tests/contract-boundaries.test.ts) | requires API-D1; refines ROOT-A1 |
| API-D4 | data-access | Browser session reads share one bounded message-page budget; older continuations belong to the conversation controller and never replace the newest by-id cache projection. | [`sessionPaging.ts`](sessionPaging.ts) · [`commands.ts`](commands.ts) · [`hooks.ts`](hooks.ts) | [`../controller/conversation-store.test.ts`](../controller/conversation-store.test.ts) · [`../../e2e/history-pagination.spec.ts`](../../e2e/history-pagination.spec.ts) | refines UI-E6; requires API-A1 |
<!-- context-rules:end -->

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
- **Reachability is the UI capability proof (INV-11).** Every backend operation
  used by the shipped UI must pass a declared `paths.*` entry through this
  funnel. The cross-layer parity lock follows imports into real consumers; an
  unused wrapper cannot pretend the UI has a capability.
- **Optimistic ids reconcile, never leak.** A locally-minted id must be replaced
  by the server's on ack; the lock beside this file exists because a leaked one
  looks correct until a reload.
- **Every declared `ServerEvent` has a producer and a consumer.** The
  contract-level scan (`tests/contract-boundaries.test.ts`) fails on a stale
  handler or an unhandled event — so adding an event means wiring both ends.
- **Absence has fixed meaning (INV-9).** An absent field inherits, means a
  complete-set constant, or means minimal-risk none — it is never resolved into
  a privileged value on the caller's behalf.

## Verification

Run API sibling suites plus both cross-layer boundary/parity locks after path,
event, hook, or command changes.
