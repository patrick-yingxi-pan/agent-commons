/** ── Identity & tenancy resolution (design F2; P7: registry-backed) ──────────
 *  Resolves the current `Identity` for a request. Since P7 the directory behind
 *  resolution is the persisted ACCOUNT REGISTRY (server/accounts.ts) — users,
 *  tenants/workspaces, and memberships as store-owned entities the onboarding
 *  routes create — not a seeded constant. The seeds still exist (registry rows
 *  marked `seeded`), so the dev switcher, the demo, and the header-seam tests
 *  behave exactly as before.
 *
 *  Resolution order (multi-account P6):
 *    1. A VERIFIED session credential — the cookie first, else the SAME token
 *       as `Authorization: Bearer` (the machine transport; access-parity
 *       INV-11) — claims resolve STRICTLY against the
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
import type { Capabilities, Identity, PrincipalRef, Tenant, TenantRole } from '../contract/index.ts'
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

/** The web backend's default principal (no claims, no headers): Ada, in her own
 *  namespace (the seeds are person namespaces wearing their people's names). */
const WEB_DEFAULT = { userId: 'user-ada', tenantId: 'tenant-acme' }

/** The signed-out face when the AUTH GATE applies (multi-account §12, hardened):
 *  a principal that exists in NO registry and owns NOTHING — `rowVisibleTo`,
 *  `seedVisibleTo`, `seatIn`, and every wall answer empty/false for it by
 *  construction, so even the routes the gate leaves open (`/me`, the identity
 *  echo) name nobody. The backend default (Ada / the local user) is what a
 *  request resolves to only when the gate is OFF — pre-sign-in must never read
 *  as somebody's populated world. Defense-in-depth beneath the router's 401
 *  wall (routes/index.ts), not a substitute for it. */
export const ANONYMOUS_IDENTITY: Identity = {
  user: { id: 'user-anonymous', name: 'Guest' },
  tenant: { id: 'tenant-anonymous', name: 'Guest', kind: 'personal' },
  role: 'member',
  local: false,
}

/** ── The maintainer grant (contract `Identity.instanceAdmin`) ────────────────
 *  A SINGLE boolean capability, allowlisted by env (`MAINTAINERS` — comma-
 *  separated user ids or emails), never a role (PD11 forbids a parallel RBAC
 *  engine) and never persisted (no escalation surface to administer). Granted
 *  only on VERIFIED resolutions — the session path, and the dev header seam
 *  where tests already impersonate — never on the anonymous default, so an
 *  unset gate can't make a drive-by boot a maintainer. Read per-call (not
 *  cached at module load) so tests can flip the env var.
 *
 *  EMAIL entries grant only to SEEDED accounts (the code-owned demo roster,
 *  whose addresses nobody can register): signup is open and unverified, so an
 *  email listed before anyone bears it would otherwise be CLAIMABLE — sign up
 *  as `ops@example.com` and inherit the console. A runtime-created maintainer
 *  is therefore listed by user id (assigned by the server, never claimable). */
function isMaintainer(user: { id: string; email?: string }): boolean {
  const raw = process.env.MAINTAINERS
  if (!raw) return false
  const listed = raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  if (listed.includes(user.id.toLowerCase())) return true
  const seeded = !!accounts.users.get(user.id)?.seeded
  return seeded && !!user.email && listed.includes(user.email.toLowerCase())
}

/** Stamp the grant onto a resolved identity — absent (not `false`) when the
 *  principal is not a maintainer, per the contract's absence semantics. */
function withMaintainerGrant(identity: Identity): Identity {
  return isMaintainer(identity.user) ? { ...identity, instanceAdmin: true } : identity
}

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

/** The SAME session credential, carried as a bearer header instead of the
 *  cookie (access-parity INV-11): machine callers — the MCP door, scripts —
 *  authenticate with `Authorization: Bearer <session-token>`, verified by the
 *  exact `verifySession` + registry resolution the browser cookie goes
 *  through. One credential format, one policy, two transports. Non-session
 *  bearers that legitimately ride the same header on machine edges (the
 *  relay's `rv_live_…` rendezvous secret, runner enroll tokens, A2A peer
 *  credentials) fail the HMAC and fall through unchanged — those routes keep
 *  their own auth. */
function bearerSessionToken(headers?: Headers): string | undefined {
  const authz = header(headers, 'authorization')
  return authz ? /^Bearer\s+(.+)$/i.exec(authz)?.[1] : undefined
}

/** The current identity for a request — see the module header for the order.
 *  Each result is STAMPED with how it resolved (`via`, multi-account §12): only
 *  a verified credential reads as "signed in" — the auth gate and the account
 *  UI branch on this, never on heuristics. */
export function resolveIdentity(backend: Backend, headers?: Headers): Identity {
  const claims =
    verifySession(parseCookies(header(headers, 'cookie'))[SESSION_COOKIE]) ??
    verifySession(bearerSessionToken(headers))
  // A jti-carrying token (a registry-backed bearer mint) is live only while its
  // registry row exists — REVOCATION: the signature still verifies, but a
  // revoked row makes the credential fall through as if absent (never to a
  // guess), same as a deleted user. Cookie sessions carry no jti.
  if (claims && (!claims.jti || accounts.apiTokenLive(claims.userId, claims.jti))) {
    // STRICT: a verified credential must name a real user + membership. A stale
    // cookie (user deleted, membership revoked) falls through as if absent.
    const resolved = accounts.identityFor(claims.userId, claims.tenantId)
    if (resolved) return withMaintainerGrant({ ...resolved, via: 'session' })
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
      return withMaintainerGrant({ ...viaHeaders, via: 'headers' })
    }
  }
  return { ...(backend === 'remote' ? webIdentityFromHeaders() : LOCAL_IDENTITY), via: 'default' }
}

/** The acting principal behind a resolved identity (FWD-5 Phase 1): a native route's
 *  caller is always a HUMAN principal — the signed-in (or dev-seam / default) user.
 *  Agent principals are stamped where agents act (standing dispatch, D19); foreign
 *  A2A actors get NO local principal (they're attributed by `verifiedPeer`, D28). */
export function userPrincipal(identity: Identity): PrincipalRef {
  return { kind: 'user', id: identity.user.id }
}

