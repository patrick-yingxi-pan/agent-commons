/** S0 locks for the social substrate (docs/design/social-layer.md §2.1):
 *  the tier order is strict and monotonic, the six nouns stay the relation
 *  graph's five plus Discussion, and the primitives' shared shapes stay
 *  kind-generic (no primitive core may branch on an entity kind — the
 *  orthogonality rule; adapters do that, registered elsewhere). */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SOCIAL_ENTITY_KINDS,
  SHARE_TIERS,
  tierRank,
  tierPermits,
} from '../contract/social.ts'
import { RELATIONS } from '../contract/relations.ts'
import { store } from '../server/store.ts'
import { call } from './helpers/http.ts'

test('the social nouns = the relation graph\'s five entities + discussion + proposal', () => {
  const relationEnds = new Set(RELATIONS.flatMap((r) => r.ends))
  for (const kind of relationEnds) {
    assert.ok(
      (SOCIAL_ENTITY_KINDS as readonly string[]).includes(kind),
      `relation entity "${kind}" must be a social noun`,
    )
  }
  assert.deepEqual(
    [...SOCIAL_ENTITY_KINDS].sort(),
    [...relationEnds, 'discussion', 'proposal'].sort(),
    'social nouns are exactly the relation entities plus the two social entities',
  )
})

test('share tiers are strictly ordered: view < comment < propose < co-own', () => {
  assert.deepEqual([...SHARE_TIERS], ['view', 'comment', 'propose', 'co-own'])
  const ranks = SHARE_TIERS.map(tierRank)
  for (let i = 1; i < ranks.length; i++) {
    assert.ok(ranks[i] > ranks[i - 1], `tier ${SHARE_TIERS[i]} must outrank ${SHARE_TIERS[i - 1]}`)
  }
})

test('tierPermits is monotonic: a tier covers itself and everything below, nothing above', () => {
  for (const held of SHARE_TIERS) {
    for (const needed of SHARE_TIERS) {
      assert.equal(
        tierPermits(held, needed),
        tierRank(held) >= tierRank(needed),
        `tierPermits(${held}, ${needed})`,
      )
    }
  }
})

/** ── S1 Grant locks — the share act over the generic ref ─────────────────────
 *  Invariants: creation is the subject OWNER's act; the wall is existence-hiding
 *  (invisible ≡ nonexistent — same 404); the wire face is redacted (display
 *  names, never raw tenant anchors); INV-9 on `note` (absent = silent share);
 *  one live grant per (subject, audience) — a re-grant replaces; either party
 *  may revoke, nobody else. */
const OWNER = 'tenant-social-owner'
const BYSTANDER = 'tenant-social-bystander'
const AUDIENCE = 'tenant-beta' // a seeded org (Grace's) — audiences must be registered
let sn = 0

function socialArena() {
  const projectId = `p-social-${(sn += 1)}`
  store.applyRelationOp({ kind: 'create-project', projectId, projectName: `Shared ${sn}`, projectDescription: '' }, OWNER)
  return { projectId, subject: { kind: 'project', id: projectId } }
}

test('grant: owner shares, audience sees their row, bystander gets the existence-hiding 404', async () => {
  const { projectId, subject } = socialArena()
  const created = await call('POST', '/grants', { subject, audience: { kind: 'org', orgId: AUDIENCE }, tier: 'comment' }, { 'x-tenant-id': OWNER })
  assert.equal(created.status, 200)
  assert.equal(created.json.tier, 'comment')
  assert.equal(created.json.granterTenant, undefined, 'raw granter tenant never crosses the wire')
  assert.equal(created.json.audienceTenant, undefined, 'raw audience tenant never crosses the wire')
  assert.equal(created.json.note, undefined, 'INV-9: absent note = silent share, stored as absent')

  const asOwner = await call('GET', `/grants?kind=project&id=${projectId}`, undefined, { 'x-tenant-id': OWNER })
  assert.equal(asOwner.status, 200)
  assert.equal(asOwner.json.length, 1, 'the owner reads the full roster')

  const asAudience = await call('GET', `/grants?kind=project&id=${projectId}`, undefined, { 'x-tenant-id': AUDIENCE })
  assert.equal(asAudience.status, 200)
  assert.equal(asAudience.json.length, 1, 'the audience sees what was shared TO them')

  const asBystander = await call('GET', `/grants?kind=project&id=${projectId}`, undefined, { 'x-tenant-id': BYSTANDER })
  const ghost = await call('GET', `/grants?kind=project&id=p-social-no-such`, undefined, { 'x-tenant-id': BYSTANDER })
  assert.equal(asBystander.status, 404, 'invisible answers like nonexistent')
  assert.equal(ghost.status, 404)
  assert.equal(asBystander.json.error?.message ?? asBystander.json.message, ghost.json.error?.message?.replace('p-social-no-such', projectId) ?? ghost.json.message?.replace('p-social-no-such', projectId), 'the two 404s are indistinguishable')
})

