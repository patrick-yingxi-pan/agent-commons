import assert from 'node:assert/strict'
import { test } from 'node:test'
import { conversationContext } from './conversationContext.ts'
import { store } from './store/index.ts'

test('conversation model context keeps readable project context separate from owned write targets', () => {
  const suffix = Date.now().toString(36)
  const owner = `tenant-conversation-context-owner-${suffix}`
  const reader = 'tenant-beta'
  const projectId = `project-conversation-context-${suffix}`
  const artifactName = `conversation-context-${suffix}.md`

  store.applyRelationOp({
    kind: 'create-project', projectId, projectName: 'Shared context project', projectDescription: '',
  }, owner)
  store.applyRelationOp({
    kind: 'set-project-description', projectId, projectName: 'Shared context project',
    description: 'Current public project description.',
  }, owner)
  store.applyRelationOp({
    kind: 'set-project-instructions', projectId, projectName: 'Shared context project',
    instructions: 'Owner-only project instructions.',
  }, owner)
  store.applyRelationOp({
    kind: 'share-project', projectId, projectName: 'Shared context project', shared: true,
  }, owner)
  const privateAgent = store.createAgent({
    label: `Private Agent ${suffix}`, systemPrompt: 'Tenant-scoped fixture.', instructions: '', tools: [],
  }, owner)

  const artifactGraph = store.applyRelationOp({
    kind: 'save-artifact',
    artifact: { name: artifactName, kind: 'doc', meta: 'Document', body: 'Reader-visible saved body.' },
    sessionTitle: 'Conversation context fixture',
  }, owner)
  const artifact = artifactGraph.extraArtifacts.find((row) => row.name === artifactName)
  assert.ok(artifact, 'owner artifact fixture was created')
  const grant = store.createGrant({
    subject: { kind: 'artifact', id: artifact.id },
    audience: { kind: 'org', orgId: reader },
    tier: 'view',
  }, owner)
  assert.ok(grant && typeof grant === 'object', 'reader receives a read-only artifact grant')

  const ownerSession = store.createSession(`Conversation owner ${suffix}`, owner)
  const readerSession = store.createSession(`Conversation reader ${suffix}`, reader)
  const attachedContext = { id: `ctx-conversation-${suffix}`, type: 'connector' as const, label: 'Attached fixture' }
  store.attachContext(ownerSession.id, attachedContext)

  const ownerContext = conversationContext(ownerSession.id, owner)
  const readerContext = conversationContext(readerSession.id, reader)
  const ownerProject = ownerContext.commons.projects.find((project) => project.id === projectId)
  const readerProject = readerContext.commons.projects.find((project) => project.id === projectId)

  assert.equal(ownerProject?.own, true)
  assert.equal(ownerProject?.shareable, true, 'the owner may propose sharing its created project')
  assert.equal(ownerProject?.instructions, 'Owner-only project instructions.')
  assert.equal(ownerContext.commons.artifacts.some((row) => row.id === artifact.id), true)
  assert.equal(ownerContext.commons.agents.some((row) => row.id === privateAgent.id), true)

  assert.equal(readerProject?.own, false, 'shared visibility is a read projection, not ownership')
  assert.equal(readerProject?.description, 'Current public project description.')
  assert.equal(readerProject?.instructions, '', 'foreign owner instructions stay redacted')
  assert.equal(readerContext.commons.artifacts.some((row) => row.id === artifact.id), false,
    'an artifact read grant does not create a model-proposed write target')
  assert.equal(readerContext.commons.agents.some((row) => row.id === privateAgent.id), false,
    'another tenant’s private registry entry does not enter model context')

  assert.deepEqual(ownerContext.contexts, [attachedContext], 'only the named session attachment enters model context')
  assert.deepEqual(readerContext.contexts, [], 'another session does not inherit the attachment')
})

test('tenant-scoped conversation context does not include another tenant’s private project', () => {
  const suffix = Date.now().toString(36)
  const owner = `tenant-conversation-private-owner-${suffix}`
  const other = `tenant-conversation-private-other-${suffix}`
  const projectId = `project-conversation-private-${suffix}`
  store.applyRelationOp({
    kind: 'create-project', projectId, projectName: 'Private context project', projectDescription: '',
  }, owner)

  const context = conversationContext(store.createSession(`Other ${suffix}`, other).id, other)
  assert.equal(context.commons.projects.some((project) => project.id === projectId), false)
})
