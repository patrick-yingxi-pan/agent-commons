import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from './index.ts'
import { accounts } from '../accounts.ts'
import type { ProjectChangedEvent, ServerEvent } from '../../contract/index.ts'

const OWNER = 'tenant-project-events-owner'
const AUDIENCE = 'tenant-beta'
const FOREIGN = 'tenant-project-events-foreign'

function emitted(act: () => unknown): ServerEvent[] {
  const events: ServerEvent[] = []
  const unsubscribe = store.subscribe((event) => events.push(event))
  try {
    act()
  } finally {
    unsubscribe()
  }
  return events
}

function projectEvents(events: ServerEvent[]): ProjectChangedEvent[] {
  return events.filter((event): event is ProjectChangedEvent => event.type === 'project.changed')
}

function createProject(id: string, description = 'Initial project prose') {
  store.applyRelationOp({
    kind: 'create-project',
    projectId: id,
    projectName: `Project event ${id}`,
    projectDescription: description,
  }, OWNER)
}

test('project.changed has a minimal wire shape and creation/private fields do not emit it', () => {
  const projectId = 'proj-events-private-fields'
  const create = emitted(() => createProject(projectId))
  assert.equal(projectEvents(create).length, 0, 'creation is represented by relation.applied only')
  const relation = create.find((event) => event.type === 'relation.applied')
  assert.ok(relation?.type === 'relation.applied')
  assert.equal(store.eventVisibleToTenant(relation, OWNER), true)
  assert.equal(store.eventVisibleToTenant(relation, FOREIGN), false, 'the creation relation remains actor-private')

  const instructions = emitted(() => store.applyRelationOp({
    kind: 'set-project-instructions',
    projectId,
    projectName: `Project event ${projectId}`,
    instructions: 'Owner-only instructions',
  }, OWNER))
  assert.equal(projectEvents(instructions).length, 0, 'private instructions do not invalidate public project prose')

  const context = emitted(() => store.applyRelationOp({
    kind: 'scope-context',
    projectId,
    projectName: `Project event ${projectId}`,
    context: { id: 'project-event-private-context', label: 'Owner secret', kind: 'connector' },
  }, OWNER))
  assert.equal(projectEvents(context).length, 0, 'private context filing does not emit a project.changed event')

  const share = emitted(() => store.applyRelationOp({
    kind: 'share-project', projectId, projectName: `Project event ${projectId}`, shared: true,
  }, OWNER))
  const publicEvent = projectEvents(share)[0]
  assert.ok(publicEvent)
  assert.deepEqual(Object.keys(publicEvent).sort(), ['projectId', 'scope', 'type'])
  assert.equal(store.eventVisibleToTenant(publicEvent, OWNER), true)
  assert.equal(store.eventVisibleToTenant(publicEvent, FOREIGN), true, 'public scope reaches every current viewer')
  const publicRelation = share.find((event) => event.type === 'relation.applied')
  assert.ok(publicRelation?.type === 'relation.applied')
  assert.equal(store.eventVisibleToTenant(publicRelation, FOREIGN), false, 'the public share operation itself remains actor-private')
})

test('share, public description, and unshare all invalidate the right replay scope', () => {
  const projectId = 'proj-events-public-transitions'
  createProject(projectId)

  const share = emitted(() => store.applyRelationOp({
    kind: 'share-project', projectId, projectName: `Project event ${projectId}`, shared: true,
  }, OWNER))
  assert.deepEqual(projectEvents(share), [{ type: 'project.changed', projectId, scope: 'public' }])
  const repeatedShare = emitted(() => store.applyRelationOp({
    kind: 'share-project', projectId, projectName: `Project event ${projectId}`, shared: true,
  }, OWNER))
  assert.equal(projectEvents(repeatedShare).length, 0, 'an unchanged public state emits no extra event')

  const description = emitted(() => store.applyRelationOp({
    kind: 'set-project-description', projectId, projectName: `Project event ${projectId}`, description: 'Current public prose',
  }, OWNER))
  assert.deepEqual(projectEvents(description), [{ type: 'project.changed', projectId, scope: 'public' }])

  const unshare = emitted(() => store.applyRelationOp({
    kind: 'share-project', projectId, projectName: `Project event ${projectId}`, shared: false,
  }, OWNER))
  assert.deepEqual(projectEvents(unshare), [{ type: 'project.changed', projectId, scope: 'public' }], 'unshare remains public-scoped because the prior state was public')

  const oldPublic = projectEvents(description)[0]!
  assert.equal(store.eventVisibleToTenant(oldPublic, OWNER), true)
  assert.equal(store.eventVisibleToTenant(oldPublic, AUDIENCE), true)
  assert.equal(store.eventVisibleToTenant(oldPublic, FOREIGN), true)
})

test('private grant description reaches owner and current audience, then fails replay after revoke', () => {
  const projectId = 'proj-events-grant-readers'
  createProject(projectId)
  const grant = store.createGrant({
    subject: { kind: 'project', id: projectId },
    audience: { kind: 'org', orgId: AUDIENCE },
    tier: 'view',
  }, OWNER)
  assert.ok(grant && typeof grant === 'object')

  const changed = emitted(() => store.applyRelationOp({
    kind: 'set-project-description', projectId, projectName: `Project event ${projectId}`, description: 'Audience-only current prose',
  }, OWNER))
  const event = projectEvents(changed)
  assert.deepEqual(event, [{ type: 'project.changed', projectId, scope: 'readers' }])
  assert.equal(store.eventVisibleToTenant(event[0]!, OWNER), true)
  assert.equal(store.eventVisibleToTenant(event[0]!, AUDIENCE), true)
  assert.equal(store.eventVisibleToTenant(event[0]!, FOREIGN), false)

  store.revokeGrant(grant.id, OWNER)
  assert.equal(store.eventVisibleToTenant(event[0]!, OWNER), true)
  assert.equal(store.eventVisibleToTenant(event[0]!, AUDIENCE), false, 'replay re-checks current grant visibility')
  assert.equal(store.eventVisibleToTenant(event[0]!, FOREIGN), false)
})

