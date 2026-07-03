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
 *
 *  MULTI-ACCOUNT IS UNIFORM (multi-account §5.6, revised): every backend honours
 *  the identity seam and advertises a directory, so the account switcher is the
 *  same UI everywhere — what differs is only WHAT switches, matching each
 *  deployment's reality: on the desktop the USER is fixed (the device owner) and
 *  the WORKSPACE/tenant switches (personal ↔ work org, like the desktop app's
 *  account menu); on the web the org directory's principals switch. With no
 *  override headers, each backend resolves exactly what it always did. */
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

/** The desktop's second seeded workspace — the same local user acting in a work
 *  org (the desktop app's personal ↔ work account menu, in miniature). */
const LOCAL_WORK_TENANT: Tenant = { id: 'tenant-work', name: 'Acme (work)', kind: 'org' }

/** Resolve the desktop/mock principal. The USER never changes (the loopback
 *  sidecar trusts its one local user — `x-user-id` is deliberately ignored);
 *  `x-tenant-id` switches the WORKSPACE: absent/personal → the personal tenant
 *  (byte-identical to the pre-multi-account behavior), the seeded work org, or
 *  a synthesized org for an unknown id (mirroring the web seam). */
function resolveLocalIdentity(headers?: Headers): Identity {
  const tenantId = header(headers, 'x-tenant-id')
  if (!tenantId || tenantId === LOCAL_IDENTITY.tenant.id) return LOCAL_IDENTITY
  const tenant: Tenant = tenantId === LOCAL_WORK_TENANT.id ? LOCAL_WORK_TENANT : { id: tenantId, name: tenantId, kind: 'org' }
  const requested = header(headers, 'x-user-role')
  // In an org workspace the device owner is a member unless the seam says otherwise.
  const role: TenantRole = isRole(requested) ? requested : 'member'
  return { user: LOCAL_IDENTITY.user, tenant, role, local: true }
}

/** The current identity for a request. `backend` comes from `Capabilities.backend`
 *  (the store owns it): the remote web server resolves a tenant-scoped principal
 *  from the org directory; the native sidecar / mock resolves the single local
 *  user in a switchable workspace. */
export function resolveIdentity(backend: Backend, headers?: Headers): Identity {
  return backend === 'remote' ? resolveWebIdentity(headers) : resolveLocalIdentity(headers)
}

/** The seeded accounts the switcher may act as (`GET /v1/identities`, §5.6) —
 *  exactly the directory the backend's resolver accepts, nothing more. Remote:
 *  the org principals (plus the cross-tenant identity the P8 cooperation flows
 *  exercise). Native/mock: the local user's workspaces. */
export function listIdentities(backend: Backend): Array<{ userId: string; userLabel: string; tenantId: string; tenantLabel: string; role: string }> {
  if (backend !== 'remote') {
    const u = LOCAL_IDENTITY.user
    return [
      { userId: u.id, userLabel: u.name, tenantId: LOCAL_IDENTITY.tenant.id, tenantLabel: LOCAL_IDENTITY.tenant.name, role: LOCAL_IDENTITY.role },
      { userId: u.id, userLabel: u.name, tenantId: LOCAL_WORK_TENANT.id, tenantLabel: LOCAL_WORK_TENANT.name, role: 'member' },
    ]
  }
  const acme = WEB_USERS.map((u) => ({
    userId: u.id,
    userLabel: u.name,
    tenantId: WEB_TENANT.id,
    tenantLabel: WEB_TENANT.name,
    role: WEB_ROLES[u.id] ?? 'member',
  }))
  // The second seeded tenant (the co-authoring E2E's "Bo"): grace acting under
  // tenant-beta — the header seam synthesizes unknown tenant ids as orgs.
  return [...acme, { userId: 'user-grace', userLabel: 'Grace Hopper', tenantId: 'tenant-beta', tenantLabel: 'tenant-beta', role: 'member' }]
}