test('grant: creation is the owner’s act; refusals are argued (link/S6, discussion/S2, unknown audience)', async () => {
  const { subject } = socialArena()
  const notOwner = await call('POST', '/grants', { subject, audience: { kind: 'org', orgId: AUDIENCE }, tier: 'view' }, { 'x-tenant-id': BYSTANDER })
  assert.equal(notOwner.status, 404, 'a non-owner cannot even see the subject — existence-hiding beats forbidden')
  // S6 lifted the link refusal — minting works and the SERVER mints the token
  // (a caller-supplied one is ignored; guessable tokens would be a wall with
  // a hole).
  const link = await call('POST', '/grants', { subject, audience: { kind: 'link', token: 'attacker-chosen' }, tier: 'view' }, { 'x-tenant-id': OWNER })
  assert.equal(link.status, 200)
  assert.notEqual(link.json.audience.token, 'attacker-chosen', 'the token is server-minted')
  assert.equal(store.revokeGrant(link.json.id, OWNER), 'ok', 'cleanup')
  // S2 lifted the discussion refusal: the kind is a full noun now, so an
  // unknown discussion id gets the ordinary existence-hiding 404.
  const disc = await call('POST', '/grants', { subject: { kind: 'discussion', id: 'd-no-such' }, audience: { kind: 'org', orgId: AUDIENCE }, tier: 'view' }, { 'x-tenant-id': OWNER })
  assert.equal(disc.status, 404, 'a nonexistent discussion subject 404s like any noun')
  const unknownAud = await call('POST', '/grants', { subject, audience: { kind: 'org', orgId: 'tenant-no-such' }, tier: 'view' }, { 'x-tenant-id': OWNER })
  assert.equal(unknownAud.status, 400, 'an unregistered audience is refused, not resolved (INV-9)')
  const ghost = await call('POST', '/grants', { subject: { kind: 'project', id: 'p-no-such' }, audience: { kind: 'org', orgId: AUDIENCE }, tier: 'view' }, { 'x-tenant-id': OWNER })
  assert.equal(ghost.status, 404)
})

test('grant: re-grant replaces (one live grant per subject×audience); note publishes; grantedTier reads the union', async () => {
  const { projectId, subject } = socialArena()
  const first = await call('POST', '/grants', { subject, audience: { kind: 'org', orgId: AUDIENCE }, tier: 'view' }, { 'x-tenant-id': OWNER })
  assert.equal(first.status, 200)
  assert.equal(store.grantedTier({ kind: 'project', id: projectId }, AUDIENCE), 'view')
  const second = await call('POST', '/grants', { subject, audience: { kind: 'org', orgId: AUDIENCE }, tier: 'propose', note: 'Tear it apart' }, { 'x-tenant-id': OWNER })
  assert.equal(second.status, 200)
  assert.equal(second.json.id, first.json.id, 'the same row, re-granted — no accretion')
  assert.equal(second.json.note, 'Tear it apart', 'a present note is the publish act')
  const list = await call('GET', `/grants?kind=project&id=${projectId}`, undefined, { 'x-tenant-id': OWNER })
  assert.equal(list.json.length, 1)
  assert.equal(store.grantedTier({ kind: 'project', id: projectId }, AUDIENCE), 'propose', 'the read-side hook reflects the replace')
})

test('grant: either party revokes, nobody else; revocation empties the roster and the tier', async () => {
  const { projectId, subject } = socialArena()
  const g1 = await call('POST', '/grants', { subject, audience: { kind: 'org', orgId: AUDIENCE }, tier: 'comment' }, { 'x-tenant-id': OWNER })
  const stranger = await call('DELETE', `/grants/${g1.json.id}`, undefined, { 'x-tenant-id': BYSTANDER })
  assert.equal(stranger.status, 404, 'a third party 404s like a nonexistent id — sequential ids must not be probeable')
  const decline = await call('DELETE', `/grants/${g1.json.id}`, undefined, { 'x-tenant-id': AUDIENCE })
  assert.equal(decline.status, 200, 'the audience may decline what was shared to them')
  assert.equal(store.grantedTier({ kind: 'project', id: projectId }, AUDIENCE), undefined)
  const gone = await call('DELETE', `/grants/${g1.json.id}`, undefined, { 'x-tenant-id': OWNER })
  assert.equal(gone.status, 404)
})

