/** ── The account registry (multi-account P7 — real, persisted accounts) ──────
 *  Users, tenants (workspaces), and memberships as STORE-OWNED entities, replacing
 *  the seeded constants that used to live in server/identity.ts. The seeds are
 *  still here — loaded on first boot and marked `seeded`, so every existing flow
 *  (the demo, the dev switcher, the co-authoring E2E's header identities) works
 *  unchanged — but around them real accounts can now be CREATED (onboarding),
 *  hold a credential (scrypt — node:crypto, no new dependency), and persist
 *  across restarts (additive slices in server/persistence/format.ts).
 *
 *  A LEAF module (contract + node:crypto only — like data/providers.ts), so the
 *  persistence format can import its types without a cycle.
 *
 *  Credential posture: scrypt with a per-user random salt, constant-time compare.
 *  The hash never leaves this module (listing/identity faces carry no credential
 *  fields); `/v1/identities` lists SEEDED rows only — real accounts are never
 *  enumerable. In a real deployment an IdP replaces the credential entirely; the
 *  registry (users/tenants/memberships) is what carries over. */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { Capabilities, Identity, Tenant, TenantRole, User } from '../contract/index.ts'

type Backend = Capabilities['backend']

/** A stored user — the contract `User` plus the server-only credential. */
export interface AccountUser extends User {
  /** hex scrypt(password, salt); absent on seeded/credential-less users. */
  passwordHash?: string
  /** hex per-user random salt. */
  passwordSalt?: string
  /** Seeded rows power the dev switcher directory and are never listed to
   *  onboarded users as switch targets — nor deletable. */
  seeded?: boolean
}

export interface AccountTenant extends Tenant {
  seeded?: boolean
}

export interface Membership {
  userId: string
  tenantId: string
  role: TenantRole
  seeded?: boolean
}

const SCRYPT_LEN = 64
/** Burned on unknown-email logins so failure timing is uniform (see verifyPassword). */
const DUMMY_SALT = 'a'.repeat(32)

function hashPassword(password: string, saltHex: string): string {
  return scryptSync(password, Buffer.from(saltHex, 'hex'), SCRYPT_LEN).toString('hex')
}

export class AccountRegistry {
  readonly users = new Map<string, AccountUser>()
  readonly tenants = new Map<string, AccountTenant>()
  memberships: Membership[] = []
  private userSeq = 0
  private tenantSeq = 0

  constructor() {
    this.seed()
  }

  /** The seeds — exactly the directory the identity seam always accepted:
   *  the desktop's local user with personal + work workspaces, and the web org
   *  principals (plus grace's tenant-beta, the co-authoring E2E's "Bo"). */
  seed(): void {
    this.users.clear()
    this.tenants.clear()
    this.memberships = []
    const put = (u: AccountUser, t: AccountTenant, role: TenantRole) => {
      if (!this.users.has(u.id)) this.users.set(u.id, u)
      if (!this.tenants.has(t.id)) this.tenants.set(t.id, t)
      this.memberships.push({ userId: u.id, tenantId: t.id, role, seeded: true })
    }
    const local: AccountUser = { id: 'user-local', name: 'You', seeded: true }
    put(local, { id: 'tenant-personal', name: 'Personal', kind: 'personal', seeded: true }, 'owner')
    put(local, { id: 'tenant-work', name: 'Acme (work)', kind: 'org', seeded: true }, 'member')
    const ada: AccountUser = { id: 'user-ada', name: 'Ada Lovelace', email: 'ada@acme.example', seeded: true }
    const grace: AccountUser = { id: 'user-grace', name: 'Grace Hopper', email: 'grace@acme.example', seeded: true }
    const acme: AccountTenant = { id: 'tenant-acme', name: 'Acme, Inc.', kind: 'org', seeded: true }
    put(ada, acme, 'owner')
    put(grace, acme, 'member')
    put(grace, { id: 'tenant-beta', name: 'tenant-beta', kind: 'org', seeded: true }, 'member')
  }

  membership(userId: string, tenantId: string): Membership | undefined {
    return this.memberships.find((m) => m.userId === userId && m.tenantId === tenantId)
  }

  /** Resolve verified claims to an Identity — the cookie path's directory. Null
   *  when the user is gone or holds no membership for the tenant (a stale
   *  credential resolves to NOTHING, not to a guess). Strips credential fields. */
  identityFor(userId: string, tenantId: string): Identity | null {
    const u = this.users.get(userId)
    const t = this.tenants.get(tenantId)
    const m = this.membership(userId, tenantId)
    if (!u || !t || !m) return null
    const user: User = { id: u.id, name: u.name, ...(u.email ? { email: u.email } : {}) }
    return { user, tenant: { id: t.id, name: t.name, kind: t.kind }, role: m.role, local: u.id === 'user-local' }
  }

  findByEmail(email: string): AccountUser | undefined {
    const needle = email.trim().toLowerCase()
    return [...this.users.values()].find((u) => u.email?.toLowerCase() === needle)
  }

