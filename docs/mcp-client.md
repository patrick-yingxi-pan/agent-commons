# Outbound MCP connection work

The product's inbound MCP door is described in [mcp-access.md](mcp-access.md).
This document covers the separate client boundary for user-added external MCP
servers. The full connect → inspect → attach → approve → execute workflow is
not implemented yet. The private registry, strict persistence slice, and
read-only inspection transaction now exist as isolated boundaries; routes, UI,
desktop startup wiring, and release execution remain `unconfigured`.

## Implemented transport substrate

`server/mcpHttpTransport.ts` sends one bounded JSON-RPC POST and accepts one
correlated JSON or request-scoped SSE response. `server/outboundAddress.ts`
admits an explicit public-HTTPS or exact-literal-loopback scope. Public DNS is
resolved once, every returned address is checked, and the socket is pinned to
the admitted address while TLS retains the original hostname. Private,
link-local, reserved and transition addresses are excluded from public scope.
Arbitrary private-LAN access is not granted.
Certificate verification is explicitly required, including when the parent
environment disables Node's default verification.

Endpoints are limited to 2,048 characters; requests to 64 KiB; responses to
1 MiB; SSE events to 256 KiB; response headers to 16 KiB. The 10-second default
deadline includes DNS, connection and streaming (explicit internal overrides
are limited to 1–60,000 ms). Closing or timing out destroys the actual request
and response. Late DNS cannot start a new request. Redirects, environment proxy
agents, ambient cookies, compressed bodies, server-initiated requests and
automatic retries are not supported. Credentials are explicit write-only input;
errors contain fixed codes, not URLs, tokens, response text or raw exceptions.

After a request is submitted, a transport failure reports `mayHaveExecuted`.
This is conservative uncertainty, not proof of success or failure. The future
adapter must durably retain that uncertainty rather than blindly replaying a
write. An HTTP error cannot carry a successful tool result through this seam.
Explicit legacy-session cleanup uses a body-free DELETE to the same validated
endpoint; it cannot follow redirects or expand the destination scope.

Pure framing/address tests and real loopback HTTP/SSE/TLS tests cover this
substrate. The tests fixture only the remote peer; they do not demonstrate a
user connection, paid provider, third-party account, or completed integration.

## Implemented read-only discovery transaction

`server/mcpDiscovery.ts` inspects a configured endpoint in memory. Current
servers receive `server/discover` and paginated `tools/list` with per-request
metadata and mirrored method/version headers. Legacy-shaped HTTP refusals or an
explicitly advertised compatible version can select initialization-based
2025-11-25, 2025-06-18 or 2025-03-26 behavior. A recognizable modern error cannot
silently downgrade, even if its response id is invalid. Authentication and
network failures never trigger another handshake. Deprecated 2024 HTTP+SSE is
not adopted.

The entire transaction has one 30-second deadline (bounded internal overrides),
eight pages, 128 unique tools and a 512 KiB cumulative catalog budget. Duplicate
tools, cursor loops, oversized or malformed pages reject the complete catalog.
Legacy sessions are released after inspection when possible; the result reports
unconfirmed or server-managed cleanup without exposing the session credential.
Cancellation closes active I/O and never starts a later page.

`server/mcpCatalog.ts` snapshots and bounds presentation fields and schema JSON
(64 KiB, depth 32, 4,096 nodes per schema). It does **not** yet validate JSON
Schema dialect semantics or authorize calls. Remote instructions, icons, links,
`$ref` and tool annotations remain inert data. Extra protocol metadata is not
mistaken for an invalid tool definition. Real HTTP peer tests cover both eras.

`server/mcpConnections.ts` owns a tenant-scoped private registry and
`server/mcpConnectionInspector.ts` composes exact credential resolution,
bounded discovery, and revision-checked commit. The optional persisted slice
keeps endpoint and opaque credential references private, excludes raw secrets,
and strictly rejects malformed present state; generic Context setup cannot
grant these reserved identities. `desktop/mcpCredentialVault.mjs` and
`desktop/mcpCredentialProtocol.mjs` provide an isolated encrypted test/injected
cipher vault and bounded on-demand child channel with exact bindings. These
boundaries are tested without production main/preload/start wiring, native OS
Keychain acceptance, routes, picker, or model runtime integration.
The loopback integration test covers the composed credential/inspection path
with an injected peer; it is not third-party or end-user acceptance.

## Required next work

- Full schema validation and execution messages: discovery supports the
  [current metadata flow](https://modelcontextprotocol.io/specification/2026-07-28/server/discover)
  and [legacy initialization](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle),
  but is not a complete MCP client. JSON Schema 2020-12 validation, header
  parameter annotations, tool results and multi-round input handling remain.
- User-facing routes/UI and production desktop/hosted wiring for the tenant-owned
  endpoint, connection consent, secret lifecycle, reconnect/disconnect and
  revocation. The isolated registry, vault boundary and CAS inspector are not
  an end-user connection workflow or native OS Keychain acceptance.
- Bounded real tool discovery, stable identities and schemas, inspected by the
  user before attachment; remote descriptions and annotations remain untrusted.
- An approved tool policy and durable execution/uncertainty receipts shared by
  both model transports, later confirmation and unattended routines.
- Browser and packaged acceptance of the whole journey, including tenant walls,
  restart, secret exclusion, cancellation and failure recovery.

The owner has been asked whether all external calls should require approval
until explicit server trust. No answer has been inferred. MCP annotations and
tool names alone must not become the authority to execute a call.

Network mechanics follow [Node's HTTP request contract](https://nodejs.org/api/http.html#httprequesturl-options-callback).
Address exclusions were checked against the IANA [IPv4](https://www.iana.org/assignments/iana-ipv4-special-registry)
and [IPv6](https://www.iana.org/assignments/iana-ipv6-special-registry) special-purpose registries.
