/** Tenant-scoped projects via the relation graph (F2 / PD9 — identity slice 3a).
 *  Created projects live in `graph.extraProjects`; the shared reducer is tenant-agnostic,
 *  so the server stamps the creator's tenant on apply and `relationGraph(tenantId)`
 *  PROJECTS the graph to that tenant. Since the demo-accounts split
 *  (docs/demo-accounts.md) the SEED projects are themselves distributed across
 *  tenants, so the default reader gets the default SLICE — its own seeds + its
 *  created projects — never another account's. The broadcast is gated on the
 *  acting tenant, and an op targeting a project the caller doesn't own is
 *  refused (opTargetsForeignProject).
 *
 *  Order matters: the default-slice test runs FIRST, while the store holds only
 *  seed + default-tenant content; the isolation tests then introduce non-default
 *  projects. The header-driven route boundary is proven in server/routes/capability-remote.test.ts. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from './index.ts'
import { mcpConnectionCreationId } from '../mcpConnections.ts'

const mkCreate = (id, name, sessionId) => ({
  kind: 'create-project',
  projectId: id,
  projectName: name,
  projectDescription: '',
  ...(sessionId ? { sessionId, sessionTitle: 'S' } : {}),
})

test('the default-tenant projection is the default SLICE (its own seeds + creations, no other account’s)', () => {
  // Runs first: the store holds only seed + this default-tenant project.
  store.applyRelationOp(mkCreate('proj-def', 'Default one', 'sess-def')) // no tenant ⇒ default
  const full = store.relationGraph()
  const def = store.relationGraph('tenant-personal') // the mock backend's default tenant
  assert.ok(def.extraProjects.some((p) => p.id === 'proj-def'), 'a default-created project is visible to the default reader')
  assert.equal(def.sessionProject['sess-def'], 'proj-def', 'its session→project join too')
  // The default tenant's SEED joins survive the projection verbatim…
  assert.equal(def.artifactProject['a1'], full.artifactProject['a1'], 'a default seed artifact join stays (p-insights)')
  assert.equal(def.artifactProject['a16'], full.artifactProject['a16'], 'and the platform ones (p-infra)')
  // …while the other demo accounts' seed joins are projected OUT (F2/PD9).
  assert.ok(!('a6' in def.artifactProject), "Maya's seed artifact joins are projected out (p-growth)")
  assert.ok(!('a11' in def.artifactProject), "Noor's seed artifact joins are projected out (p-brand)")
})

test('a created project is stamped with the caller tenant; relationGraph projects to it', () => {
  store.applyRelationOp(mkCreate('proj-a', 'Alpha', 'sess-a'), 'tenant-pa')
  store.applyRelationOp(mkCreate('proj-b', 'Beta', 'sess-b'), 'tenant-pb')

  const full = store.relationGraph()
  assert.equal(full.extraProjects.find((p) => p.id === 'proj-a').tenantId, 'tenant-pa', 'stamped with the caller tenant')

  const a = store.relationGraph('tenant-pa')
  assert.ok(a.extraProjects.some((p) => p.id === 'proj-a'), 'sees its own project')
  assert.ok(!a.extraProjects.some((p) => p.id === 'proj-b'), 'not the other tenant’s project')
  assert.equal(a.sessionProject['sess-a'], 'proj-a', 'its session→project join is present')
  assert.ok(!('sess-b' in a.sessionProject), 'the other tenant’s join is projected out')
  // The default reader (now that non-default projects exist) does NOT see them.
  const def = store.relationGraph('tenant-personal')
  assert.ok(!def.extraProjects.some((p) => p.id === 'proj-a' || p.id === 'proj-b'), 'default reader excludes non-default projects')
})

test('the canonical project registry includes each authored row once and preserves public projection walls', () => {
  const owner = 'tenant-project-registry-owner'
  const audience = 'tenant-beta'
  const bystander = 'tenant-project-registry-bystander'
  const projectId = 'proj-registry-shared'

  store.applyRelationOp(
    mkCreate(projectId, 'Registry shared', 'private-session'),
    owner,
  )
  store.applyRelationOp({
    kind: 'scope-context',
    projectId,
    projectName: 'Registry shared',
    context: { id: 'private-context', label: 'Owner secret', kind: 'connector' },
  }, owner)
  store.applyRelationOp({
    kind: 'set-project-instructions',
    projectId,
    projectName: 'Registry shared',
    instructions: 'Owner-only instructions',
  }, owner)
  store.applyRelationOp({
    kind: 'set-project-description',
    projectId,
    projectName: 'Registry shared',
    description: 'Owner public description',
  }, owner)
  store.applyRelationOp({ kind: 'share-project', projectId, projectName: 'Registry shared', shared: true }, owner)
  const directoryRow = store.projectDirectory(bystander).find((p) => p.id === projectId)
  assert.equal(directoryRow?.description, 'Owner public description', 'the public directory uses the current description overlay')
  const ownerProjection = store.relationGraph(owner)
  const ownerGraph = ownerProjection.extraProjects.find((p) => p.id === projectId)
  assert.equal(ownerProjection.projectDescriptions[projectId], 'Owner public description')
  assert.deepEqual([ownerGraph?.sessionIds, ownerProjection.projectContexts[projectId], ownerProjection.projectInstructions[projectId]], [['private-session'], [{ id: 'private-context', label: 'Owner secret', kind: 'connector' }], 'Owner-only instructions'])
  store.applyRelationOp({
    kind: 'set-project-description',
    projectId,
    projectName: 'Registry shared',
    description: '',
  }, owner)

  const owned = store.listProjects(owner).filter((p) => p.id === projectId)
  assert.equal(owned.length, 1, 'an authored project has one canonical registry row')
  assert.equal(owned[0]?.own, true, 'the project owner receives write-grade own')
  assert.equal(owned[0]?.description, '', 'an explicitly empty current description is preserved')

  const shared = store.listProjects(bystander).filter((p) => p.id === projectId)
  assert.equal(shared.length, 1, 'shared-everyone visibility has one canonical row')
  assert.equal(shared[0]?.own, false)
  assert.equal(shared[0]?.tenantId, undefined, 'foreign owner tenant is redacted')
  assert.deepEqual(
    [shared[0]?.sessionIds, shared[0]?.contexts, shared[0]?.instructions, shared[0]?.scheduled],
    [[], [], '', []],
    'foreign shared rows redact owner-scoped fields',
  )

  // Sharing is an independent public state. Revoke it before exercising the
  // narrower explicit-grant projection below, otherwise the shared-everyone
  // row would correctly survive grant revocation.
  store.applyRelationOp({ kind: 'share-project', projectId, projectName: 'Registry shared', shared: false }, owner)

  const granted = store.createGrant({
    subject: { kind: 'project', id: projectId },
    audience: { kind: 'org', orgId: audience },
    tier: 'view',
  }, owner)
  assert.ok(granted && typeof granted === 'object', 'the explicit audience grant is created')
  const grantedRows = store.listProjects(audience).filter((p) => p.id === projectId)
  assert.equal(grantedRows.length, 1, 'an explicit grant has one canonical row')
  assert.equal(grantedRows[0]?.own, false)
  assert.equal(grantedRows[0]?.tenantId, undefined)
  assert.equal(grantedRows[0]?.description, '', 'grant-only projection carries current empty description')

  assert.equal(store.listProjects('tenant-project-registry-hidden').some((p) => p.id === projectId), false, 'private/ungranted projects stay absent')
  assert.equal(store.listProjects(owner).filter((p) => p.id === projectId).length, 1, 'owner does not receive a duplicate through sharing')

  const grantSearchId = 'proj-registry-grant-search'
  store.applyRelationOp(mkCreate(grantSearchId, 'Grant-only searchable project', ''), owner)
  store.applyRelationOp({ kind: 'set-project-description', projectId: grantSearchId, projectName: 'Grant-only searchable project', description: 'Grant-only current prose' }, owner)
  const searchGrant = store.createGrant({
    subject: { kind: 'project', id: grantSearchId },
    audience: { kind: 'org', orgId: audience },
    tier: 'view',
  }, owner)
  assert.ok(searchGrant && typeof searchGrant === 'object')
  const grantSearch = store.searchAll(audience, 'Grant-only searchable project')
  const grantProjectHits = grantSearch.groups.flatMap((group) => group.hits).filter((hit) => hit.id === grantSearchId)
  assert.equal(grantProjectHits.length, 1, 'grant-only search exposes one shared-project hit')
  assert.equal(grantSearch.groups.find((group) => group.type === 'project'), undefined, 'grant-only row is not misclassified as owned')
})

test('search emits one owned hit when the canonical project registry includes authored rows', () => {
  const tenant = 'tenant-project-search-owner'
  const id = 'proj-search-canonical'
  store.applyRelationOp(mkCreate(id, 'Canonical Search Project', ''), tenant)
  const hits = store.searchAll(tenant, 'Canonical Search Project').groups
    .flatMap((group) => group.hits)
    .filter((hit) => hit.type === 'project' && hit.id === id)
  assert.equal(hits.length, 1, 'canonical authored project is not duplicated by search composition')
})

test('relation.applied is gated on the ACTING tenant, incl. null-projectId unfile/unlink ops', () => {
  // A create-project event stamped tenant-pa: visible to it, not another.
  const created = { type: 'relation.applied', op: mkCreate('proj-a', 'Alpha'), by: 'user', tenantId: 'tenant-pa' }
  assert.equal(store.eventVisibleToTenant(created, 'tenant-pa'), true)
  assert.equal(store.eventVisibleToTenant(created, 'tenant-pb'), false)

  // The review's HIGH: an UNFILE (projectId:null) still carries the project NAME. Gating on
  // the stamped tenant (not the op) keeps it from leaking to a foreign tenant.
  const unfile = {
    type: 'relation.applied',
    op: { kind: 'file-session', sessionId: 'sess-a', sessionTitle: 'S', projectId: null, projectName: 'AcmeSecretProject' },
    by: 'user',
    tenantId: 'tenant-pa',
  }
  assert.equal(store.eventVisibleToTenant(unfile, 'tenant-pa'), true, 'the acting tenant sees its own unfile')
  assert.equal(store.eventVisibleToTenant(unfile, 'tenant-pb'), false, 'a foreign tenant does NOT — the project name is not leaked')

  // An unstamped event (e.g. a legacy/standing emit) defaults to the default tenant.
  const unstamped = { type: 'relation.applied', op: mkCreate('x', 'X'), by: 'standing' }
  assert.equal(store.eventVisibleToTenant(unstamped, 'tenant-personal'), true)
  assert.equal(store.eventVisibleToTenant(unstamped, 'tenant-pb'), false)
})

test('opDeniedForTenant refuses foreign-project targets, colliding create-project, and foreign-session subjects', () => {
  // proj-a is tenant-pa's (created above). A tenant-pb caller can't file into it.
  const fileIntoA = { kind: 'file-session', sessionId: 's', sessionTitle: 'S', projectId: 'proj-a', projectName: 'Alpha' }
  assert.equal(store.opDeniedForTenant(fileIntoA, 'tenant-pb'), true, 'foreign destination ⇒ refused')
  assert.equal(store.opDeniedForTenant(fileIntoA, 'tenant-pa'), false, 'the owner may target it')

  // A create-project COLLIDING with a foreign id is refused (NOT exempt) — the reducer's
  // re-file path would otherwise inject the caller's session into the victim's project.
  const collide = { kind: 'create-project', projectId: 'proj-a', projectName: 'x', projectDescription: '', sessionId: 'sx', sessionTitle: 'S' }
  assert.equal(store.opDeniedForTenant(collide, 'tenant-pb'), true, 'colliding foreign create-project ⇒ refused')
  // A create-project with a genuinely NEW id is allowed (resolves to no existing project).
  assert.equal(store.opDeniedForTenant(mkCreate('proj-fresh', 'Fresh'), 'tenant-pb'), false, 'a brand-new id is allowed')

  // Subject check: a tenant can't unfile (projectId:null) another tenant's SESSION.
  const owned = store.createSession('pa owned session', 'tenant-pa')
  const unfileForeign = { kind: 'file-session', sessionId: owned.id, sessionTitle: 'S', projectId: null, projectName: 'x' }
  assert.equal(store.opDeniedForTenant(unfileForeign, 'tenant-pb'), true, 'unfiling a foreign session ⇒ refused')
  assert.equal(store.opDeniedForTenant(unfileForeign, 'tenant-pa'), false, 'the session owner may unfile it')

  // An UNKNOWN/ghost projectId is NOT un-owned: the read projection buckets ghost-keyed
  // rows to the DEFAULT tenant, so a non-default caller keying one would inject into the
  // default view. Refuse it for a non-default tenant; the default tenant owns that namespace.
  const ghostScope = { kind: 'scope-context', projectId: 'ghost-xyz', projectName: 'x', context: { id: 'c', label: 'omega-secret', kind: 'connector' } }
  assert.equal(store.opDeniedForTenant(ghostScope, 'tenant-pb'), true, 'a non-default tenant cannot key a ghost-id project row')
  assert.equal(store.opDeniedForTenant(ghostScope, 'tenant-personal'), false, 'the default tenant may key rows in its own (default) namespace')

  // The EMPTY-STRING projectId edge (a falsy value the truthy check missed): it's a real
  // key that buckets to the default tenant on read, so a non-default tenant must be refused.
  const emptyScope = { kind: 'scope-context', projectId: '', projectName: 'x', context: { id: 'c', label: 'omega-secret', kind: 'connector' } }
  assert.equal(store.opDeniedForTenant(emptyScope, 'tenant-pb'), true, 'a non-default tenant cannot key an empty-string-id project row')
  assert.equal(store.opDeniedForTenant(emptyScope, 'tenant-personal'), false, 'the default tenant owns the default (incl. empty-string) namespace')
})

test('an explicit UNFILE survives the projection — `null` is not a project id to gate on', () => {
  // `sessionProject[sid] === null` is the explicit "unfiled" override
  // (contract/api.ts), distinct from an absent key ("no override"). The value
  // filter used to run `projVisible(null)`, which found no project and fell
  // through to `seedVisibleTo` — true only for the default/flagship tenant — so
  // every other tenant's unfile was silently stripped from the graph it reads.
  // Latent (a non-flagship tenant's sessions carry no seed project for the
  // override to contradict) but wrong, and found by typechecking `server/`.
  const T = 'tenant-unfile'
  const s = store.createSession('unfile probe', T)
  store.applyRelationOp(
    { kind: 'create-project', projectId: 'p-unfile', projectName: 'Unfile probe', projectDescription: '' },
    T,
  )
  store.applyRelationOp({ kind: 'file-session', sessionId: s.id, projectId: 'p-unfile', projectName: 'Unfile probe' }, T)
  assert.equal(store.relationGraph(T).sessionProject[s.id], 'p-unfile', 'filed first')

  // Now unfile it explicitly — `file-session` with a null project IS the unfile.
  store.applyRelationOp({ kind: 'file-session', sessionId: s.id, projectId: null, projectName: '' }, T)
  const scoped = store.relationGraph(T).sessionProject
  assert.ok(s.id in scoped, 'the explicit unfile must not be filtered away')
  assert.equal(scoped[s.id], null, '…and it reads as null, not as a stale project id')
})

test('a scope-context source must belong to the acting tenant', () => {
  const caller = 'tenant-context-source-caller'
  const foreign = 'tenant-context-source-foreign'
  const projectId = 'p-context-source-owner'
  const sourceId = mcpConnectionCreationId(foreign, 'foreign-source')
  store.applyRelationOp({ kind: 'create-project', projectId, projectName: 'Source owner', projectDescription: '' }, caller)
  store.createMcpConnection({
    id: sourceId, label: 'Foreign MCP', endpoint: 'https://foreign.example/mcp', authentication: 'none',
  }, foreign)
  const ownSourceId = mcpConnectionCreationId(caller, 'own-source')
  store.createMcpConnection({
    id: ownSourceId, label: 'Own MCP', endpoint: 'https://own.example/mcp', authentication: 'none',
  }, caller)
  const op = {
    kind: 'scope-context' as const,
    projectId,
    projectName: 'Source owner',
    context: { kind: 'connector' as const, label: 'Foreign MCP', meta: 'MCP server', source: { kind: 'mcp' as const, id: sourceId } },
  }
  assert.equal(store.opDeniedForTenant(op, caller), true, 'a caller cannot scope another tenant’s external MCP identity')
  assert.equal(store.opDeniedForTenant(op, foreign), true, 'the foreign source owner cannot write into the caller’s project')
  assert.throws(() => store.applyRelationOp(op, caller), /unavailable/, 'the canonical store seam repeats the source ownership fence')
  assert.equal(store.opDeniedForTenant({
    ...op,
    context: { ...op.context, label: 'Own MCP', source: { kind: 'mcp', id: ownSourceId } },
  }, caller), false, 'the caller may scope its own external MCP identity')
  assert.equal(store.relationGraph(caller).projectContexts[projectId], undefined, 'the rejected source never enters the graph')
})
