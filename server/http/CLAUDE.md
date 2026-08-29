<!-- context-schema: v1 -->
# server/http/ — transport module index

## Scope

The layer's rules are [`server/CLAUDE.md`](../CLAUDE.md); the always-on map is
[`AGENTS.md`](../../AGENTS.md).

## Read path

Read [`../routes/CLAUDE.md`](../routes/CLAUDE.md) for resource registration and
[`docs/mcp-access.md`](../../docs/mcp-access.md) before changing dispatch or
access metadata.

## Rule index

<!-- context-rules:start -->
| ID | Category | Rule | Implementation | Locks | Relations |
|---|---|---|---|---|---|
| HTTP-A1 | architecture | Transport owns matching, responses, SSE, and router re-entry—never resource meaning. | [`router.ts`](router.ts) · [`respond.ts`](respond.ts) · [`sse.ts`](sse.ts) | [`security-headers.test.ts`](security-headers.test.ts) | refines ROOT-A2 |
| HTTP-A2 | architecture | Shared response and security policy is applied in one transport funnel. | [`respond.ts`](respond.ts) | [`security-headers.test.ts`](security-headers.test.ts) | refines ROOT-A1; requires HTTP-A1 |
| HTTP-D1 | data-access | Non-HTTP doors re-enter the router without private policy branches. | [`dispatch.ts`](dispatch.ts) | [`../mcp-parity.test.ts`](../mcp-parity.test.ts) | refines SERVER-D3 |
| HTTP-D2 | data-access | Access classification is route-owned metadata exposed by `Router.list()`. | [`router.ts`](router.ts) | [`../../tests/access-surface-parity.test.ts`](../../tests/access-surface-parity.test.ts) | refines SERVER-A2; requires HTTP-D1 |
| HTTP-D3 | data-access | An exact deployment origin is an enforcement wall on socket traffic, preflight, and router re-entry; missing Origin remains valid for native/machine callers. | [`origin.ts`](origin.ts) · [`../index.ts`](../index.ts) · [`../routes/index.ts`](../routes/index.ts) | [`origin.test.ts`](origin.test.ts) · [`../routes/mcp-stateful.test.ts`](../routes/mcp-stateful.test.ts) | refines HTTP-A2; requires SERVER-D2 |
<!-- context-rules:end -->

## What lives here

Everything between a socket and a route handler, and nothing about what the
routes mean:

- `router.ts` — pattern matching + `Router.list()`, the catalog the MCP and
  in-app tool surfaces are generated from. The router being **plain data** is
  what makes that generation possible; keep it that way.
- `respond.ts` — `sendJson` / `sendError` / `sendBytes` / `sendJsonCached` and
  `BASE_HEADERS`. Security headers and cache validators live here so that every
  response gets them by construction rather than per handler.
- `sse.ts` — the one server-sent-events door.
- `dispatch.ts` — re-entry into the router for the non-HTTP access doors, so MCP
  and the in-app session traverse the same policies as a browser request.

Beside them, the suites that lock the transport contract.

## Rules

- **No resource knowledge here.** If a change to this directory needs to know
  what a session or a project *is*, it belongs in a route or the store instead.
- **Headers are set in one place.** A handler that hand-writes a security or
  cache header is a bug waiting for the second handler that forgets;
  `security-headers.test.ts` is what makes that non-negotiable.
- **Pinned CORS is enforced, not advertised.** `CORS_ORIGIN=*` is the explicit
  development posture. An exact origin refuses every mismatched browser request
  before resource policy; requests with no Origin are native/machine callers.
- **`dispatch.ts` must not grow a policy branch.** The moment a door gets its
  own conditional, access parity stops being structural and becomes a promise.
- **Access classification belongs to the route.** Product is the default.
  Protocol/credential forms, semantic capability aliases, and session-intrinsic
  realizations use the router shorthands and carry a substantive reason beside
  registration. Never recreate a door-specific exclusion list.

## Verification

Run the transport suite and both access-parity locks after router or dispatch
changes.
