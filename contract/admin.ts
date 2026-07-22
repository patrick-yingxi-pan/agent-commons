/** ── Contract: the maintainer console (instance administration) ──────────────
 *  Wire shapes for `/v1/admin/*` — the INTERNAL tool for website maintainers.
 *  Instance-level (cross-tenant) reads plus a deliberately small mutation set
 *  (revoke token, revoke invite, deactivate account). Every route hides behind
 *  the maintainer wall (404 to non-maintainers — existence-hiding, the same
 *  posture as foreign-row 404s), and none of these rows ever carries a
 *  credential field: the registry's scrypt material never leaves its module. */
import type { Tenant, TenantRole, User } from './identity.ts'
import type { OrgInviteRow } from './orgs.ts'
import type { ApiToken } from './api.ts'

/** One account row of `GET /v1/admin/users` — the user plus the operational
 *  facts a maintainer triages by. Never credential material. */
export interface AdminUserRow {
  user: User
  /** Shipped demo/seed account — protected from deactivation (409). */
  seeded: boolean
  /** Sign-in disabled by a maintainer: credential stripped, tokens revoked.
   *  Absent = active (INV-9). */
  deactivated?: boolean
  /** The user's own namespace (their exactly-one `home` membership), when it
   *  exists — the desktop local user is the one row without one. */
  homeTenant?: Tenant
  /** Org seats beyond the home namespace. */
  orgSeats: { tenant: Tenant; role: TenantRole }[]
  /** Live API-token rows in the user's registry (metadata count only). */
  tokenCount: number
}

/** One tenant row of `GET /v1/admin/tenants`. */
export interface AdminTenantRow {
  tenant: Tenant
  /** Member count (1 for personal namespaces; seats for orgs). */
  members: number
  seeded: boolean
  /** True when the tenant is somebody's HOME namespace (FWD-6): a seed world
   *  like Acme is `kind: 'org'` yet still one person's namespace — `kind`
   *  alone cannot tell a shared org from an org-shaped namespace, and the
   *  console's Organizations surface must list only the former. */
  namespace: boolean
}

/** One invite row of `GET /v1/admin/invites` — the org-side row plus which org
 *  it belongs to (the instance view crosses orgs). */
export interface AdminInviteRow extends OrgInviteRow {
  orgId: string
  orgName: string
}

/** One bearer-token registry row of `GET /v1/admin/tokens` — the per-user
 *  `ApiToken` metadata plus its owner (the instance view crosses users).
 *  Metadata ONLY, as everywhere: the token value existed once, at mint. */
export interface AdminTokenRow extends ApiToken {
  userId: string
  userName: string
}

/** Body of `GET /v1/admin/ops` — the ops face as ONE JSON document, derived
 *  from the same sources `/metrics` renders (a shared snapshot, so the two
 *  cannot drift). Counts are cumulative since boot unless noted. */
export interface OpsSummary {
  /** Seconds since the server booted. */
  uptimeSeconds: number
  /** The persistence epoch (bumps on restore) — mirrors the `/metrics` gauge.
   *  A STRING id (`e{base36}{base36}`), not a count: it is compared for change,
   *  never ordered or subtracted. Declared `number` until 2026-07-22, while the
   *  route shipped the string — the same field is `string` in
   *  `contract/api.ts`'s liveness face, so the contract contradicted itself and
   *  a consumer typed against this one would have mishandled it. Found by
   *  typechecking `server/` (FWD-8). */
  epoch: string
  /** Which backend variant is serving (`native` | `remote`). */
  backend: string
  /** True once a shutdown began (readyz would 503). */
  draining: boolean
  /** Live runner registry, bucketed by status (transient — not persisted). */
  runnersByStatus: Record<string, number>
  /** Dispatch runs bucketed by status. */
  dispatchByStatus: Record<string, number>
  /** Model turns bucketed by outcome. */
  turnsByOutcome: Record<string, number>
  /** HTTP requests served, bucketed by method. */
  requestsByMethod: Record<string, number>
}
