/** ── Identity & tenancy resolution (design F2) ───────────────────────────────
 *  Resolves the current `Identity` for a request. The two deployments differ only
 *  here:
 *    • Native desktop / mock — a single local user in a single "personal" tenant;
 *      no auth (the loopback sidecar trusts its one local user).
 *    • Remote web — the principal an org's IdP authenticated (PD8: generic OIDC /
 *      bring-your-own IdP), scoped to that org's tenant (PD9). This prototype has no
 *      real IdP, so the web path reads the principal from request headers — the seam
 *      a verified token's claims would populate — over a small seeded org directory.
 *
 *  The users/tenants here are seeded/transient (like the live runner registry); in
 *  production they become persisted F1 entities. Resolution is a pure function of
 *  (backend, headers) so it's unit-testable without binding a port.
 *
 *  SECURITY NOTE: trusting `x-*` request headers for identity is a MOCK convenience,
 *  NOT the production trust mechanism. In a real web deployment the principal comes
 *  from a verified IdP token (PD8) at the edge — never from a client-settable header.
 *  These headers only do anything on the (itself-mocked) `remote` backend. */
import type { Capabilities, Identity, Tenant, TenantRole, User } from '../contract/index.ts'

type Headers = Record<string, string | string[] | undefined>
type Backend = Capabilities['backend']

/** The desktop / mock principal: one local user, one personal tenant, full rights. */
export const LOCAL_IDENTITY: Identity = {
  user: { id: 'user-local', name: 'You' },
  tenant: { id: 'tenant-personal', name: 'Personal', kind: 'personal' },
  role: 'owner',
  local: true,
}

/** A tiny seeded org directory standing in for the web IdP + tenant store. A real
 *  deployment resolves these from a verified token claim + the tenant table; here
 *  the request headers (`x-user-id`, `x-tenant-id`, `x-user-role`) select among them
 *  so the multi-tenant surface is exercisable. */
const WEB_TENANT: Tenant = { id: 'tenant-acme', name: 'Acme, Inc.', kind: 'org' }
const WEB_USERS: User[] = [
  { id: 'user-ada', name: 'Ada Lovelace', email: 'ada@acme.example' },
  { id: 'user-grace', name: 'Grace Hopper', email: 'grace@acme.example' },
]
const WEB_ROLES: Record<string, TenantRole> = { 'user-ada': 'owner', 'user-grace': 'member' }

/** Read a single header value (Node lower-cases header names; arrays take the first). */
function header(headers: Headers | undefined, name: string): string | undefined {
  const v = headers?.[name]
  return Array.isArray(v) ? v[0] : v
}

const isRole = (v: string | undefined): v is TenantRole =>
  v === 'owner' || v === 'admin' || v === 'member'

/** Resolve the web principal from the auth-claim seam (headers), defaulting to the
 *  first seeded user/tenant when unspecified. An unknown `x-user-id` falls back to
 *  the default user rather than 401 — the mock has no real auth flow to fail. */
function resolveWebIdentity(headers?: Headers): Identity {
  const userId = header(headers, 'x-user-id')
  const user = WEB_USERS.find((u) => u.id === userId) ?? WEB_USERS[0]
  const tenantId = header(headers, 'x-tenant-id')
  const tenant: Tenant =
    tenantId && tenantId !== WEB_TENANT.id ? { id: tenantId, name: tenantId, kind: 'org' } : WEB_TENANT
  const requested = header(headers, 'x-user-role')
  const role: TenantRole = isRole(requested) ? requested : WEB_ROLES[user.id] ?? 'member'
  return { user, tenant, role, local: false }
}

/** The current identity for a request. `backend` comes from `Capabilities.backend`
 *  (the store owns it): the remote web server resolves a tenant-scoped principal;
 *  the native sidecar / mock is the single local user. */
export function resolveIdentity(backend: Backend, headers?: Headers): Identity {
  return backend === 'remote' ? resolveWebIdentity(headers) : LOCAL_IDENTITY
}
