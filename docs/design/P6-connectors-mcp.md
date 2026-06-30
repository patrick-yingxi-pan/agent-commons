# P6 · Connectors & MCP

> **Pillar.** Real third-party integrations — an OAuth connector framework and real
> MCP server discovery/invocation — replacing the fixture catalogs (spec MOCK-3).
> Builds on [F5](F5-security-consent.md) (secrets/consent), [F2](F2-identity-tenancy.md)
> (per-tenant), [F4](F4-broker-runners.md) (runner for local MCP). Serves spec CTX-5.

## 1. Problem & scope

The prototype's connectors and MCP servers are static catalogs with fixture detail
(`server/data/contextOptions.ts` `CONNECTOR_OPTIONS`/`MCP_OPTIONS`,
`server/data/connectorDetails.ts`); attaching one creates a UI chip but no real
connection (spec MOCK-3). The *seams* are real, though: a `SavedContext.status`
(connected/needs-auth) and a `connector.status` event model an OAuth callback / token
expiry already. Production makes the integrations real. **Shared** model; local MCP
(stdio) runs via the desktop runner, remote MCP/connectors via the web server.

## 2. Design

### 2.1 Connector framework (OAuth)

- A **connector type** is an OAuth 2.0 integration (Drive, Slack, Notion, Linear,
  GitHub, …) with an adapter implementing a small interface: authorize, refresh, list
  resources, perform actions.
- **Auth** — authorization-code flow per (tenant, user, connector); the OAuth callback
  flips `SavedContext.status` to `connected` and broadcasts `connector.status` (the seam
  the prototype already has); token expiry/revocation flips it to `needs-auth`. Tokens
  live in the **secrets manager** (F5 PD26), per-tenant-encrypted, never on the contract.
- **Resources & actions** — the fixture `connectorDetail` becomes real API calls
  (Drive files, Slack channels, Linear issues). Reads surface as resources; writes
  surface as **authority-gated (PD24), consent-gated (PD43) tools** the model can call.
- **GitHub special case** — the repo↔GitHub-connector dependency is preserved (the
  prototype dedups the GitHub connector with a repo's remote): pushing/PRs require the
  connector.

### 2.2 MCP (real Model Context Protocol)

- **Discovery** — connect an MCP server, enumerate its tools + resources. **Transport:**
  stdio for local/desktop servers (launched + sandboxed by the **runner**, F4), HTTP+SSE
  for remote servers. Per-tenant server configs (command/URL + auth) in saved contexts +
  secrets.
- **Exposure to the model** — a connected server's tools are added to the Messages
  request's tool list (the prototype passes only the built-in resource tools today;
  production appends the attached MCP/connector tools), each call gated by authority +
  consent like any tool (P3).
- **Sandboxing** — an MCP server is third-party code; the runner runs it with least
  privilege (its own scope grant, D3), resource limits, and timeouts; its outputs are
  untrusted content (F5 PD25).

### 2.3 Attachment & mediation

A connector/MCP attached to a session is a `SessionContext` (type connector/mcp, scope
= the account/scope); its effects are mediated (D5) and authority-clamped to the project
(D12). The Contexts page manages set-up (the prototype's saved-contexts), reusable
across sessions without re-auth.

## 3. Failure modes & edge cases

- **Token expired/revoked** — `needs-auth` state + `connector.status` event; the UI
  prompts re-auth; in-flight calls fail closed.
- **OAuth callback failure / denied scope** — surfaced; the connector stays
  needs-auth; minimal-scope re-request.
- **Connector API rate limit / outage** — backoff + retry (the gateway pattern, P5);
  surfaced as a transient tool error.
- **MCP server crash / hang / misbehavior** — runner sandbox + timeouts isolate it;
  a malicious tool is contained by authority + consent (it can't exceed granted reach).
- **Connector removed with live attachments** — graceful "no longer available" (F1 PD7).

## 4. Security & multi-tenancy

OAuth tokens + MCP creds in KMS, per-tenant (F5); minimal OAuth scopes; MCP servers
sandboxed + scope-bounded (D3); connector writes consent-gated (PD43); all connector/MCP
effects authority-clamped (PD24), tenant-isolated (F2), and audited (F5 PD27). MCP output
is untrusted content (F5 PD25).

## 5. Observability & ops

Per-connector auth success/refresh/expiry rates; connector API latency + error/rate-
limit hits; MCP server health (up/down, restart count, sandbox violations); tool-call
volume per connector/MCP. Alert on auth-failure spikes + sandbox violations.

## 6. Open questions & decisions

See [`DECISIONS.md`](DECISIONS.md): **PD56** (connector framework = OAuth2 per provider
via adapters; tokens in KMS per (tenant,user,connector); status driven by the existing
`connector.status` seam), **PD57** (connector resources surface as authority- + consent-
gated tools; the GitHub↔repo dependency preserved), **PD58** (real MCP: stdio via the
runner on desktop / HTTP+SSE remote, sandboxed + scope-bounded; discovered tools added
to the model tool list), **PD59** (connector/MCP attach = `SessionContext` with account
scope, mediated + project-clamped; reusable from the Contexts page).
