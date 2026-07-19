/** ── Contract: identity & tenancy ───────────────────────────────────────────
 *  Who is talking to the backend, and which isolation boundary they belong to.
 *  The two deployments differ only in how this is resolved (design F2):
 *    • Native desktop — a single local user in a single "personal" tenant; no auth.
 *    • Remote web     — a principal authenticated by the org's IdP (PD8: generic
 *      OIDC / bring-your-own IdP), scoped to that org's tenant (PD9: shared DB +
 *      Postgres row-level security).
 *  The UI reads `Identity` once on boot (design P1 §4: "Identity from /v1/me") to
 *  label the account and adapt org-only affordances; the server stays the gate. */

/** The isolation boundary. `personal` is the desktop N=1 case; `org` is a
 *  multi-user tenant on the web. */
export interface Tenant {
  id: string
  name: string
  kind: 'personal' | 'org'
}

/** A principal — the single local user (desktop) or an authenticated human (web). */
export interface User {
  id: string
  name: string
  /** Present on the web (from the IdP); omitted for the local desktop user. */
  email?: string
}

/** A user's role within their tenant. `owner` is the sole role on a personal
 *  tenant; `admin`/`member` differentiate on an org tenant (web RBAC). */
export type TenantRole = 'owner' | 'admin' | 'member'

/** The current principal + tenant + role — the body of `GET /v1/me`. */
export interface Identity {
  user: User
  tenant: Tenant
  role: TenantRole
  /** True on the desktop single-user deployment (no real auth); false on the
   *  multi-tenant web. The UI may read this to hide org-only surfaces, but the
   *  server is the authorization gate (it returns tenant-scoped data regardless). */
  local: boolean
  /** How this identity was resolved (multi-account §12) — a VERIFIED session
   *  credential (`'session'`), the dev header seam (`'headers'`), or the
   *  backend's default principal (`'default'`). Only `'session'` means "signed
   *  in"; the auth gate and the account UI branch on it. Optional so a mock or
   *  an older server may omit it (the UI then treats the identity as unsigned). */
  via?: IdentityVia
  /** True when this principal is an INSTANCE MAINTAINER (the `MAINTAINERS` env
   *  allowlist) — a single boolean capability, not a role (PD11 forbids a
   *  parallel RBAC engine). Stamped only on a verified resolution (`session`,
   *  or the dev header seam in tests) — never on the anonymous default.
   *  Absent = not a maintainer (INV-9 absence semantics); the UI hides the
   *  Maintain section, the server's `/admin/*` wall answers 404 regardless. */
  instanceAdmin?: boolean
}

/** The resolution path an `Identity` arrived by — see `Identity.via`. */
export type IdentityVia = 'session' | 'headers' | 'default'

/** ── FWD-5 Phase 1 — the acting PRINCIPAL (docs/design/principals-and-namespaces.md) ──
 *  The actor half of the actor/owner split: WHO performed an act — a signed-in human
 *  (`user`) or a bound worker Agent (`agent`) — distinct from the namespace that owns
 *  what was acted on (`tenantId`, read as the owner-namespace id). Orgs are namespaces,
 *  never principals: they own, they don't act. */
export type PrincipalKind = 'user' | 'agent'

/** A reference to the acting principal, stamped on act rows SERVER-SIDE (beside the
 *  raw-tenant authorization anchors, e.g. `postedByTenant`) and stripped at every
 *  public projection — only the `kind` crosses the wire (`postedByKind` etc.), the
 *  same redaction posture that keeps raw tenant ids private. Absent = unattributed:
 *  a row minted before Phase 1, or a foreign A2A actor (identified by `via`/
 *  `verifiedPeer`, D28 — a remote agent never gets a local principal id). */
export interface PrincipalRef {
  kind: PrincipalKind
  id: string
}

/** One row of `GET /v1/auth/accounts` — an account that signed in on THIS
 *  browser (carried by the signed account-stack cookie, multi-account §12), the
 *  way GitHub remembers signed-in accounts for its switcher. `tenant` is the
 *  account's LAST-ACTIVE workspace (a switch back lands where you left off).
 *  Stale entries (deleted user, revoked membership) are dropped server-side,
 *  never guessed. */
export interface AuthAccount {
  user: User
  tenant: Tenant
  role: TenantRole
  /** True for the account the current session credential resolves to. */
  current: boolean
}
