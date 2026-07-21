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

test('the six social nouns = the relation graph\'s five entities + discussion', () => {
  const relationEnds = new Set(RELATIONS.flatMap((r) => r.ends))
  for (const kind of relationEnds) {
    assert.ok(
      (SOCIAL_ENTITY_KINDS as readonly string[]).includes(kind),
      `relation entity "${kind}" must be a social noun`,
    )
  }
  assert.deepEqual(
    [...SOCIAL_ENTITY_KINDS].sort(),
    [...relationEnds, 'discussion'].sort(),
    'social nouns are exactly the relation entities plus discussion',
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
  const link = await call('POST', '/grants', { subject, audience: { kind: 'link', token: 't' }, tier: 'view' }, { 'x-tenant-id': OWNER })
  assert.equal(link.status, 400, 'link audiences are declared but refused until the public phase (S6)')
  const disc = await call('POST', '/grants', { subject: { kind: 'discussion', id: 'd-1' }, audience: { kind: 'org', orgId: AUDIENCE }, tier: 'view' }, { 'x-tenant-id': OWNER })
  assert.equal(disc.status, 400, 'discussion subjects are a documented refusal until S2')
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
