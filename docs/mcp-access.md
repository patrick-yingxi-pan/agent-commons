# The MCP door — the third access method, and the access-parity rule

> **What this document is.** The from-zero explainer of how this product is
> reachable **as an MCP server**, and of the rule that governs *all* of its
> access methods. Requirement rows: PORT-9
> ([`spec/05-portable-contract.md`](spec/05-portable-contract.md)) and INV-11
> ([`spec/09-design-invariants.md`](spec/09-design-invariants.md)). Locks:
> `tests/access-surface-parity.test.ts`, `server/mcp.test.ts`,
> `server/mcp-parity.test.ts`, `server/model/api-tools.test.ts`, and
> `server/routes/auth-bearer.test.ts`.

## 1. The three access methods

The same product is reachable three ways, and they deliberately differ in
**form** only:

1. **The browser UI** — a human clicking. The UI is a client of the HTTP API
   (`/api/v1/*`) and holds no capability of its own.
2. **The permitted in-app session** — a human *asking*. Its model receives the
   route-derived `api__…` tool projection (spec MODEL-25): reads execute
   immediately *as the sending user* and land as provenance rows; mutations
   become consent cards executed — through the same router, as the confirmer
   — only on the user's click. Recursive conversation and self-consent acts are
   intrinsic host controls, not tools the model can call on itself.
3. **The authenticated remote MCP session** — a machine (an agent, a script,
   another Claude) speaking the Model Context Protocol to `POST /mcp` with the
   same signed identity credential over bearer transport.

**The rule (INV-11):** all access interfaces, though they may differ
significantly in form, are **equally capable and gated by the same
authentication and authorization policies.** No door has private capability;
no door has a private policy.

## 2. Why parity holds by construction

The route table owns the shared capability model. Every route is classified
at registration:

- **Product** is the default. It names an authenticated semantic capability
  and is projected into the UI, the permitted in-app session, and remote MCP.
- **Alias** means another route shape is only a projection of an existing
  semantic capability (for example list and by-id reads). It must name the
  capability and explain the equivalence beside the route.
- **Session-intrinsic** means the in-app host already realizes the capability;
  exposing it recursively as a model tool would allow self-prompting or
  self-consent. It also carries a reason beside the route.
- **Form** is protocol, credential, or viewer-presentation ceremony rather than
  an authenticated workspace capability: sign-in, browser account stacking,
  streams, health probes, runner callbacks, the MCP endpoint itself, and a
  person's private panel chrome. A form must explain itself. UI-presented forms
  and remote authentication bootstrap are marked explicitly; neither is allowed
  to hide a product operation. Presentation form may change only the reader's
  view—never the shared resource or what an agent can do within it.

The projections are then mechanical:

- `server/mcp.ts` generates the remote tool catalog from product routes plus
  the declared remote authentication bootstrap forms.
- `server/model/apiTools.ts` generates in-session tools from product routes,
  with route-declared intrinsic capabilities supplied by the host.
- `tests/access-surface-parity.test.ts` derives the shipped UI surface from
  real `paths.*` calls through the API funnel and follows imports to actual
  component/controller consumers. An unused wrapper cannot pretend the UI can
  do something.

The lock compares all three **semantic capability sets in both directions**.
It also rejects a UI-used product operation reclassified as an undeclared
form, and requires reasons for every alias, form, and intrinsic realization.
This closes the old failure mode: the previous route↔remote-tool test never
derived the UI and allowed private exclusion maps, so a UI-only maintainer
surface could be omitted from both MCP catalogs while every test stayed green.

Finally, every machine call **re-enters the router**, so the auth gate,
identity, tenancy 404s, maintainer wall, idempotency, capability 409s, and rate
limits are the same policies as the UI. Form may differ; capability and policy
may not. The send-message remote tool parses its finite reply stream into an
event array, while open-ended push remains a transport form.

## 3. Credentials follow the deployment posture

The hosted service uses one signed session credential over two transports. The
desktop release deliberately does not manufacture a session token for its
credential-less device owner: a machine client on that device connects directly
to the loopback endpoint without an `Authorization` header. Browser requests
remain pinned to the desktop app's exact Origin, so this convenience does not
turn an arbitrary webpage into the local principal. The Contexts panel and MCP
`initialize` instructions derive the same posture: local desktop offers a
credential-free client config; hosted offers sign-in and token mint/revoke.

### Hosted: one credential, two transports

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
`/api/v1/mcp` (same handler). Streamable HTTP: single JSON-RPC 2.0 messages
per POST (`initialize`, `ping`, `tools/*`, `resources/*`, `prompts/*`).

**Keeping this door in sync with the UI** (owner directive, 2026-08-09):
generation handles the tools — the catalog comes from the route table, so a
new route is a new tool and a UI change that adds *no* route needs no new tool
(minting an endpoint per affordance would be drift, not parity). The
hand-written seam is the door's `initialize` **instructions**, which point
machine callers at places in the human UI. Every UI string they quote lives in
`MCP_UI_COPY` (`server/mcp.ts`) and is scanned against the live components by
`server/mcp-ui-sync.test.ts` — earned the day an identity-copy pass renamed the
panel below and left this door naming the old words, with every suite green.

