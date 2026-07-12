/** FWD-6 O1 — orgs as namespaces, the server core (docs/design/
 *  principals-and-namespaces.md §8). The invariants under test:
 *   - founding an org mints a namespace + the founder's `owner` seat, and the
 *     founder's HOME namespace is untouched (sign-in still lands there);
 *   - joining is a CONSENT act: an email-keyed invitation the invitee accepts —
 *     accept mints the `member` seat, decline doesn't, revoke closes it;
 *   - existence-hiding: inviting a known and an unknown email are
 *     indistinguishable; a foreign/resolved/wrongly-addressed invite verdict is
 *     the same 404; a non-member's org read is 404, a member-non-owner's is 403;
 *   - org machinery is walled OUT of person namespaces (its owner included);
 *   - persistence: seats + invites round-trip; one HOME per user survives; a
 *     pre-collapse echo (Grace's old Acme seat) still never resurrects. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { accounts, AccountRegistry } from '../server/accounts.ts'
import { store } from '../server/store.ts'
import { call } from './helpers/http.ts'

const cookieOf = (r: { headers: Record<string, string> }) => r.headers['set-cookie']?.split(';')[0] ?? ''
let n = 0

/** A signed-up account (real cookie) — the org flows are identity-driven. */
async function account(name: string) {
  const email = `${name.toLowerCase().replace(/\s+/g, '-')}-${(n += 1)}@orgs.example`
  const res = await call('POST', '/auth/signup', { name, email, password: `${name}-password-1` })
  assert.equal(res.status, 200)
  return { cookie: cookieOf(res), email, userId: res.json.user.id as string, home: res.json.tenant.id as string }
}

test('founding an org: a new namespace + the founder’s owner seat; HOME stays the person namespace', async () => {
  const founder = await account('Org Fay')
  const created = await call('POST', '/orgs', { name: 'Fay Collective' }, { cookie: founder.cookie })
  assert.equal(created.status, 201)
  assert.equal(created.json.kind, 'org')

  const orgs = await call('GET', '/me/orgs', undefined, { cookie: founder.cookie })
  assert.deepEqual(
    orgs.json.map((o: { tenant: { id: string }; role: string }) => [o.tenant.id, o.role]),
    [[created.json.id, 'owner']],
    'the founder holds the owner seat',
  )
  assert.equal(accounts.homeOf(founder.userId)?.tenant.id, founder.home, 'the person namespace is still home')
  // Sign-in still lands in the namespace, not the org (no switching, ever).
  const back = await call('POST', '/auth/login', { email: founder.email, password: 'Org Fay-password-1' })
  assert.equal(back.json.tenant.id, founder.home)
})

test('the consent flow: invite (existence-hidden) → the invitee accepts → member seat; decline mints nothing', async () => {
  const owner = await account('Org Ona')
  const invitee = await account('Org Ivy')
  const org = (await call('POST', '/orgs', { name: 'Ona Works' }, { cookie: owner.cookie })).json

  // Known and unknown emails answer IDENTICALLY (shape + status): no oracle.
  const known = await call('POST', `/orgs/${org.id}/invites`, { email: invitee.email }, { cookie: owner.cookie })
  const unknown = await call('POST', `/orgs/${org.id}/invites`, { email: `ghost-${n}@orgs.example` }, { cookie: owner.cookie })
  assert.equal(known.status, 201)
  assert.equal(unknown.status, 201)
  assert.deepEqual(Object.keys(known.json).sort(), Object.keys(unknown.json).sort(), 'indistinguishable rows')

  // The invitee sees THEIR pending invite (matched by their account email).
  const mine = await call('GET', '/me/invites', undefined, { cookie: invitee.cookie })
  assert.equal(mine.json.length, 1)
  assert.equal(mine.json[0].orgName, 'Ona Works')
  const inviteId = mine.json[0].id as string

  // A bystander cannot act on it — same 404 as a wrong guess.
  const thief = await account('Org Thea')
  assert.equal((await call('POST', `/me/invites/${inviteId}/accept`, undefined, { cookie: thief.cookie })).status, 404)

  // Accept mints the member seat; the invite resolves; a second verdict 404s.
  const accepted = await call('POST', `/me/invites/${inviteId}/accept`, undefined, { cookie: invitee.cookie })
  assert.equal(accepted.status, 200)
  assert.equal(accepted.json.role, 'member')
  const orgsNow = await call('GET', '/me/orgs', undefined, { cookie: invitee.cookie })
  assert.ok(orgsNow.json.some((o: { tenant: { id: string } }) => o.tenant.id === org.id))
  assert.equal((await call('POST', `/me/invites/${inviteId}/accept`, undefined, { cookie: invitee.cookie })).status, 404)

  // Decline path: a fresh invite to a fresh account, declined — no seat.
  const decliner = await account('Org Dee')
  await call('POST', `/orgs/${org.id}/invites`, { email: decliner.email }, { cookie: owner.cookie })
  const theirs = await call('GET', '/me/invites', undefined, { cookie: decliner.cookie })
  const declined = await call('POST', `/me/invites/${theirs.json[0].id}/decline`, undefined, { cookie: decliner.cookie })
  assert.equal(declined.status, 200)
  assert.deepEqual((await call('GET', '/me/orgs', undefined, { cookie: decliner.cookie })).json, [])
})

