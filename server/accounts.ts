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
import type { Capabilities, Identity, MyInvite, MyOrg, OrgInviteRow, OrgMemberRow, Tenant, TenantRole, User } from '../contract/index.ts'

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

/** FWD-5 Phase 2 collapsed this to one row per user; FWD-6 (orgs) re-opened it
 *  under a refined invariant: every user holds exactly ONE **home** membership —
 *  their namespace (`home: true`, what `homeOf` resolves and sign-in lands in) —
 *  plus any number of ORG seats (O-D2). `rehydrate` enforces the shape: one home
 *  per user, and an org seat never lands in a tenant that is somebody's
 *  namespace (that wall is what keeps a pre-collapse snapshot's echo — Grace's
 *  old Acme seat — from resurrecting workspace multiplicity). */
export interface Membership {
  userId: string
  tenantId: string
  role: TenantRole
  /** True on the user's NAMESPACE membership (exactly one per user). Absent on
   *  org seats — and on pre-FWD-6 persisted rows, where "the user's first row"
   *  is the legacy home rule `rehydrate` normalizes from. */
  home?: boolean
  seeded?: boolean
}

/** An org invitation as STORED (FWD-6 O-D3) — the wire row plus its org. The
 *  registry keys nothing by account existence: the email is matched lazily at
 *  read/accept time, so inviting an address reveals nothing about it. */
export interface StoredOrgInvite extends OrgInviteRow {
  orgId: string
}

/** Bounds: an org's PENDING invites are capped (a queue, not a spam cannon);
 *  resolved rows are kept for the member panel's history but bounded too. */