  /** Onboard a real account: user + their personal workspace, credential hashed.
   *  Returns null on a duplicate email (the route 409s). */
  createUser(name: string, email: string, password: string): { user: AccountUser; tenant: AccountTenant } | null {
    if (this.findByEmail(email)) return null
    this.userSeq += 1
    this.tenantSeq += 1
    const salt = randomBytes(16).toString('hex')
    const user: AccountUser = {
      id: `user-${this.userSeq}`,
      name: name.trim(),
      email: email.trim(),
      passwordSalt: salt,
      passwordHash: hashPassword(password, salt),
    }
    const tenant: AccountTenant = { id: `tenant-u${this.userSeq}-personal`, name: `${user.name} (personal)`, kind: 'personal' }
    this.users.set(user.id, user)
    this.tenants.set(tenant.id, tenant)
    this.memberships.push({ userId: user.id, tenantId: tenant.id, role: 'owner' })
    return { user, tenant }
  }

  /** Credential check that is indistinguishable across failure modes: unknown
   *  email, credential-less (seeded) user, and wrong password all burn the SAME
   *  scrypt work before failing — the equalized 401 body would otherwise be
   *  defeated by a timing oracle (scrypt is deliberately slow, so "instant 401"
   *  vs "slow 401" reads as "no such account" vs "wrong password"). */
  verifyPassword(email: string, password: string): AccountUser | null {
    const u = this.findByEmail(email)
    const salt = u?.passwordSalt ?? DUMMY_SALT
    const given = Buffer.from(hashPassword(password, salt), 'hex') // constant work, hit or miss
    if (!u?.passwordHash || !u.passwordSalt) return null
    const stored = Buffer.from(u.passwordHash, 'hex')
    return given.length === stored.length && timingSafeEqual(given, stored) ? u : null
  }

  /** Create an org workspace under an existing user (they become owner). */
  createWorkspace(userId: string, name: string): AccountTenant | null {
    if (!this.users.has(userId)) return null
    this.tenantSeq += 1
    const tenant: AccountTenant = { id: `tenant-ws-${this.tenantSeq}`, name: name.trim(), kind: 'org' }
    this.tenants.set(tenant.id, tenant)
    this.memberships.push({ userId, tenantId: tenant.id, role: 'owner' })
    return tenant
  }

  /** A user's workspaces (for the chip menu) — their own memberships only. */
  workspacesOf(userId: string): Array<{ tenant: Tenant; role: TenantRole }> {
    return this.memberships
      .filter((m) => m.userId === userId)
      .map((m) => {
        const t = this.tenants.get(m.tenantId)
        return t ? { tenant: { id: t.id, name: t.name, kind: t.kind }, role: m.role } : null
      })
      .filter((x): x is { tenant: Tenant; role: TenantRole } => !!x)
  }

  /** The dev switcher's directory — SEEDED rows only (real accounts are never
   *  enumerable; they sign in). Shape per backend as the seam always was: the
   *  desktop lists the local user's workspaces, the web lists org principals. */
  listSeedIdentities(backend: Backend): Array<{ userId: string; userLabel: string; tenantId: string; tenantLabel: string; role: string }> {
    const rows = this.memberships.filter((m) => m.seeded)
    const wanted = backend === 'remote' ? (m: Membership) => m.userId !== 'user-local' : (m: Membership) => m.userId === 'user-local'
    return rows.filter(wanted).map((m) => {
      const u = this.users.get(m.userId)!
      const t = this.tenants.get(m.tenantId)!
      return { userId: u.id, userLabel: u.name, tenantId: t.id, tenantLabel: t.name, role: m.role }
    })
  }

  // ── Persistence faces (additive slices; seeds re-ensured on rehydrate) ──────

  toPersisted(): { users: [string, AccountUser][]; tenants: [string, AccountTenant][]; memberships: Membership[]; seq: { user: number; tenant: number } } {
    return {
      users: [...this.users.entries()],
      tenants: [...this.tenants.entries()],
      memberships: this.memberships,
      seq: { user: this.userSeq, tenant: this.tenantSeq },
    }
  }

  rehydrate(s: { users?: [string, AccountUser][]; tenants?: [string, AccountTenant][]; memberships?: Membership[]; seq?: { user?: number; tenant?: number } }): void {
    // Replace wholesale when the snapshot carries the slices, then re-ensure the
    // seeds — a snapshot written by a build with different seeds must not lose
    // the directory the dev switcher and tests rely on. `seed()` only fills gaps
    // for users/tenants; memberships are re-added if missing.
    if (!s.users && !s.tenants && !s.memberships) return
    const snapshotUsers = new Map(s.users ?? [])
    const snapshotTenants = new Map(s.tenants ?? [])
    const snapshotMemberships = s.memberships ?? []
    this.seed() // baseline: the seeds
    for (const [id, u] of snapshotUsers) this.users.set(id, u)
    for (const [id, t] of snapshotTenants) this.tenants.set(id, t)
    for (const m of snapshotMemberships) {
      if (!this.membership(m.userId, m.tenantId)) this.memberships.push(m)
    }
    this.userSeq = Math.max(this.userSeq, s.seq?.user ?? 0)
    this.tenantSeq = Math.max(this.tenantSeq, s.seq?.tenant ?? 0)
  }
}

/** The process-wide registry (same singleton pattern as the turn registry and
 *  event log; the store snapshots it into the persisted state). */
export const accounts = new AccountRegistry()