test('the walls: non-member 404, member-non-owner 403, revoke closes, person namespaces are not orgs', async () => {
  const owner = await account('Org Wes')
  const member = await account('Org Mia')
  const outsider = await account('Org Out')
  const org = (await call('POST', '/orgs', { name: 'Wes Guild' }, { cookie: owner.cookie })).json
  await call('POST', `/orgs/${org.id}/invites`, { email: member.email }, { cookie: owner.cookie })
  const inv = (await call('GET', '/me/invites', undefined, { cookie: member.cookie })).json[0]
  await call('POST', `/me/invites/${inv.id}/accept`, undefined, { cookie: member.cookie })

  // Reading the ledger: owner 200; member 403 (they know the org exists — honest);
  // outsider 404 (existence-hiding).
  assert.equal((await call('GET', `/orgs/${org.id}/invites`, undefined, { cookie: owner.cookie })).status, 200)
  assert.equal((await call('GET', `/orgs/${org.id}/invites`, undefined, { cookie: member.cookie })).status, 403)
  assert.equal((await call('GET', `/orgs/${org.id}/invites`, undefined, { cookie: outsider.cookie })).status, 404)

  // Revoke: pending → revoked; the invitee can no longer accept; re-revoke 409s.
  const target = await account('Org Rev')
  const pending = (await call('POST', `/orgs/${org.id}/invites`, { email: target.email }, { cookie: owner.cookie })).json
  const revoked = await call('DELETE', `/orgs/${org.id}/invites/${pending.id}`, undefined, { cookie: owner.cookie })
  assert.equal(revoked.status, 200)
  assert.equal(revoked.json.status, 'revoked')
  assert.equal((await call('POST', `/me/invites/${pending.id}/accept`, undefined, { cookie: target.cookie })).status, 404)
  assert.equal((await call('DELETE', `/orgs/${org.id}/invites/${pending.id}`, undefined, { cookie: owner.cookie })).status, 409)

  // A person NAMESPACE takes no org machinery — even from its own owner (O-D1).
  assert.equal(
    (await call('GET', `/orgs/${owner.home}/invites`, undefined, { cookie: owner.cookie })).status,
    404,
    'a namespace is not an org, existence-hidden like an unknown id',
  )
  assert.equal(
    (await call('POST', `/orgs/${owner.home}/invites`, { email: outsider.email }, { cookie: owner.cookie })).status,
    404,
  )

  // Validation: bad email 400; a duplicate PENDING invite returns the SAME row
  // (uniform — repeating the act signals nothing about the address).
  assert.equal((await call('POST', `/orgs/${org.id}/invites`, { email: 'not-an-email' }, { cookie: owner.cookie })).status, 400)
  const fresh = (await call('POST', `/orgs/${org.id}/invites`, { email: `dup-${n}@orgs.example` }, { cookie: owner.cookie })).json
  const dup = (await call('POST', `/orgs/${org.id}/invites`, { email: `dup-${n}@orgs.example` }, { cookie: owner.cookie })).json
  assert.equal(dup.id, fresh.id, 'the pending row is returned, not duplicated')
})

test('persistence: seats + invites round-trip; one HOME per user; the pre-collapse echo still never lands', async () => {
  const founder = await account('Org Per')
  const joiner = await account('Org Jo')
  const org = (await call('POST', '/orgs', { name: 'Persistence Guild' }, { cookie: founder.cookie })).json
  await call('POST', `/orgs/${org.id}/invites`, { email: joiner.email }, { cookie: founder.cookie })
  const inv = (await call('GET', '/me/invites', undefined, { cookie: joiner.cookie })).json[0]
  await call('POST', `/me/invites/${inv.id}/accept`, undefined, { cookie: joiner.cookie })

  const slices = accounts.toPersisted()
  const reborn = new AccountRegistry()
  reborn.rehydrate({ ...slices })

  assert.equal(reborn.homeOf(founder.userId)?.tenant.id, founder.home, 'home survives')
  assert.deepEqual(
    reborn.orgsOf(joiner.userId).map((o) => [o.tenant.id, o.role]),
    [[org.id, 'member']],
    'the accepted seat round-trips',
  )
  assert.ok(reborn.invitesOfOrg(org.id).some((i) => i.status === 'accepted'), 'the invite ledger round-trips')
  // Exactly one HOME per user, ever.
  const homes = new Map<string, number>()
  for (const m of reborn.memberships) if (m.home) homes.set(m.userId, (homes.get(m.userId) ?? 0) + 1)
  for (const [userId, count] of homes) assert.equal(count, 1, `${userId}: one home`)

  // The FWD-5 regression stays locked: a pre-collapse echo into a person
  // namespace (Grace's old Acme seat — Ada's HOME) never restores as a seat.
  const echo = new AccountRegistry()
  echo.rehydrate({ users: [], tenants: [], memberships: [{ userId: 'user-grace', tenantId: 'tenant-acme', role: 'member', seeded: true }] })
  assert.equal(echo.membership('user-grace', 'tenant-acme'), undefined)
  assert.deepEqual(echo.orgsOf('user-grace'), [], 'no phantom org seat either')
})

