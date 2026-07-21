/** S6 slice — link-token grants (docs/design/social-layer.md §4 "public").
 *  Invariants: the SERVER mints the token; "anyone with the link" means anyone
 *  SIGNED IN who redeems it (redeeming joins the audience at the grant's tier
 *  through the ordinary machinery); redemption is idempotent and SILENT (who
 *  clicked is nobody's business — the roster never crosses the wire); an
 *  unknown or ROTATED token is the existence-hiding 404 (one link per subject:
 *  re-minting rotates, killing the old link and every prior redemption). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../server/store.ts'
import { call } from './helpers/http.ts'

const OWNER = 'tenant-link-owner'
const REDEEMER = 'tenant-link-redeemer'
const BYSTANDER = 'tenant-link-bystander'
let n = 0

async function mint(tier: 'view' | 'comment' = 'view') {
  const projectId = `p-link-${(n += 1)}`
  store.applyRelationOp({ kind: 'create-project', projectId, projectName: `Link ${n}`, projectDescription: '' }, OWNER)
  const g = await call(
    'POST', '/grants',
    { subject: { kind: 'project', id: projectId }, audience: { kind: 'link', token: '' }, tier },
    { 'x-tenant-id': OWNER },
  )
  assert.equal(g.status, 200)
  return { projectId, token: g.json.audience.token as string, grantId: g.json.id as string }
}

test('redeem: a signed-in caller joins the audience at the tier; pre-redeem the wall stands', async () => {
  const { projectId, token } = await mint('view')
  const before = await call('GET', `/projects/${projectId}/contributions`, undefined, { 'x-tenant-id': REDEEMER })
  assert.equal(before.status, 404, 'holding an account is not holding the link')
  const redeemed = await call('POST', '/grants/redeem', { token }, { 'x-tenant-id': REDEEMER })
  assert.equal(redeemed.status, 200)
  assert.deepEqual(redeemed.json.subject, { kind: 'project', id: projectId }, 'the subject rides back — the client lands on its page')
  const after = await call('GET', `/projects/${projectId}/contributions`, undefined, { 'x-tenant-id': REDEEMER })
  assert.equal(after.status, 200, 'redeeming opened the subject')
  assert.equal(store.grantedTier({ kind: 'project', id: projectId }, REDEEMER), 'view', 'through the ordinary tier machinery')
  const again = await call('POST', '/grants/redeem', { token }, { 'x-tenant-id': REDEEMER })
  assert.equal(again.status, 200, 'idempotent')
  const still404 = await call('GET', `/projects/${projectId}/contributions`, undefined, { 'x-tenant-id': BYSTANDER })
  assert.equal(still404.status, 404, 'non-redeemers stay walled')
})

test('rotation: re-minting Link rotates the token — the old link AND its redemptions die', async () => {
  const { projectId, token } = await mint('view')
  await call('POST', '/grants/redeem', { token }, { 'x-tenant-id': REDEEMER })
  assert.equal(store.grantedTier({ kind: 'project', id: projectId }, REDEEMER), 'view')
  const rotated = await call(
    'POST', '/grants',
    { subject: { kind: 'project', id: projectId }, audience: { kind: 'link', token: '' }, tier: 'comment' },
    { 'x-tenant-id': OWNER },
  )
  assert.equal(rotated.status, 200)
  assert.notEqual(rotated.json.audience.token, token, 'a fresh token')
  const dead = await call('POST', '/grants/redeem', { token }, { 'x-tenant-id': BYSTANDER })
  assert.equal(dead.status, 404, 'the old link is the existence-hiding 404')
  assert.equal(store.grantedTier({ kind: 'project', id: projectId }, REDEEMER), undefined, 'prior redemptions died with it')
})

test('privacy: the redemption roster never crosses the wire', async () => {
  const { projectId, token } = await mint('view')
  await call('POST', '/grants/redeem', { token }, { 'x-tenant-id': REDEEMER })
  const roster = await call('GET', `/grants?kind=project&id=${projectId}`, undefined, { 'x-tenant-id': OWNER })
  const row = roster.json.find((g: any) => g.audience.kind === 'link')
  assert.ok(row, 'the owner sees the link row')
  assert.equal(row.redeemedBy, undefined, 'who clicked is nobody’s business')
})
