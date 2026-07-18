# The MCP door — the third access method, and the access-parity rule

> **What this document is.** The from-zero explainer of how this product is
> reachable **as an MCP server**, and of the rule that governs *all* of its
> access methods. Requirement rows: PORT-9
> ([`spec/05-portable-contract.md`](spec/05-portable-contract.md)) and INV-11
> ([`spec/09-design-invariants.md`](spec/09-design-invariants.md)). Locks:
> `tests/mcp.test.ts`, `tests/mcp-parity.test.ts`, `tests/auth-bearer.test.ts`.

## 1. The three access methods

The same product is reachable three ways, and they deliberately differ in
**form** only:

1. **The browser UI** — a human clicking. The UI is a client of the HTTP API
   (`/api/v1/*`) and holds no capability of its own.
2. **The in-app session** — a human *asking*. The model's tool calls execute
   server-side into consent-gated proposals that land through the same routes
   the UI would call; the model adds no authority (the user's confirm is the
   act).
3. **The MCP door** — a machine (an agent, a script, another Claude) speaking
   the Model Context Protocol to `POST /mcp`.

**The rule (INV-11):** all access interfaces, though they may differ
significantly in form, are **equally capable and gated by the same
authentication and authorization policies.** No door has private capability;
no door has a private policy.

## 2. Why parity holds by construction

The MCP server is a **transport wrapper**, not a second implementation:

- Its **tool catalog is generated from the live route table**
  (`Router.list()` → `server/mcp.ts`). A route added tomorrow is an MCP tool
  tomorrow; there is no second list to forget.
- Every `tools/call` **re-enters the router** over a synthetic request, so the
  full middleware wall — the auth gate's 401, identity resolution, tenancy
  404s, idempotency replay, capability 409s, rate limits — applies to an MCP
  caller exactly as to the web UI. `server/mcp.ts` contains **no authorization
  logic of its own**; if it ever grows some, INV-11 is broken.
- The parity test (`tests/mcp-parity.test.ts`) locks the bijection: every
  route is a tool **or** carries an argued exclusion, and nothing is excluded
  that isn't a real route.

The only non-tools are the stream-shaped routes (`GET /events`, the live turn
stream, the relay long-poll) — a tool call is request/response, so live
streams stay transport-specific *delivery* of state the tools can read. Each
exclusion carries its argument in `MCP_EXCLUDED`. The send-message tool
(`post_sessions_by_id_messages`) returns the reply stream as a parsed event
array, so the core loop is fully usable over MCP.

## 3. One credential, two transports

Authentication is the **same signed session token** the browser uses, over a
second transport:

- Browser: `POST /v1/auth/login` sets an HttpOnly cookie.
- Machine: `POST /v1/auth/login` with `"transport": "bearer"` returns
  `{ token, identity }` in the body (**no cookies** — the remembered-accounts
  stack is a browser concept). Present it as
  `Authorization: Bearer <token>`; `server/identity.ts` verifies it with the
  exact `verifySession` + account-registry path the cookie takes. A tampered
  token falls through to anonymous — never to a guess.

An unauthenticated MCP caller sees exactly what a signed-out browser sees:
the front door (`get_capabilities`, `get_me`, the auth tools) works; every
data tool answers the gate's 401.

One form note: calling `post_auth_login` *without* `transport: 'bearer'` runs
the browser (cookie) flow — the route behaves identically through every door
(that is the parity rule), but a tool result has no cookie jar, so the minted
session is unreachable to an MCP client. The initialize instructions steer
machine callers to the bearer transport; this is a form difference, not a
capability one.

## 4. Connecting

The endpoint is served at the conventional server root **`/mcp`** and at
`/api/v1/mcp` (same handler). Stateless Streamable HTTP: single JSON-RPC 2.0
messages per POST (`initialize`, `ping`, `tools/list`, `tools/call`); GET and
DELETE answer 405.

```bash
# 1. Sign in (any demo account — docs/demo-accounts.md):
curl -s http://127.0.0.1:8787/mcp -H 'Content-Type: application/json' -d '{
  "jsonrpc": "2.0", "id": 1, "method": "tools/call",
  "params": {"name": "post_auth_login", "arguments": {"body": {
    "email": "ada@acme.example", "password": "ada-demo-password", "transport": "bearer"}}}}'

# 2. Use the token on every later request:
curl -s http://127.0.0.1:8787/mcp -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" -d '{
  "jsonrpc": "2.0", "id": 2, "method": "tools/call",
  "params": {"name": "get_sessions", "arguments": {}}}'
```

For an MCP client (e.g. Claude Code): register a Streamable-HTTP server at
`http://127.0.0.1:8787/mcp` with an `Authorization: Bearer <token>` header.
Tool results are the JSON `{status, body}` of the underlying HTTP response.

## 5. Where the pieces live

| Piece | File | Locked by |
|---|---|---|
| The endpoint, tool generation, dispatch, exclusions | `server/mcp.ts` | `tests/mcp.test.ts`, `tests/mcp-parity.test.ts` |
| The enumerable route table | `server/http/router.ts` (`list()`) | `tests/mcp-parity.test.ts` |
| Bearer resolution of the session credential | `server/identity.ts` | `tests/auth-bearer.test.ts` |
| `transport: 'bearer'` minting | `server/routes/index.ts` (`mintSession`), `contract/api.ts` (`SessionTransport`, `BearerSession`) | `tests/auth-bearer.test.ts` |
| Gate + rate-limit postures for `/mcp` | `server/routes/index.ts` | `tests/mcp-parity.test.ts` |
| The root mount | `server/index.ts` | in-app (curl the running server) |
