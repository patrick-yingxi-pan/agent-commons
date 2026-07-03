/** ── Identity & tenancy resolution (design F2; P7: registry-backed) ──────────
 *  Resolves the current `Identity` for a request. Since P7 the directory behind
 *  resolution is the persisted ACCOUNT REGISTRY (server/accounts.ts) — users,
 *  tenants/workspaces, and memberships as store-owned entities the onboarding
 *  routes create — not a seeded constant. The seeds still exist (registry rows
 *  marked `seeded`), so the dev switcher, the demo, and the header-seam tests
 *  behave exactly as before.
 *
 *  Resolution order (multi-account P6):
 *    1. A VERIFIED session cookie — claims resolve STRICTLY against the
 *       registry: the user must exist and hold a membership for the tenant; a
 *       stale credential (deleted user, revoked membership) resolves to
 *       NOTHING and falls through — never to a guess. Role always comes from
 *       the membership, so a client can't self-elevate through its credential.
 *    2. The legacy header seam (`x-user-id`/`x-tenant-id`/`x-user-role`) —
 *       dev/tests only, gated by `IDENTITY_HEADERS` (`deny` = production
 *       posture). This path keeps its historical looseness ON PURPOSE (unknown
 *       tenants are synthesized as orgs; the cross-tenant tests lean on it) —
 *       the looseness is exactly what the flag turns off.
 *    3. The backend's default principal.
 *
 *  SECURITY NOTE: trusting `x-*` request headers for identity is a MOCK
 *  convenience, NOT the production trust mechanism (PD8: a verified IdP token).
 *
 *  MULTI-ACCOUNT IS UNIFORM (multi-account §5.6): every backend honours the
 *  seam and advertises a directory — the desktop switches WORKSPACES for its
 *  one device owner; the web switches org principals. With no override, each
 *  backend resolves exactly what it always did. */
import type { Capabilities, Identity, Tenant, TenantRole } from '../contract/index.ts'
import { SESSION_COOKIE, identityHeadersAllowed, parseCookies, verifySession } from './auth.ts'
import { accounts } from './accounts.ts'

type Headers = Record<string, string | string[] | undefined>
type Backend = Capabilities['backend']

/** The desktop / mock principal: one local user, one personal tenant, full rights. */
export const LOCAL_IDENTITY: Identity = {
  user: { id: 'user-local', name: 'You' },
  tenant: { id: 'tenant-personal', name: 'Personal', kind: 'personal' },
  role: 'owner',
  local: true,
}

/** The web backend's default principal (no claims, no headers): the seeded org owner. */
const WEB_DEFAULT = { userId: 'user-ada', tenantId: 'tenant-acme' }

/** Read a single header value (Node lower-cases header names; arrays take the first). */
function header(headers: Headers | undefined, name: string): string | undefined {
  const v = headers?.[name]
  return Array.isArray(v) ? v[0] : v
}

const isRole = (v: string | undefined): v is TenantRole =>
  v === 'owner' || v === 'admin' || v === 'member'

/** The DEV HEADER path's web resolution — registry-backed where the ids are
 *  known, historically loose where they aren't: an unknown user falls back to
 *  the default principal (the mock has no auth flow to 401), an unknown tenant
 *  is synthesized as an org (the cross-tenant suites lean on this). */
function webIdentityFromHeaders(userId?: string, tenantId?: string, roleOverride?: string): Identity {
  const user = (userId && accounts.users.get(userId)) || accounts.users.get(WEB_DEFAULT.userId)!
  const wantedTenant = tenantId ?? WEB_DEFAULT.tenantId
  const known = accounts.tenants.get(wantedTenant)
  const tenant: Tenant = known
    ? { id: known.id, name: known.name, kind: known.kind }
    : { id: wantedTenant, name: wantedTenant, kind: 'org' }
  const membership = accounts.membership(user.id, tenant.id)
  const role: TenantRole = isRole(roleOverride) ? roleOverride : membership?.role ?? 'member'
  return {
    user: { id: user.id, name: user.name, ...(user.email ? { email: user.email } : {}) },
    tenant,
    role,
    local: false,
  }
}

/** The DEV HEADER path's desktop resolution: the USER never changes (the
 *  loopback sidecar trusts its one device owner); the tenant switches the
 *  workspace — personal (default), a registry workspace, or a synthesized org
 *  for an unknown id (mirroring the web seam's looseness). */
function localIdentityFromHeaders(tenantId?: string, roleOverride?: string): Identity {
  if (!tenantId || tenantId === LOCAL_IDENTITY.tenant.id) return LOCAL_IDENTITY
  const known = accounts.tenants.get(tenantId)
  const tenant: Tenant = known ? { id: known.id, name: known.name, kind: known.kind } : { id: tenantId, name: tenantId, kind: 'org' }
  const membership = accounts.membership(LOCAL_IDENTITY.user.id, tenantId)
  const role: TenantRole = isRole(roleOverride) ? roleOverride : membership?.role ?? 'member'
  return { user: LOCAL_IDENTITY.user, tenant, role, local: true }
}

/** The current identity for a request — see the module header for the order.
 *  Each result is STAMPED with how it resolved (`via`, multi-account §12): only
 *  a verified credential reads as "signed in" — the auth gate and the account
 *  UI branch on this, never on heuristics. */
export function resolveIdentity(backend: Backend, headers?: Headers): Identity {
  const claims = verifySession(parseCookies(header(headers, 'cookie'))[SESSION_COOKIE])
  if (claims) {
    // STRICT: a verified credential must name a real user + membership. A stale
    // cookie (user deleted, membership revoked) falls through as if absent.
    const resolved = accounts.identityFor(claims.userId, claims.tenantId)
    if (resolved) return { ...resolved, via: 'session' }
  }
  if (identityHeadersAllowed()) {
    const userId = header(headers, 'x-user-id')
    const tenantId = header(headers, 'x-tenant-id')
    const role = header(headers, 'x-user-role')
    // The dev seam is only "in play" when a header actually asserts something —
    // a bare request still reads as the backend default.
    if (userId !== undefined || tenantId !== undefined || role !== undefined) {
      const viaHeaders =
        backend === 'remote' ? webIdentityFromHeaders(userId, tenantId, role) : localIdentityFromHeaders(tenantId, role)
      return { ...viaHeaders, via: 'headers' }
    }
  }
  return { ...(backend === 'remote' ? webIdentityFromHeaders() : LOCAL_IDENTITY), via: 'default' }
}

