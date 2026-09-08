# Outbound MCP connection work

The product's inbound MCP door is described in [mcp-access.md](mcp-access.md).
This document covers the separate client boundary for user-added external MCP
servers. The full connect → inspect → attach → approve → execute workflow is
not implemented yet. Release execution remains `unconfigured`.

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

Pure framing/address tests and real loopback HTTP/SSE/TLS tests cover this
substrate. The tests fixture only the remote peer; they do not demonstrate a
user connection, paid provider, third-party account, or completed integration.

## Required next work

- Version negotiation and schemas: the [2026-07-28 transport revision](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
  changes sessions and metadata. The substrate is not a complete implementation
  of that revision or of the [legacy initialized transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports).
- A tenant-owned configured endpoint, connection consent, secret lifecycle,
  reconnect/disconnect and revocation, with desktop and hosted boundaries.
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
