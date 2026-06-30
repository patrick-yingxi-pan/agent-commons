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
}
