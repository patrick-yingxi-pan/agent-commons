# server/http/ — the transport layer (loaded when working under server/http/)

The layer's rules are [`server/CLAUDE.md`](../CLAUDE.md); the always-on map is
[`AGENTS.md`](../../AGENTS.md).

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
- **`dispatch.ts` must not grow a policy branch.** The moment a door gets its
  own conditional, access parity stops being structural and becomes a promise.
- **Access classification belongs to the route.** Product is the default.
  Protocol/credential forms, semantic capability aliases, and session-intrinsic
  realizations use the router shorthands and carry a substantive reason beside
  registration. Never recreate a door-specific exclusion list.