test('a grant OPENS its subject (SOCIAL-4): granted viewers pass the project wall and the session funnel; the seed scene is live', async () => {
  const { projectId, subject } = socialArena()
  const before = await call('GET', `/projects/${projectId}/contributions`, undefined, { 'x-tenant-id': AUDIENCE })
  assert.equal(before.status, 404, 'pre-grant, the private project is invisible')
  await call('POST', '/grants', { subject, audience: { kind: 'org', orgId: AUDIENCE }, tier: 'view' }, { 'x-tenant-id': OWNER })
  const after = await call('GET', `/projects/${projectId}/contributions`, undefined, { 'x-tenant-id': AUDIENCE })
  assert.equal(after.status, 200, 'a granted viewer reads at any tier')
  const still = await call('GET', `/projects/${projectId}/contributions`, undefined, { 'x-tenant-id': BYSTANDER })
  assert.equal(still.status, 404, 'the wall stands for everyone else')

  // The session funnel: grant a seed session (owned by the default tenant) to
  // the audience org and the visibility funnel opens for its members.
  const { SESSIONS } = await import('../server/data/sessions.ts')
  const seedSession = SESSIONS.find((s) => !s.tenantId)
  assert.ok(seedSession, 'an unstamped seed session exists')
  assert.equal(store.sessionVisibleToTenant(seedSession!, AUDIENCE), false, 'pre-grant: another org cannot see it')
  const g = store.createGrant(
    { subject: { kind: 'session', id: seedSession!.id }, audience: { kind: 'org', orgId: AUDIENCE }, tier: 'view' },
    store.defaultTenantId(),
  )
  assert.ok(typeof g === 'object', 'the default tenant owns unstamped seeds and may share them')
  assert.equal(store.sessionVisibleToTenant(seedSession!, AUDIENCE), true, 'the session share is the flagship: replayable at view')

  // The seed social scene: Ada's org published p-insights to Grace's org — the
  // demo lands with one live cross-org share, no setup.
  const seeded = await call('GET', `/grants?kind=project&id=p-insights`, undefined, { 'x-tenant-id': 'tenant-beta' })
  assert.equal(seeded.status, 200)
  assert.ok(seeded.json.some((row: any) => row.note && row.grantedBy === 'Acme, Inc.'), 'the seeded publish rides with its note')

  // The flagship faces OWN the unstamped seeds for grants (one seat, two faces):
  // Ada-as-Acme reads the full roster and may share the flagship world — a
  // strict default-tenant owner check 403'd her on her own demo data (found
  // live in the running app, 2026-07-21).
  const asAcme = await call('GET', `/grants?kind=project&id=p-insights`, undefined, { 'x-tenant-id': 'tenant-acme' })
  assert.equal(asAcme.status, 200)
  assert.ok(asAcme.json.length >= 1, 'the flagship face reads the seed roster as owner')
  const acmeShares = await call(
    'POST', '/grants',
    { subject: { kind: 'project', id: 'p-insights' }, audience: { kind: 'org', orgId: 'tenant-reislab' }, tier: 'view' },
    { 'x-tenant-id': 'tenant-acme' },
  )
  assert.equal(acmeShares.status, 200, 'the flagship face may share the flagship world')
  assert.equal(store.revokeGrant(acmeShares.json.id, 'tenant-acme'), 'ok', 'cleanup: the granter revokes')
})

test('a grant LISTS its subject (shared-with-me): redacted public face, own:false, live on revoke', async () => {
  // Seed path: the seeded grant puts p-insights in Grace's org's /projects list
  // as the redacted visitor face — no raw tenant id, no owner-scoped fields.
  const seedList = await call('GET', '/projects', undefined, { 'x-tenant-id': 'tenant-beta' })
  assert.equal(seedList.status, 200)
  const row = seedList.json.find((p: any) => p.id === 'p-insights')
  assert.ok(row, 'the granted seed project rides the audience’s list')
  assert.equal(row.own, false, 'visitor affordances')
  assert.equal(row.tenantId, undefined, 'raw owner tenant never crosses')
  assert.deepEqual([row.sessionIds, row.contexts, row.instructions], [[], [], ''], 'owner-scoped fields emptied')
  const noGrant = await call('GET', '/projects', undefined, { 'x-tenant-id': BYSTANDER })
  assert.ok(!noGrant.json.some((p: any) => p.id === 'p-insights'), 'no grant, no listing')

  // Created path: a runtime project granted to the audience rides the graph's
  // extraProjects projection the same way, and LEAVES on revoke.
  const { projectId, subject } = socialArena()
  const g = await call('POST', '/grants', { subject, audience: { kind: 'org', orgId: AUDIENCE }, tier: 'view' }, { 'x-tenant-id': OWNER })
  assert.equal(g.status, 200)
  const graph = await call('GET', '/relations', undefined, { 'x-tenant-id': AUDIENCE })
  const extra = graph.json.extraProjects.find((p: any) => p.id === projectId)
  assert.ok(extra, 'the granted created project rides the audience’s graph')
  assert.equal(extra.own, false)
  assert.equal(extra.tenantId, undefined)
  await call('DELETE', `/grants/${g.json.id}`, undefined, { 'x-tenant-id': OWNER })
  const after = await call('GET', '/relations', undefined, { 'x-tenant-id': AUDIENCE })
  assert.ok(!after.json.extraProjects.some((p: any) => p.id === projectId), 'a revoked grant leaves the list')
})