test('O2 — an org-owned project: the picker stamps the org; members read + cooperate, only org-owners write; outsiders 404', async () => {
  const founder = await account('Org Fox')
  const member = await account('Org Mel')
  const outsider = await account('Org Odd')
  const org = (await call('POST', '/orgs', { name: 'Fox Labs' }, { cookie: founder.cookie })).json
  await call('POST', `/orgs/${org.id}/invites`, { email: member.email }, { cookie: founder.cookie })
  const inv = (await call('GET', '/me/invites', undefined, { cookie: member.cookie })).json[0]
  await call('POST', `/me/invites/${inv.id}/accept`, undefined, { cookie: member.cookie })

  // The owner picker (O-D4): a MEMBER may create an org-owned project; the op
  // stamps the ORG, not the creator's namespace.
  const pid = `p-org-${(n += 1)}`
  const created = await call(
    'POST', '/relations/ops',
    { op: { kind: 'create-project', projectId: pid, projectName: 'Org roadmap', projectDescription: '', ownerTenantId: org.id } },
    { cookie: member.cookie },
  )
  assert.equal(created.status, 200)
  const memberRow = created.json.extraProjects.find((p: { id: string }) => p.id === pid)
  assert.ok(memberRow, 'the member sees the org project (the union)')
  assert.equal(memberRow.ownerName, 'Fox Labs', 'owned by the ORG namespace')
  assert.equal(memberRow.own, false, 'a member gets visitor-style affordances (O-D6)')

  // The founder (org OWNER seat) gets write-grade `own`.
  const founderGraph = (await call('GET', '/relations', undefined, { cookie: founder.cookie })).json
  assert.equal(founderGraph.extraProjects.find((p: { id: string }) => p.id === pid)?.own, true)

  // An outsider sees nothing — projection and walls alike (it is PRIVATE to the org).
  const outsiderGraph = (await call('GET', '/relations', undefined, { cookie: outsider.cookie })).json
  assert.ok(!outsiderGraph.extraProjects.some((p: { id: string }) => p.id === pid))
  assert.equal(
    (await call('POST', `/projects/${pid}/open-subgoals`, { subGoal: 'x', type: 'charge', target: 'budget:demo' }, { cookie: outsider.cookie })).status,
    404,
  )

  // A MEMBER cooperates on the private org project (the union at the project walls)…
  const posted = await call(
    'POST', `/projects/${pid}/open-subgoals`,
    { subGoal: `org-item-${n}`, type: 'charge', target: 'budget:demo' },
    { cookie: member.cookie },
  )
  assert.equal(posted.status, 200)
  // …and the org's bell (the recipient is the ORG tenant) is member-readable —
  // here the FOUNDER hears the member's act.
  const founderInbox = (await call('GET', '/notifications', undefined, { cookie: founder.cookie })).json
  assert.ok(founderInbox.some((x: { kind: string; workItemId?: string }) => x.kind === 'work.posted' && x.workItemId === posted.json.id))
  assert.equal(
    store.eventVisibleToTenant({ type: 'notification.changed', tenantId: org.id }, member.home),
    true,
    'the org-targeted inbox event reaches a member’s stream',
  )
  assert.equal(store.eventVisibleToTenant({ type: 'notification.changed', tenantId: org.id }, outsider.home), false)

  // WRITE-grade ops: a member's share attempt is refused (404 — write walls);
  // the org OWNER's succeeds.
  const memberShare = await call(
    'POST', '/relations/ops',
    { op: { kind: 'share-project', projectId: pid, projectName: 'Org roadmap', shared: true } },
    { cookie: member.cookie },
  )
  assert.equal(memberShare.status, 404, 'member ≠ owner-grade — refused, existence-hidden shape')
  const ownerShare = await call(
    'POST', '/relations/ops',
    { op: { kind: 'share-project', projectId: pid, projectName: 'Org roadmap', shared: true } },
    { cookie: founder.cookie },
  )
  assert.equal(ownerShare.status, 200, 'the org-owner seat is write-grade')

  // The picker refuses an org the caller holds NO seat in (INV-9: refused loudly,
  // never normalized to the namespace it would have meant).
  const stolen = await call(
    'POST', '/relations/ops',
    { op: { kind: 'create-project', projectId: `p-steal-${n}`, projectName: 'Steal', projectDescription: '', ownerTenantId: org.id } },
    { cookie: outsider.cookie },
  )
  assert.equal(stolen.status, 404)
})
