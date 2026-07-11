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

  /** The seeds — the desktop's local user with personal + work workspaces, and
   *  the SIX demo accounts (docs/demo-accounts.md): each a themed principal
   *  with a documented demo credential and its own workspace, so the
   *  multi-account demo has genuinely distinguishable worlds to hop between.
   *  Ada owns the default tenant (the flagship dataset); Grace holds the
   *  cross-tenant pair (Acme member + her own platform workspace — also the
   *  co-authoring E2E's "Bo"); the other four each own one themed org. */
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
    // The web principals carry DEMO CREDENTIALS (P9 — the dev enumeration
    // directory retired): since multi-account went real, the only way to act
    // as a seed is the same way as any account — sign in. The hashes are
    // precomputed constants (fixed salts) so boot and every test process skip
    // the scrypt cost; the passwords are documented in AGENTS.md ("What's
    // intentionally mock"). The desktop's `user-local` stays credential-less
    // on purpose — the loopback sidecar's device owner never signs in.
    const ada: AccountUser = {
      id: 'user-ada',
      name: 'Ada Lovelace',
      email: 'ada@acme.example',
      seeded: true,
      passwordSalt: '736565642d6164612d73616c742d3030', // "ada-demo-password"
      passwordHash:
        'facc8d801fae0c215ff760fc0bb972a64335ebed3bc7e6ca3365324916278130b671117e5ad909445eb302f374aa73b1d88b86463eb89c461e1b78565fc55aa7',
    }
    const grace: AccountUser = {
      id: 'user-grace',
      name: 'Grace Hopper',
      email: 'grace@acme.example',
      seeded: true,
      passwordSalt: '736565642d67726163652d73616c742d', // "grace-demo-password"
      passwordHash:
        '16b1e455462e376846f1beceff05330d967adfb03b81725f8ce2b292239cf40971cb1b7a6f40222915f6cf2ab0c22d3d90d52103be4fb676fc38feaadd077dc1',
    }
    const acme: AccountTenant = { id: 'tenant-acme', name: 'Acme, Inc.', kind: 'org', seeded: true }
    put(ada, acme, 'owner')
    put(grace, acme, 'member')
    put(grace, { id: 'tenant-beta', name: 'Beta Platform', kind: 'org', seeded: true }, 'owner')
    // The other four demo principals (docs/demo-accounts.md) — one themed org
    // each, same precomputed-credential pattern as ada/grace above.
    const maya: AccountUser = {
      id: 'user-maya',
      name: 'Maya Chen',
      email: 'maya@growthworks.example',
      seeded: true,
      passwordSalt: '736565642d6d6179612d73616c742d30', // "maya-demo-password"
      passwordHash:
        '877fe51eef0e931f089009293d2ca3fa6b9556f6a55edb5b06148c3f7d1f86b9562595917ee21d430d0ceeffd6b7d24900ef8e33e2bbd47b224df802fa34f324',
    }
    put(maya, { id: 'tenant-growthworks', name: 'Growthworks', kind: 'org', seeded: true }, 'owner')
    const noor: AccountUser = {
      id: 'user-noor',
      name: 'Noor Haddad',
      email: 'noor@northlight.example',
      seeded: true,
      passwordSalt: '736565642d6e6f6f722d73616c742d30', // "noor-demo-password"
      passwordHash:
        '9503160c2d4679b8bfdc27167a3ccb2f0ecb73a2087095d8fd1a3b504500e692432aba369841719cf6f90798e4459421e9595a5b0d10565ddb0ec5a066c5a112',
    }
    put(noor, { id: 'tenant-northlight', name: 'Northlight Studio', kind: 'org', seeded: true }, 'owner')
    const omar: AccountUser = {
      id: 'user-omar',
      name: 'Omar Diaz',
      email: 'omar@harborsupport.example',
      seeded: true,
      passwordSalt: '736565642d6f6d61722d73616c742d30', // "omar-demo-password"
      passwordHash:
        '649b3db5310aded9715cfe8221591ec594d132c6a37949350cb43a34ea0b02c1602aa7bd0b5d09670a937fd8f612908b18984118567b37850ec8170a31b9973f',
    }
    put(omar, { id: 'tenant-harbor', name: 'Harbor Support', kind: 'org', seeded: true }, 'owner')
    const rei: AccountUser = {
      id: 'user-rei',
      name: 'Rei Tanaka',
      email: 'rei@reislab.example',
      seeded: true,
      passwordSalt: '736565642d7265692d73616c742d3030', // "rei-demo-password"
      passwordHash:
        '5ccd796b9b5fd9344f34f31628ad1510bf6dd82c06c88a5affc174caf3bdf5dcf1f685bbb585b99b97845a89a7a80176a6d187fae8c9f08fedc0393974b2ff18',
    }
    put(rei, { id: 'tenant-reislab', name: 'Rei’s Lab', kind: 'personal', seeded: true }, 'owner')
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
    // seeds. The CODE's seed rows stay authoritative over their snapshot echoes:
    // a snapshot written by an older build carries the OLD seed shape (e.g.
    // pre-P9 rows without the demo credentials), and letting it overwrite the
    // fresh seeds would pin every clone to whatever build first persisted —
    // so snapshot users/tenants only land on NON-seed ids. Memberships are
    // re-added if missing.
    if (!s.users && !s.tenants && !s.memberships) return
    const snapshotUsers = new Map(s.users ?? [])
    const snapshotTenants = new Map(s.tenants ?? [])
    const snapshotMemberships = s.memberships ?? []
    this.seed() // baseline: the seeds
    for (const [id, u] of snapshotUsers) if (!this.users.get(id)?.seeded) this.users.set(id, u)
    for (const [id, t] of snapshotTenants) if (!this.tenants.get(id)?.seeded) this.tenants.set(id, t)
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
