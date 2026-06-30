# F2 · Identity, auth & multi-tenancy

> **Foundation.** Who the principals are, how they authenticate, and how one shared
> backend keeps tenants isolated — the wall every other doc assumes. Serves spec
> PORT-1..7, COMMONS-2, and the `tenant_id` keying introduced in [F1](F1-domain-model.md).

## 1. Problem & scope

The prototype has **no identity**: a single implicit user, no auth on the API (the
"one door to the backend", `src/api/client.ts`, sends no credentials), and an
in-memory single-tenant store (`server/store.ts`). Production needs principals,
authentication, authorization, and — for the web deployment — hard tenant isolation.

**Shared vs deployment-specific** is the crux here:

- **Desktop sidecar** — single local user, no remote login. The sidecar binds
  loopback (INV-3, `127.0.0.1`) and trusts the local OS user; `tenant_id` is a fixed
  local constant. Identity is "you, on this machine."
- **Web server** — many users in many orgs; real login, RBAC, and isolation. `tenant_id`
  = org, on every row and every query.

The contract and UI are identical; only the auth provider behind `client.ts` and the
isolation enforcement behind the data layer differ.

## 2. Design

### 2.1 Principals & roles

| Concept | Shape | Notes |
|---------|-------|-------|
| `user` | id, email, display name, auth identities | A person. Desktop: one implicit local user. |
| `org` (**tenant**) | id, name, plan | The isolation boundary; `tenant_id` everywhere (F1 PD3). Desktop: a single local org. |
| `membership` | user_id, org_id, role ∈ {owner, admin, member} | A user can belong to several orgs; the active org scopes the session. |
| `project_role` | reuse `ProjectRole` (`contract/roles.ts`, D14) | Already in the model — reader/writer/etc. govern intra-org access to a shared Project. |

Org-level RBAC (membership role) gates org administration (billing, members,
providers); **resource access reuses the existing authority machinery** — the D8
attenuation cascade (`contract/authority.ts`) and D12 Project-clamped reach
(`contract/commission.ts`), so we don't invent a parallel permission system.

### 2.2 Authentication

- **Web** — OIDC / OAuth 2.0 (Google Workspace, Okta, etc.) → a short-lived access
  token + refresh token; browser uses an httpOnly session cookie (CSRF-protected) or a
  bearer token. `client.ts` gains an auth header / credentialed fetch; nothing else in
  the UI changes (still one door). A `GET /v1/me` returns the authenticated user +
  active org + memberships (the UI reads identity from it, as it already reads
  `GET /v1/capabilities`).
- **Desktop** — no remote auth. The app shell hands the sidecar a per-launch loopback
  token (so only the local app, not other localhost processes, can call it); `/v1/me`
  returns the local user. If the desktop later signs in to sync with the web tenant,
  that's an OIDC link on top (cross-ref [F6](F6-persistence-ops.md) sync).
- **Programmatic / runners** — scoped enrollment tokens, not user credentials (F4).

### 2.3 Tenant isolation (web)

The wall is enforced **below** the route handlers, not per-call, so a forgotten
filter can't leak:

- Every query carries `tenant_id`, applied by the data-access layer (e.g. Postgres
  **row-level security** keyed on a `current_tenant` session var, or a mandatory
  tenant scope in the repository layer). Default-deny.
- The **SSE ambient stream** (`/events`, `src/api/events.ts`) is partitioned per
  `(tenant, user)` channel — a client only ever receives its tenant's events.
- Caches (`src/api/cache.ts` keys, any server cache) are namespaced by tenant.
- The **runner registry** and **resource guardian** are tenant-scoped — a runner
  belongs to a user/org; one tenant can't address another's hosts or reservations.
- Cross-tenant access attempts fail closed **and** record an `audit_entry` (F1) — a
  security signal, mirroring how the prototype audits denied cross-user effects (D15).

### 2.4 Multi-user within a tenant

A session/project is owned by a user but shareable within the org; visibility +
edit rights follow the relation graph + `ProjectRole`. Concurrent contributors on a
shared Project are coordinated by the existing sub-goal reservation/guardian (D11,
[F4](F4-broker-runners.md)). This is the production realization of the Agent Commons
multi-principal model — the prototype already encodes the authority/role/coordination
primitives; F2 supplies the *human* identities they attach to.

### 2.5 Sequence — an authenticated request (web)

1. UI calls `/v1/…` with the session cookie/bearer (client.ts).
2. Edge authn middleware validates the token → resolves `(user, org, role)`.
3. The data layer sets `current_tenant = org` (RLS) for the connection.
4. The handler runs tenant-scoped; authority checks (D8/D12) apply for agent-driven effects.
5. Mutations emit events onto the `(tenant, user)` SSE channel.

## 3. Failure modes & edge cases

- **Token expiry mid-stream** — SSE connection drops on 401; client silently
  re-auths (refresh token) and reconnects with `Last-Event-ID` ([F3](F3-contract-sync.md)).
- **Revoked access / offboarding** — membership removal takes effect on next request
  (short token TTL bounds the window); active sessions are invalidated.
- **Cross-tenant id guess** — a request naming another tenant's id resolves to
  not-found under RLS (no existence leak) + an audit entry.
- **Org deletion** — soft-delete cascade (F1 PD7); a grace/export window before purge.
- **Desktop, no network** — fully functional; auth is local; sync (if enabled) resumes
  when online.

## 4. Security & multi-tenancy

This doc *is* a security pillar; see [F5](F5-security-consent.md) for secrets, the
consent boundary, and prompt-injection. Key stances: short-lived tokens; isolation at
the data layer (not the app layer); default-deny cross-tenant; least privilege via the
authority cascade; the loopback token so the desktop sidecar isn't open to other local
processes.

## 5. Observability & ops

- Login success/failure rates; token refresh rate; **cross-tenant denial count**
  (should be ~0 — a spike is an attack or a bug); active sessions per tenant; per-org
  membership/role changes (audited).
- Offboarding runbook; key-rotation for signing secrets; SSO connection health.

## 6. Open questions & decisions

See [`DECISIONS.md`](DECISIONS.md): **PD8** (OIDC for web, loopback-trust for desktop),
**PD9** (org = tenant boundary, isolation enforced at the data layer / RLS), **PD10**
(`/v1/me` + a credentialed `client.ts`; the one door stays one door, now
authenticated), **PD11** (reuse the D8 authority cascade + `ProjectRole` for resource
access; org-role RBAC only for org admin), **PD12** (runner identity bound to a
user/org via scoped enrollment tokens — detailed in F4).