const MAX_PENDING_ORG_INVITES = 20
const MAX_ORG_INVITE_ROWS = 100

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
  orgInvites: StoredOrgInvite[] = []
  private userSeq = 0
  private tenantSeq = 0
  private inviteSeq = 0

  constructor() {
    this.seed()
  }

  /** The seeds — the desktop's local user and the SIX demo accounts
   *  (docs/demo-accounts.md): each a themed principal with a documented demo
   *  credential and exactly ONE namespace (FWD-5 Phase 2 — the workspace
   *  collapse: account = namespace, 1:1). Ada's namespace is the flagship
   *  dataset (`tenant-acme`); Grace's is her platform world (`tenant-beta` —
   *  also the co-authoring E2E's "Bo"); the other four each own one themed
   *  world. The pre-collapse second seats (local's "Acme (work)" membership,
   *  Grace's Acme membership) are gone — cross-account collaboration is shared
   *  projects, not shared tenancy. */
  seed(): void {
    this.users.clear()
    this.tenants.clear()
    this.memberships = []
    const put = (u: AccountUser, t: AccountTenant, role: TenantRole) => {
      if (!this.users.has(u.id)) this.users.set(u.id, u)
      if (!this.tenants.has(t.id)) this.tenants.set(t.id, t)
      // Every seed membership IS the user's namespace (FWD-6: `home`).
      this.memberships.push({ userId: u.id, tenantId: t.id, role, home: true, seeded: true })
    }
    const local: AccountUser = { id: 'user-local', name: 'You', seeded: true }
    put(local, { id: 'tenant-personal', name: 'Personal', kind: 'personal', seeded: true }, 'owner')
    // The web principals carry DEMO CREDENTIALS (P9 — the dev enumeration
    // directory retired): since multi-account went real, the only way to act
    // as a seed is the same way as any account — sign in. The hashes are
    // precomputed constants (fixed salts) so boot and every test process skip
    // the scrypt cost; the passwords are documented in docs/demo-accounts.md
    // (and docs/evaluation.md). The desktop's `user-local` stays credential-less
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

  /** Onboard a real account: user + their ONE namespace, credential hashed.
   *  The namespace bears the person's display name (GitHub-style — your
   *  namespace IS you; FWD-5 Phase 2 dropped the "(personal)" suffix with the
   *  workspace framing). Returns null on a duplicate email (the route 409s). */
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
    const tenant: AccountTenant = { id: `tenant-u${this.userSeq}-personal`, name: user.name, kind: 'personal' }
    this.users.set(user.id, user)
    this.tenants.set(tenant.id, tenant)
    this.memberships.push({ userId: user.id, tenantId: tenant.id, role: 'owner', home: true })
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

  /** A user's ONE namespace (FWD-5 Phase 2 — account = namespace). Undefined only
   *  for a gone user or a dangling membership; every minted account has exactly
   *  one. The `home` flag discriminates it from org seats (FWD-6); the first-row
   *  fallback covers a legacy in-memory shape that predates the flag. */
  homeOf(userId: string): { tenant: Tenant; role: TenantRole } | undefined {
    const m =
      this.memberships.find((x) => x.userId === userId && x.home) ??
      this.memberships.find((x) => x.userId === userId)
    const t = m && this.tenants.get(m.tenantId)
    return t ? { tenant: { id: t.id, name: t.name, kind: t.kind }, role: m.role } : undefined
  }

  /** Whether a tenant is somebody's NAMESPACE (home) — the wall that keeps org
   *  machinery (invites, seats) out of person namespaces (FWD-6 O-D1/O-D5). */
  isNamespace(tenantId: string): boolean {
    return this.memberships.some((m) => m.home && m.tenantId === tenantId)
  }

  /** FWD-6 O-D5 — the role the account behind a NAMESPACE holds in `target`
   *  (their own namespace answers with the home seat's role). Undefined = no
   *  seat — including when the caller tenant is nobody's namespace (a dev-seam
   *  synthetic), which keeps the union walls inert for impersonated tenants. */
  seatIn(namespaceTenantId: string, target: string): TenantRole | undefined {
    const home = this.memberships.find((m) => m.home && m.tenantId === namespaceTenantId)
    if (!home) return undefined
    return this.membership(home.userId, target)?.role
  }

  // ── FWD-6 — organizations (namespaces with members, never worlds) ───────────

  /** Found an org: a new org tenant + the founder's `owner` seat (O-D2). The
   *  org is a NAMESPACE — it never logs in and is never switched into. */
  createOrg(founderUserId: string, name: string): AccountTenant | null {
    if (!this.users.has(founderUserId)) return null
    this.tenantSeq += 1
    const tenant: AccountTenant = { id: `tenant-org-${this.tenantSeq}`, name: name.trim(), kind: 'org' }
    this.tenants.set(tenant.id, tenant)
    this.memberships.push({ userId: founderUserId, tenantId: tenant.id, role: 'owner' })
    return tenant
  }

  /** The caller's org seats (`GET /me/orgs`) — home excluded by definition. */
  orgsOf(userId: string): MyOrg[] {
    return this.memberships
      .filter((m) => m.userId === userId && !m.home)
      .map((m) => {
        const t = this.tenants.get(m.tenantId)
        return t ? { tenant: { id: t.id, name: t.name, kind: t.kind }, role: m.role } : null
      })
      .filter((x): x is MyOrg => !!x)
  }

  /** Invite an email into an org (O-D3) — EXISTENCE-HIDDEN: the registry never
   *  checks whether an account bears the email; matching happens lazily at the
   *  invitee's reads. A duplicate pending invite returns the existing row
   *  (uniform — no signal either way). Null = the org is full of pending
   *  invites ('capped' at the route). */
  createInvite(orgId: string, email: string, invitedByName: string): StoredOrgInvite | null {
    const normalized = email.trim().toLowerCase()
    const existing = this.orgInvites.find((i) => i.orgId === orgId && i.email === normalized && i.status === 'invited')
    if (existing) return existing
    const pending = this.orgInvites.filter((i) => i.orgId === orgId && i.status === 'invited').length
    if (pending >= MAX_PENDING_ORG_INVITES) return null
    this.inviteSeq += 1
    const invite: StoredOrgInvite = {
      id: `invite-${this.inviteSeq}`,
      orgId,
      email: normalized,
      role: 'member',
      invitedBy: invitedByName,
      at: Date.now(),
      status: 'invited',
    }
    this.orgInvites.push(invite)
    // Bound the per-org history: drop the oldest RESOLVED rows past the cap
    // (pending rows are already capped above and are never dropped).
    const rows = this.orgInvites.filter((i) => i.orgId === orgId)
    if (rows.length > MAX_ORG_INVITE_ROWS) {
      const drop = rows.filter((i) => i.status !== 'invited').slice(0, rows.length - MAX_ORG_INVITE_ROWS)
      this.orgInvites = this.orgInvites.filter((i) => !drop.includes(i))
    }
    return invite
  }

  /** The org side of the invite ledger (owner-only at the route). */
  invitesOfOrg(orgId: string): OrgInviteRow[] {
    return this.orgInvites.filter((i) => i.orgId === orgId).map(({ orgId: _org, ...row }) => row)
  }

  /** The org's member roster (any seat may read it at the route) — display
   *  names only, the public identity every byline shows. */
  membersOf(orgId: string): OrgMemberRow[] {
    return this.memberships
      .filter((m) => !m.home && m.tenantId === orgId)
      .map((m) => {
        const u = this.users.get(m.userId)
        return u ? { name: u.name, role: m.role } : null
      })
      .filter((x): x is OrgMemberRow => !!x)
  }

  /** The INVITEE's pending invites — matched lazily by the signed-in account's
   *  email (a credential-less account, e.g. the desktop user, has none). */
  myInvites(email: string | undefined): MyInvite[] {
    if (!email) return []
    const needle = email.trim().toLowerCase()
    return this.orgInvites
      .filter((i) => i.status === 'invited' && i.email === needle)
      .map((i) => ({
        id: i.id,
        orgId: i.orgId,
        orgName: this.tenants.get(i.orgId)?.name ?? i.orgId,
        role: i.role,
        invitedBy: i.invitedBy,
        at: i.at,
      }))
  }

  /** The invitee's verdict (O-D3): accept mints the seat; decline just closes.
   *  The invite must be pending AND addressed to the caller's email — anything
   *  else is undefined (→ 404, indistinguishable from "no such invite"). */
  resolveInvite(inviteId: string, userId: string, action: 'accept' | 'decline'): MyOrg | 'declined' | undefined {
    const email = this.users.get(userId)?.email?.toLowerCase()
    const invite = this.orgInvites.find((i) => i.id === inviteId)
    if (!invite || invite.status !== 'invited' || !email || invite.email !== email) return undefined
    // An invite whose org tenant no longer resolves (an inconsistent snapshot —
    // invites restore wholesale, tenants conditionally) is the same 404 as any
    // bad invite, refused BEFORE any state flips — never a mid-mutation throw.
    const t = this.tenants.get(invite.orgId)
    if (!t) return undefined
    invite.status = action === 'accept' ? 'accepted' : 'declined'
    invite.resolvedAt = Date.now()
    if (action === 'decline') return 'declined'
    if (!this.membership(userId, invite.orgId)) {
      this.memberships.push({ userId, tenantId: invite.orgId, role: invite.role })
    }
    return { tenant: { id: t.id, name: t.name, kind: t.kind }, role: this.membership(userId, invite.orgId)!.role }
  }

  /** The owner's honest close of a pending invite. */
  revokeInvite(orgId: string, inviteId: string): OrgInviteRow | 'closed' | undefined {
    const invite = this.orgInvites.find((i) => i.id === inviteId && i.orgId === orgId)
    if (!invite) return undefined
    if (invite.status !== 'invited') return 'closed'
    invite.status = 'revoked'
    invite.resolvedAt = Date.now()
    const { orgId: _org, ...row } = invite
    return row
  }

  // ── Persistence faces (additive slices; seeds re-ensured on rehydrate) ──────

  toPersisted(): {
    users: [string, AccountUser][]
    tenants: [string, AccountTenant][]
    memberships: Membership[]
    orgInvites: StoredOrgInvite[]
    seq: { user: number; tenant: number; orgInvite: number }
  } {
    return {
      users: [...this.users.entries()],
      tenants: [...this.tenants.entries()],
      memberships: this.memberships,
      orgInvites: this.orgInvites,
      seq: { user: this.userSeq, tenant: this.tenantSeq, orgInvite: this.inviteSeq },
    }
  }

  rehydrate(s: {
    users?: [string, AccountUser][]
    tenants?: [string, AccountTenant][]
    memberships?: Membership[]
    orgInvites?: StoredOrgInvite[]
    seq?: { user?: number; tenant?: number; orgInvite?: number }
  }): void {
    // Replace wholesale when the snapshot carries the slices, then re-ensure the
    // seeds. The CODE's seed rows stay authoritative over their snapshot echoes:
    // a snapshot written by an older build carries the OLD seed shape (e.g.
    // pre-P9 rows without the demo credentials), and letting it overwrite the
    // fresh seeds would pin every clone to whatever build first persisted —
    // so snapshot users/tenants only land on NON-seed ids.
    if (!s.users && !s.tenants && !s.memberships) return
    const snapshotUsers = new Map(s.users ?? [])
    const snapshotTenants = new Map(s.tenants ?? [])
    const snapshotMemberships = s.memberships ?? []
    this.seed() // baseline: the seeds
    for (const [id, u] of snapshotUsers) if (!this.users.get(id)?.seeded) this.users.set(id, u)
    for (const [id, t] of snapshotTenants) if (!this.tenants.get(id)?.seeded) this.tenants.set(id, t)
    // Memberships restore under the FWD-6 shape: exactly one HOME per user (the
    // flagged row, or — legacy snapshots predate the flag — the user's first
    // row), then org seats, which may NEVER land in a tenant that is somebody's
    // namespace. That wall is what keeps a pre-collapse echo (Grace's old seat
    // on Ada's Acme) dropped while a real org seat round-trips freely.
    const homes = new Map<string, string>() // userId → namespace tenant id
    for (const m of this.memberships) if (m.home) homes.set(m.userId, m.tenantId) // the seeds
    // Pass 1 — FLAGGED homes first (order-independent: a seat listed before its
    // user's home row must not be mis-inferred as the namespace).
    for (const m of snapshotMemberships) {
      if (m.home && !homes.has(m.userId)) {
        homes.set(m.userId, m.tenantId)
        this.memberships.push({ ...m, home: true })
      }
    }
    // Pass 2 — legacy inference: a user with NO flagged row anywhere (a pre-FWD-6
    // snapshot) gets their FIRST row as the namespace.
    for (const m of snapshotMemberships) {
      if (m.home || homes.has(m.userId)) continue
      homes.set(m.userId, m.tenantId)
      this.memberships.push({ ...m, home: true })
    }
    // Pass 3 — org seats, walled out of every namespace. (A pre-collapse
    // workspace seat that targeted a since-FWD-6 org-shaped tenant restores as
    // the org seat it should have been; one that targets a person namespace —
    // Grace's old Acme seat — stays dropped.)
    const namespaces = new Set(homes.values())
    for (const m of snapshotMemberships) {
      if (m.home || homes.get(m.userId) === m.tenantId) continue
      if (namespaces.has(m.tenantId)) continue
      if (!this.membership(m.userId, m.tenantId)) this.memberships.push({ ...m, home: undefined })
    }
    this.orgInvites = s.orgInvites ?? []
    this.userSeq = Math.max(this.userSeq, s.seq?.user ?? 0)
    this.tenantSeq = Math.max(this.tenantSeq, s.seq?.tenant ?? 0)
    this.inviteSeq = Math.max(this.inviteSeq, s.seq?.orgInvite ?? 0)
  }
}

/** The process-wide registry (same singleton pattern as the turn registry and
 *  event log; the store snapshots it into the persisted state). */
export const accounts = new AccountRegistry()
