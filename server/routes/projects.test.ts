/** Direct Project creation: server-owned identity, safe retries, strict input,
 * and the same namespace wall as consent-gated relation creation. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { call } from '../testkit/http.ts'

let n = 0
const cookieOf = (r: { headers: Record<string, string> }) => r.headers['set-cookie']?.split(';')[0] ?? ''

test('POST /projects mints opaque server identity and preserves same-name creations', async () => {
  const name = `Parallel name ${(n += 1)}`
  const first = await call('POST', '/projects', { name, description: 'First intent' })
  const second = await call('POST', '/projects', { name, description: 'Second intent' })

  assert.equal(first.status, 201)
  assert.equal(second.status, 201)
  assert.match(first.json.project.id, /^p-[0-9a-f-]{36}$/)
  assert.notEqual(first.json.project.id, second.json.project.id)
  assert.equal(first.json.project.description, 'First intent')
  assert.equal(second.json.project.description, 'Second intent')
  assert.ok(first.json.graph.extraProjects.some((p: { id: string }) => p.id === first.json.project.id))

  const listed = await call('GET', '/projects')
  assert.equal(listed.status, 200)
  assert.equal(listed.json.filter((p: { id: string }) => p.id === first.json.project.id).length, 1, 'GET /projects is the canonical authored registry')
  assert.equal(listed.json.find((p: { id: string; own?: boolean }) => p.id === first.json.project.id)?.own, true)

  const graph = await call('GET', '/relations')
  assert.equal(
    graph.json.extraProjects.filter((p: { name: string }) => p.name === name).length,
    2,
    'same-name intent is never collapsed by a browser-derived id collision',
  )
})

test('GET /projects keeps org-member visitor and org-owner write-grade own flags', async () => {
  const suffix = `${Date.now()}-${(n += 1)}`
  const signup = async (name: string) => {
    const email = `${name.toLowerCase().replace(/\s+/g, '-')}-${suffix}@project-orgs.example`
    const response = await call('POST', '/auth/signup', { name, email, password: `${name}-password-1` })
    assert.equal(response.status, 200)
    return { email, cookie: cookieOf(response) }
  }
  const founder = await signup('Project Registry Founder')
  const member = await signup('Project Registry Member')
  const org = await call('POST', '/orgs', { name: `Project Registry Org ${suffix}` }, { cookie: founder.cookie })
  assert.equal(org.status, 201)
  const invite = await call('POST', `/orgs/${org.json.id}/invites`, { email: member.email }, { cookie: founder.cookie })
  assert.equal(invite.status, 201)
  const pending = await call('GET', '/me/invites', undefined, { cookie: member.cookie })
  const accepted = await call('POST', `/me/invites/${pending.json[0].id}/accept`, undefined, { cookie: member.cookie })
  assert.equal(accepted.status, 200)

  const created = await call('POST', '/projects', { name: `Org canonical ${suffix}`, ownerTenantId: org.json.id }, { cookie: member.cookie })
  assert.equal(created.status, 201)
  const memberList = await call('GET', '/projects', undefined, { cookie: member.cookie })
  const founderList = await call('GET', '/projects', undefined, { cookie: founder.cookie })
  const memberRow = memberList.json.find((p: { id: string }) => p.id === created.json.project.id)
  const founderRow = founderList.json.find((p: { id: string }) => p.id === created.json.project.id)
  assert.ok(memberRow)
  assert.ok(founderRow)
  assert.equal(memberRow.own, false, 'an org member sees the project but cannot write-grade own it')
  assert.equal(founderRow.own, true, 'an org owner receives write-grade own')
})

test('GET /projects exposes shared and explicit-grant rows with redacted public fields, then removes revoked grants', async () => {
  const owner = 'tenant-project-list-owner'
  const projectId = `p-project-list-${(n += 1)}`
  const created = await call('POST', '/projects', { name: `Project list shared ${projectId}`, description: 'Current public description' }, { 'x-tenant-id': owner })
  assert.equal(created.status, 201)
  const id = created.json.project.id as string
  const scoped = await call('POST', '/relations/ops', {
    op: {
      kind: 'scope-context', projectId: id, projectName: created.json.project.name,
      context: { id: 'project-list-private-context', label: 'Owner secret', kind: 'connector' },
    },
  }, { 'x-tenant-id': owner })
  assert.equal(scoped.status, 200)
  const instructions = await call('POST', '/relations/ops', {
    op: { kind: 'set-project-instructions', projectId: id, projectName: created.json.project.name, instructions: 'Owner-only instructions' },
  }, { 'x-tenant-id': owner })
  assert.equal(instructions.status, 200)
  const ownerGraph = await call('GET', '/relations', undefined, { 'x-tenant-id': owner })
  const ownerRow = ownerGraph.json.extraProjects.find((p: { id: string }) => p.id === id)
  assert.ok(ownerRow)
  assert.deepEqual([ownerGraph.json.projectContexts[id], ownerGraph.json.projectInstructions[id]], [[{ id: 'project-list-private-context', label: 'Owner secret', kind: 'connector' }], 'Owner-only instructions'])
  const share = await call('POST', '/relations/ops', {
    op: { kind: 'share-project', projectId: id, projectName: created.json.project.name, shared: true },
  }, { 'x-tenant-id': owner })
  assert.equal(share.status, 200)
  const foreign = await call('GET', '/projects', undefined, { 'x-tenant-id': 'tenant-project-list-bystander' })
  const sharedRow = foreign.json.find((p: { id: string }) => p.id === id)
  assert.ok(sharedRow, 'shared-everyone project is in the canonical list')
  assert.equal(sharedRow.own, false)
  assert.equal(sharedRow.tenantId, undefined)
  assert.deepEqual([sharedRow.sessionIds, sharedRow.contexts, sharedRow.instructions, sharedRow.scheduled], [[], [], '', []])
  assert.equal(sharedRow.description, 'Current public description')

  const unshare = await call('POST', '/relations/ops', {
    op: { kind: 'share-project', projectId: id, projectName: created.json.project.name, shared: false },
  }, { 'x-tenant-id': owner })
  assert.equal(unshare.status, 200)

  const grant = await call('POST', '/grants', {
    subject: { kind: 'project', id }, audience: { kind: 'org', orgId: 'tenant-beta' }, tier: 'view',
  }, { 'x-tenant-id': owner })
  assert.equal(grant.status, 200)
  const audience = await call('GET', '/projects', undefined, { 'x-tenant-id': 'tenant-beta' })
  const grantedRow = audience.json.find((p: { id: string }) => p.id === id)
  assert.ok(grantedRow)
  assert.equal(grantedRow.own, false)
  assert.equal(grantedRow.tenantId, undefined)
  assert.equal(grantedRow.description, 'Current public description')
  const revoked = await call('DELETE', `/grants/${grant.json.id}`, undefined, { 'x-tenant-id': owner })
  assert.equal(revoked.status, 200)
  const after = await call('GET', '/projects', undefined, { 'x-tenant-id': 'tenant-beta' })
  assert.equal(after.json.some((p: { id: string }) => p.id === id), false, 'revoked explicit grant leaves the canonical list')
})

test('POST /projects replays one logical creation without minting again', async () => {
  const name = `Retry project ${(n += 1)}`
  const key = `project-create-${n}`
  const before = await call('GET', '/relations')
  const first = await call('POST', '/projects', { name }, { 'idempotency-key': key })
  const retry = await call('POST', '/projects', { name }, { 'idempotency-key': key })
  const after = await call('GET', '/relations')

  assert.equal(first.status, 201)
  assert.deepEqual(retry.json, first.json)
  assert.equal(retry.headers['idempotency-replayed'], 'true')
  assert.equal(after.json.revision, before.json.revision + 1)
  assert.equal(after.json.extraProjects.filter((p: { name: string }) => p.name === name).length, 1)
})

test('POST /projects validates bounded fields and existence-hides an unavailable owner', async () => {
  assert.equal((await call('POST', '/projects', { name: '' })).status, 400)
  assert.equal((await call('POST', '/projects', { name: 'x'.repeat(161) })).status, 400)
  assert.equal((await call('POST', '/projects', { name: 'Okay', description: 4 })).status, 400)
  assert.equal((await call('POST', '/projects', { name: 'Okay', description: 'x'.repeat(10_001) })).status, 400)
  assert.equal((await call('POST', '/projects', { name: 'Okay', ownerTenantId: '' })).status, 400)
  assert.equal((await call('POST', '/projects', { name: 'Okay', ownerTenantId: 'tenant-foreign-project-owner' })).status, 404)
})