test('S5: a tier ESCALATION re-rings the audience; a lateral re-grant stays silent', async () => {
  const { projectId, subject } = socialArena()
  await call('POST', '/grants', { subject, audience: { kind: 'org', orgId: AUDIENCE }, tier: 'comment' }, { 'x-tenant-id': OWNER })
  const bells = () => store.listNotifications(AUDIENCE).filter((x) => x.kind === 'social.shared' && x.subjectId === projectId).length
  const afterMint = bells()
  assert.ok(afterMint >= 1, 'the mint rings')
  await call('POST', '/grants', { subject, audience: { kind: 'org', orgId: AUDIENCE }, tier: 'comment' }, { 'x-tenant-id': OWNER })
  assert.equal(bells(), afterMint, 'a lateral re-grant is silence over noise')
  await call('POST', '/grants', { subject, audience: { kind: 'org', orgId: AUDIENCE }, tier: 'propose' }, { 'x-tenant-id': OWNER })
  assert.equal(bells(), afterMint + 1, 'a widened capability is news — the escalation re-rings')
})

test('the substrate stays kind-generic: social.ts never branches on an entity kind', async () => {
  const { readFile } = await import('node:fs/promises')
  const src = await readFile(new URL('../contract/social.ts', import.meta.url), 'utf8')
  // The kinds may be DECLARED (the const array) but never CONSULTED — no
  // comparison or switch against a specific noun outside the declaration.
  const body = src.replace(/export const SOCIAL_ENTITY_KINDS[\s\S]*?\] as const/, '')
  for (const kind of SOCIAL_ENTITY_KINDS) {
    assert.ok(
      !new RegExp(`===\\s*'${kind}'|case\\s+'${kind}'`).test(body),
      `contract/social.ts must not branch on entity kind '${kind}' (orthogonality rule)`,
    )
  }
})

test('SOCIAL-5: a session carries VIEWER-RELATIVE ownership — reads widen, the share door does not', async () => {
  // The share configuration hangs off ownership, not readability: a granted
  // visitor opens a shared conversation and must not see (or change) who else
  // it is shared with. The projection says so on the wire — the UI never infers
  // it (UI-12: no asserted status a registry actually owns).
  const { SESSIONS } = await import('../server/data/sessions.ts')
  // A DIFFERENT seed than the SOCIAL-4 walk above shares — module state is
  // shared across tests in this file, so a self-contained walk needs its own.
  const seed = SESSIONS.filter((s) => !s.tenantId)[1]
  assert.ok(seed, 'a second unstamped seed session exists')
  const ref = { kind: 'session', id: seed!.id } as const

  const owner = await call('GET', `/sessions/${seed!.id}`, undefined, { 'x-tenant-id': store.defaultTenantId() })
  assert.equal(owner.status, 200)
  assert.equal(owner.json.own, true, 'the owner reads own:true')

  // Pre-grant the visitor cannot even open it (existence-hiding).
  const walled = await call('GET', `/sessions/${seed!.id}`, undefined, { 'x-tenant-id': AUDIENCE })
  assert.equal(walled.status, 404, 'pre-grant: walled')

  store.createGrant({ subject: ref, audience: { kind: 'org', orgId: AUDIENCE }, tier: 'co-own' }, store.defaultTenantId())
  const visitor = await call('GET', `/sessions/${seed!.id}`, undefined, { 'x-tenant-id': AUDIENCE })
  assert.equal(visitor.status, 200, 'the grant opens the READ')
  assert.notEqual(visitor.json.own, true, '…and never ownership — even at the TOP tier')

  // The list is the ownership list by construction: a shared session is
  // readable by id but is not the visitor's, so it stays out of their Recents.
  const list = await call('GET', '/sessions', undefined, { 'x-tenant-id': AUDIENCE })
  assert.ok(!list.json.some((s: { id: string }) => s.id === seed!.id), 'a shared session is not in the visitor’s list')
  const ownList = await call('GET', '/sessions', undefined, { 'x-tenant-id': store.defaultTenantId() })
  assert.ok(
    ownList.json.every((s: { own?: boolean }) => s.own === true),
    'every row of a tenant-scoped list is owned — the flag is a fact there, not an inference',
  )
})