test('no-op, stale, and unknown project description changes emit no project event', () => {
  const projectId = 'proj-events-noops'
  createProject(projectId, 'Stable prose')

  const noOp = emitted(() => store.applyRelationOp({
    kind: 'set-project-description', projectId, projectName: `Project event ${projectId}`, description: 'Stable prose',
  }, OWNER))
  assert.equal(projectEvents(noOp).length, 0)

  const stale = emitted(() => assert.throws(() => store.applyRelationOp({
    kind: 'set-project-description', projectId, projectName: `Project event ${projectId}`, description: 'Rejected prose', expectedDescription: 'Wrong current prose',
  }, OWNER)))
  assert.equal(projectEvents(stale).length, 0)

  const unknown = emitted(() => store.applyRelationOp({
    kind: 'set-project-description', projectId: 'proj-events-does-not-exist', projectName: 'Unknown', description: 'Ghost prose',
  }, OWNER))
  assert.equal(projectEvents(unknown).length, 0)
})

test('direct commission cap and default-role setters emit actual changes, including clears', () => {
  const projectId = 'proj-events-direct-settings'
  createProject(projectId)

  const cap = emitted(() => store.setCommissionCap(projectId, 3))
  assert.deepEqual(projectEvents(cap), [{ type: 'project.changed', projectId, scope: 'readers' }])
  const capNoOp = emitted(() => store.setCommissionCap(projectId, 3))
  assert.equal(projectEvents(capNoOp).length, 0, 'an unchanged cap emits no extra invalidation')
  const capClear = emitted(() => store.setCommissionCap(projectId, undefined))
  assert.deepEqual(projectEvents(capClear), [{ type: 'project.changed', projectId, scope: 'readers' }])
  const capClearNoOp = emitted(() => store.setCommissionCap(projectId, undefined))
  assert.equal(projectEvents(capClearNoOp).length, 0, 'clearing an already-clear cap emits no event')
  const unknownCap = emitted(() => store.setCommissionCap('proj-events-no-such-cap', 3))
  assert.equal(projectEvents(unknownCap).length, 0, 'an unknown cap target emits no event')

  const role = emitted(() => store.setProjectDefaultRole(projectId, 'writer'))
  assert.deepEqual(projectEvents(role), [{ type: 'project.changed', projectId, scope: 'readers' }])
  const roleNoOp = emitted(() => store.setProjectDefaultRole(projectId, 'writer'))
  assert.equal(projectEvents(roleNoOp).length, 0, 'an unchanged default role emits no extra invalidation')
  const roleClear = emitted(() => store.setProjectDefaultRole(projectId, undefined))
  assert.deepEqual(projectEvents(roleClear), [{ type: 'project.changed', projectId, scope: 'readers' }])
  const roleClearNoOp = emitted(() => store.setProjectDefaultRole(projectId, undefined))
  assert.equal(projectEvents(roleClearNoOp).length, 0, 'clearing an already-clear role emits no event')
  const unknownRole = emitted(() => store.setProjectDefaultRole('proj-events-no-such-role', 'reader'))
  assert.equal(projectEvents(unknownRole).length, 0, 'an unknown role target emits no event')
})

test('readers scope follows an organization read union for both owner and member seats', () => {
  const orgId = 'tenant-org-project-events'
  const org = accounts.createOrg('user-ada', 'Project Event Org', { logicalId: orgId })
  assert.ok(org)
  const invite = accounts.createInvite(orgId, 'grace@acme.example', 'Ada Lovelace')
  assert.ok(invite)
  const accepted = accounts.resolveInvite(invite.id, 'user-grace', 'accept')
  assert.equal(accepted?.kind, 'accepted')

  const projectId = 'proj-events-org-readers'
  store.applyRelationOp({
    kind: 'create-project',
    projectId,
    projectName: 'Organization event project',
    projectDescription: 'Org-private prose',
    ownerTenantId: orgId,
  }, 'tenant-acme')
  const changed = emitted(() => store.setProjectDefaultRole(projectId, 'reader'))
  const event = projectEvents(changed)[0]
  assert.ok(event)
  assert.equal(event.scope, 'readers')
  assert.equal(store.eventVisibleToTenant(event, 'tenant-acme'), true, 'the org owner reads the private Project event')
  assert.equal(store.eventVisibleToTenant(event, 'tenant-beta'), true, 'an org member reads through the organization union')
  assert.equal(store.eventVisibleToTenant(event, FOREIGN), false)
})

test('unknown projects and invalid scopes fail closed', () => {
  const unknown = {
    type: 'project.changed',
    projectId: 'proj-events-unknown',
    scope: 'public',
  } as unknown as ServerEvent
  assert.equal(store.eventVisibleToTenant(unknown, OWNER), false)

  const projectId = 'proj-events-invalid-scope'
  createProject(projectId)
  const invalid = {
    type: 'project.changed',
    projectId,
    scope: 'not-a-scope',
  } as unknown as ServerEvent
  assert.equal(store.eventVisibleToTenant(invalid, OWNER), false)
  assert.equal(store.eventVisibleToTenant(invalid, FOREIGN), false)
})