**The one-click path:** the Contexts page's **"This account is an MCP
server"** panel always shows the endpoint and a copy-ready `mcpServers` JSON
block. On desktop the block needs no credential. On hosted deployments the
panel mints an optionally labeled access token for the signed-in user
(`POST /auth/token`, strictly session-verified; shown once) and wires it into
the block. This is the generic shape MCP clients accept; the UI deliberately
prescribes no harness-specific install command (the design lesson is locked by
`server/routes/connector-serve.test.ts`).

**Token lifecycle:** every bearer mint is **registry-backed** (`jti` claim →
an `ApiToken` row, `server/accounts.ts`): `GET /auth/tokens` lists your rows
(metadata only — the value shows once), `DELETE /auth/tokens/:id` **revokes**
— the registry, not the signature, keeps a token alive, so revocation is
immediate. The panel lists your active tokens with one-click revoke. Rows are
capped per user (oldest evicted = revoked); rows persist, so revocation
survives a restart.

**The core toolset:** connecting with **`?toolset=core`** on the endpoint URL
narrows `tools/list` to a curated ~25-tool everyday subset (sessions +
messages, projects/artifacts, schedules, search/usage/notifications) so an AI
client's tool context stays small — strictly a presentation choice:
`tools/call` accepts the **full** catalog on either URL (capability and
policy never vary by toolset; the wall is auth, not the list).

**Self-describing tools:** every tool carries mechanical **annotations**
(`readOnlyHint` ⇔ GET, `destructiveHint` ⇔ DELETE, `openWorldHint: false`),
and the common mutations carry a **curated body example** in their input
schema (`properties.body.examples`, from `API_BODY_EXAMPLES` in
`server/apiSurface.ts` — shared with the in-app leg's generated tools), so a
model sees one valid payload instead of guessing shapes off refusals. The
routes stay the validation authority; a malformed body is refused, never
guessed at (INV-9).

**Sessions and live push:** `initialize` returns an `Mcp-Session-Id` header
(POSTs work without it — it's only required where state lives). `GET /mcp`
with the id opens the server→client SSE stream: it refuses anonymous callers
with 401 while the auth gate is on (the stream is served directly, so
`server/mcp.ts` applies the wall itself), and every account event visible
to your tenant (the same gate as `GET /events`) arrives as a
`notifications/message` frame (`logger: "workspace.events"`), and resources
you `resources/subscribe`d signal coarse `notifications/resources/updated`
hints — re-read on hint, exactly like the UI's cache. `DELETE /mcp` ends the
session.

**Resources & prompts:** parameterless reads are static resources
(`workspace://sessions`, `workspace://usage`, …), parameterized reads are
templates (`workspace://sessions/{id}`); prompts mirror the system-prompt
library. All of it reads through the router with your credential.

**Origin pinning:** a deployment that sets `CORS_ORIGIN` refuses mismatched
browser `Origin`s with 403 at the shared HTTP boundary—ordinary API routes,
preflight, static/UI requests, and every `/mcp` method share the MCP spec's
DNS-rebinding posture. Non-browser clients send no Origin and are unaffected.

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
| The endpoint, remote tool projection, and dispatch | `server/mcp.ts` | `server/mcp.test.ts`, `server/mcp-parity.test.ts` |
| Route-owned capability/form/alias/intrinsic metadata | `server/http/router.ts` (`RouteAccess`, `list()`), `server/routes/index.ts` | `tests/access-surface-parity.test.ts` |
| Reachable UI capability derivation | `src/api/keys.ts`, `src/api/hooks.ts`, `src/api/commands.ts` | `tests/access-surface-parity.test.ts` |
| In-session generated tool projection | `server/model/apiTools.ts` | `tests/access-surface-parity.test.ts`, `server/model/api-tools.test.ts` |
| Bearer resolution of the session credential | `server/identity.ts` | `server/routes/auth-bearer.test.ts` |
| `transport: 'bearer'` minting | `server/routes/index.ts` (`mintSession`), `contract/api.ts` (`SessionTransport`, `BearerSession`) | `server/routes/auth-bearer.test.ts` |
| Gate + rate-limit postures for `/mcp` | `server/routes/index.ts` | `server/mcp-parity.test.ts` |
| The root mount | `server/index.ts` | in-app (curl the running server) |
| The core toolset + tool annotations + body examples | `server/mcp.ts` (`MCP_CORE_TOOLS`), `server/apiSurface.ts` (`API_BODY_EXAMPLES`) | `server/mcp.test.ts` |
| The token registry (mint / list / revoke) | `server/accounts.ts`, `server/routes/index.ts` (`/auth/token`, `/auth/tokens`), `server/identity.ts` (jti check) | `server/routes/auth-bearer.test.ts` |
| The connect panel (mint, revoke, client snippets) | `src/components/SectionView.tsx` (`McpAccessCard`) | in-app (verified in preview) |
