/** Direct Artifact creation is a keyed, identity-owning command. It shares the
 * authored-body canonicalizer with proposal saves without sharing their
 * name/source replay identity. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { artifactCreationId } from '../artifactCreationIdentity.ts'
import { docBlockId } from '../documentIdentity.ts'
import { store } from '../store/index.ts'
import { call, callFresh } from '../testkit/http.ts'

let sequence = 0
const keyed = (key: string) => ({ 'idempotency-key': key })

const sessionCookie = (response: { headers: Record<string, string> }): string => {
  const token = response.headers['set-cookie']?.match(/uw_session=([^;,]+)/)?.[1] ?? ''
  return `uw_session=${token}`
}

test('POST /artifacts requires a key and returns its exact authored row plus revisioned graph', async () => {
  const tenant = `tenant-direct-artifact-${(sequence += 1)}`
  const key = `direct-artifact-create-${sequence}`
  const events: Array<{ type: string; artifactId?: string }> = []
  const unsubscribe = store.subscribe((event) => events.push(event))
  const before = await call('GET', '/relations', undefined, { 'x-tenant-id': tenant })
  const missingKey = await call('POST', '/artifacts', {
    name: 'must-not-exist.md', kind: 'doc', body: 'No unkeyed compatibility row.',
  }, { 'x-tenant-id': tenant })
  assert.equal(missingKey.status, 400)
  const oversizedKey = await call('POST', '/artifacts', {
    name: 'also-must-not-exist.md', kind: 'doc', body: 'No unbounded logical identity.',
  }, { 'x-tenant-id': tenant, ...keyed('x'.repeat(201)) })
  assert.equal(oversizedKey.status, 400)
  assert.equal((await call('GET', '/relations', undefined, { 'x-tenant-id': tenant })).json.revision, before.json.revision)

  const response = await call('POST', '/artifacts', {
    name: 'direct-notes.md', kind: 'doc', body: 'A direct authored document.', projectId: null,
  }, { 'x-tenant-id': tenant, ...keyed(key) })
  unsubscribe()

  assert.equal(response.status, 201)
  assert.equal(response.json.artifact.id, artifactCreationId(tenant, key))
  assert.equal(response.json.artifact.name, 'direct-notes.md')
  assert.equal(response.json.artifact.kind, 'doc')
  assert.equal(response.json.artifact.tenantId, tenant)
  assert.equal(response.json.artifact.own, true)
  assert.ok(response.json.graph.revision > before.json.revision)
  assert.ok(response.json.graph.extraArtifacts.some((row: { id: string }) => row.id === response.json.artifact.id))
  assert.deepEqual(
    events.filter((event) => event.type === 'artifact.changed'),
    [{ type: 'artifact.changed', artifactId: response.json.artifact.id }],
    'one scoped artifact hint represents the complete row/body/filing commit',
  )
  assert.equal(store.eventVisibleToTenant(events.at(-1) as any, tenant), true)
  assert.equal(store.eventVisibleToTenant(events.at(-1) as any, `${tenant}-foreign`), false)
  assert.deepEqual((await call('GET', '/artifact-content', undefined, { 'x-tenant-id': tenant })).json[response.json.artifact.id], {
    type: 'doc', title: 'direct-notes', revision: 0,
    blocks: [{ id: docBlockId(response.json.artifact.id, 0, 0), p: 'A direct authored document.' }],
  })
})

test('one key replays current represented truth before changed malformed input is parsed', async () => {
  const tenant = `tenant-direct-artifact-replay-${(sequence += 1)}`
  const key = `direct-artifact-replay-${sequence}`
  const headers = { 'x-tenant-id': tenant, ...keyed(key) }
  const created = await call('POST', '/artifacts', {
    name: 'before-replay.md', kind: 'doc', body: 'Original direct body.',
  }, headers)
  assert.equal(created.status, 201)
  const renamed = await call('PATCH', `/artifacts/${created.json.artifact.id}`, {
    name: 'current-represented-name.md', expectedRevision: 0,
  }, { 'x-tenant-id': tenant })
  assert.equal(renamed.status, 200)

  const replay = await call('POST', '/artifacts', {
    name: 42,
    kind: 'image',
    body: null,
    projectId: 'foreign-or-unknown-project',
  }, headers)
  assert.equal(replay.status, 200, 'exact identity answers before changed retry validation, even while the process cache is warm')
  assert.equal(replay.headers['idempotency-replayed'], undefined, 'domain replay is current truth, not a cached response envelope')
  assert.equal(replay.json.artifact.id, created.json.artifact.id)
  assert.equal(replay.json.artifact.name, 'current-represented-name.md')
  assert.equal(replay.json.artifact.metadataRevision, 1)
  assert.equal(store.listArtifacts(tenant).filter((row) => row.id === created.json.artifact.id).length, 1)
})

test('a stale account-transition source refuses the cookie-selected tenant before lookup or creation', async () => {
  const key = `direct-artifact-stale-account-${(sequence += 1)}`
  const maya = await call('POST', '/auth/login', {
    email: 'maya@growthworks.example',
    password: 'maya-demo-password',
  })
  assert.equal(maya.status, 200)
  const tenant = 'tenant-growthworks'
  const logicalId = artifactCreationId(tenant, key)
  const beforeIds = store.listArtifacts(tenant).map((artifact) => artifact.id)
  const events: Array<{ type: string; artifactId?: string }> = []
  const unsubscribe = store.subscribe((event) => events.push(event))
  const rejected = await call('POST', '/artifacts', {
    name: 'wrong-account.md',
    kind: 'doc',
    body: 'This must not land in the cookie-selected account.',
  }, {
    cookie: sessionCookie(maya),
    'x-account-transition-source': 'session:user-ada',
    ...keyed(key),
  })
  unsubscribe()

  assert.equal(rejected.status, 409)
  assert.equal(rejected.json.error.code, 'conflict')
  assert.deepEqual(store.listArtifacts(tenant).map((artifact) => artifact.id), beforeIds)
  assert.equal(store.listArtifacts(tenant).some((artifact) => artifact.id === logicalId), false)
  assert.deepEqual(events.filter((event) => event.type === 'artifact.changed' && event.artifactId === logicalId), [])
})

test('same-name distinct keys remain distinct and never alias relation-save replay identity', async () => {
  const tenant = `tenant-direct-artifact-collision-${(sequence += 1)}`
  const name = `same-name-${sequence}.md`
  const first = await call('POST', '/artifacts', {
    name, kind: 'doc', body: 'First direct body.',
  }, { 'x-tenant-id': tenant, ...keyed(`same-name-first-${sequence}`) })
  const second = await call('POST', '/artifacts', {
    name, kind: 'doc', body: 'Second direct body.',
  }, { 'x-tenant-id': tenant, ...keyed(`same-name-second-${sequence}`) })
  assert.equal(first.status, 201)
  assert.equal(second.status, 201)
  assert.notEqual(first.json.artifact.id, second.json.artifact.id)

  // The consent path deliberately uses the same sessionless provenance as
  // direct authoring. Its replay matcher must skip the reserved direct-ID
  // namespace rather than adopting either direct row by name + "Created here".
  const legacy = await call('POST', '/relations/ops', {
    op: {
      kind: 'save-artifact',
      artifact: { name, kind: 'doc', meta: 'Document', body: 'Consent-path body.' },
    },
  }, { 'x-tenant-id': tenant })
  assert.equal(legacy.status, 200)
  const legacyRow = legacy.json.extraArtifacts.find(
    (row: { id: string; name: string }) => row.name === name && !row.id.startsWith('artifact-new-'),
  )
  assert.ok(legacyRow)
  assert.notEqual(first.json.artifact.id, legacyRow.id)
  assert.notEqual(second.json.artifact.id, legacyRow.id)
  const rows = store.listArtifacts(tenant).filter((row) => row.name === name)
  assert.equal(rows.length, 3)
  const content = store.artifactContent(tenant)
  assert.equal((content[first.json.artifact.id] as any).blocks[0].p, 'First direct body.')
  assert.equal((content[second.json.artifact.id] as any).blocks[0].p, 'Second direct body.')
  assert.equal((content[legacyRow.id] as any).blocks[0].p, 'Consent-path body.')
})

test('invalid name/body/kind and unavailable filing targets fail before any artifact effect', async () => {
  const tenant = `tenant-direct-artifact-invalid-${(sequence += 1)}`
  const foreign = `tenant-direct-artifact-foreign-${sequence}`
  const project = await call('POST', '/projects', { name: `Foreign artifact project ${sequence}` }, { 'x-tenant-id': foreign })
  assert.equal(project.status, 201)
  const beforeGraph = await call('GET', '/relations', undefined, { 'x-tenant-id': tenant })
  const beforeBodies = structuredClone((await call('GET', '/artifact-content', undefined, { 'x-tenant-id': tenant })).json)
  const cases = [
    { name: '', kind: 'doc', body: 'Body.' },
    { name: 'bad-kind.bin', kind: 'image', body: 'Body.' },
    { name: 'blank.md', kind: 'doc', body: '   ' },
    { name: 'unknown.md', kind: 'doc', body: 'Body.', ownerTenantId: tenant },
    { name: 'mismatch.sheet', kind: 'sheet', body: { type: 'slides', slides: [{ title: 'Wrong', bullets: [] }] } },
    { name: 'foreign.sheet', kind: 'sheet', body: { type: 'sheet', columns: ['A'], rows: [['x']] }, projectId: project.json.project.id },
  ]
  for (const [index, body] of cases.entries()) {
    const response = await call('POST', '/artifacts', body, {
      'x-tenant-id': tenant,
      ...keyed(`invalid-direct-artifact-${sequence}-${index}`),
    })
    assert.equal(response.status, index === cases.length - 1 ? 404 : 400)
  }
  const afterGraph = await call('GET', '/relations', undefined, { 'x-tenant-id': tenant })
  const afterBodies = (await call('GET', '/artifact-content', undefined, { 'x-tenant-id': tenant })).json
  assert.equal(afterGraph.json.revision, beforeGraph.json.revision, 'refused requests do not advance graph ordering')
  assert.deepEqual(afterGraph.json.extraArtifacts, beforeGraph.json.extraArtifacts)
  assert.deepEqual(afterBodies, beforeBodies)
})

test('direct artifact filing follows canonical seed ownership and stamped org-owner walls', async () => {
  const adaLogin = await call('POST', '/auth/login', {
    email: 'ada@acme.example', password: 'ada-demo-password',
  })
  assert.equal(adaLogin.status, 200)
  const adaCookie = sessionCookie(adaLogin)
  const keyBase = `artifact-filing-owner-${(sequence += 1)}`

  const adaCreated = await call('POST', '/artifacts', {
    name: 'ada-insights-filing.md', kind: 'doc', body: 'Ada can file into her flagship seed project.', projectId: 'p-insights',
  }, { cookie: adaCookie, ...keyed(`${keyBase}-ada`) })
  assert.equal(adaCreated.status, 201, 'the signed-in Ada/Acme face owns the unstamped flagship seed project')
  assert.equal(adaCreated.json.artifact.projectId, 'p-insights')

  const defaultOwner = store.defaultTenantId()
  const defaultCreated = await call('POST', '/artifacts', {
    name: 'default-insights-filing.md', kind: 'doc', body: 'The default principal can file into its seed project.', projectId: 'p-insights',
  }, { 'x-tenant-id': defaultOwner, ...keyed(`${keyBase}-default`) })
  assert.equal(defaultCreated.status, 201, 'the default principal remains an owner of the same seed project')

  const foreign = await call('POST', '/artifacts', {
    name: 'foreign-insights-filing.md', kind: 'doc', body: 'This must not be filed.', projectId: 'p-insights',
  }, { 'x-tenant-id': `${defaultOwner}-foreign`, ...keyed(`${keyBase}-foreign`) })
  assert.equal(foreign.status, 404, 'seed visibility does not confer filing authority to a foreign tenant')

  const account = async (name: string) => {
    const email = `artifact-filing-${name.toLowerCase().replace(/\s+/g, '-')}-${keyBase}@example.test`
    const signup = await call('POST', '/auth/signup', { name, email, password: `${name}-password-1` })
    assert.equal(signup.status, 200)
    return { cookie: sessionCookie(signup), email }
  }
  const owner = await account('Org Owner')
  const member = await account('Org Member')
  const outsider = await account('Org Outsider')
  const org = (await call('POST', '/orgs', { name: `Artifact Filing ${keyBase}` }, { cookie: owner.cookie })).json
  assert.ok(org.id)
  assert.equal((await call('POST', `/orgs/${org.id}/invites`, { email: member.email }, { cookie: owner.cookie })).status, 201)
  const invite = (await call('GET', '/me/invites', undefined, { cookie: member.cookie })).json[0]
  assert.ok(invite)
  assert.equal((await call('POST', `/me/invites/${invite.id}/accept`, undefined, { cookie: member.cookie })).status, 200)

  const projectId = `p-artifact-filing-${keyBase}`
  const project = await call('POST', '/relations/ops', {
    op: { kind: 'create-project', projectId, projectName: `Artifact Filing Project ${keyBase}`, projectDescription: '', ownerTenantId: org.id },
  }, { cookie: member.cookie })
  assert.equal(project.status, 200)

  const orgOwnerCreate = await call('POST', '/artifacts', {
    name: 'org-owner-filed.md', kind: 'doc', body: 'Only the org owner may file.', projectId,
  }, { cookie: owner.cookie, ...keyed(`${keyBase}-org-owner`) })
  assert.equal(orgOwnerCreate.status, 201, 'a stamped project accepts its organization owner')

  const orgMemberCreate = await call('POST', '/artifacts', {
    name: 'org-member-filed.md', kind: 'doc', body: 'Members can see but not own the project.', projectId,
  }, { cookie: member.cookie, ...keyed(`${keyBase}-org-member`) })
  assert.equal(orgMemberCreate.status, 404, 'org membership grants visibility, not owner-grade filing authority')

  const orgOutsiderCreate = await call('POST', '/artifacts', {
    name: 'org-outsider-filed.md', kind: 'doc', body: 'An outsider must not file.', projectId,
  }, { cookie: outsider.cookie, ...keyed(`${keyBase}-org-outsider`) })
  assert.equal(orgOutsiderCreate.status, 404, 'a foreign tenant cannot file into an org project')
})
