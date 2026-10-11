import assert from 'node:assert/strict'
import test from 'node:test'
import type { ToolActivity } from '../../contract/index.ts'
import { MCP_SCHEMA_ADMISSION_VERSION, mcpToolSchemaHash } from '../mcpToolAdmission.ts'
import { MCP_MODERN_VERSION } from '../mcpProtocol.ts'
import { mcpConnectionCreationId } from '../mcpConnections.ts'
import { accounts } from '../accounts.ts'
import { store } from './index.ts'

test('OAuth MCP proposal, exact receipt replay and settlement stay bound to the proposing person', () => {
  const tenantId = 'tenant-acme'
  const owner = 'user-ada'
  const other = 'user-grace'
  const connectionId = mcpConnectionCreationId(tenantId, `oauth-activity-${Date.now()}`, owner)
  const tool = { name: 'lookup', inputSchema: { type: 'object' as const } }
  const credentialReference = `MCP_DESKTOP_${'E'.repeat(32)}`
  store.createMcpConnection({ id: connectionId, label: 'OAuth fixture', endpoint: 'https://mcp.example/tools', authentication: 'device-oauth' }, tenantId, false, owner)
  store.commitMcpInspection(connectionId, tenantId, 0, {
    protocolVersion: MCP_MODERN_VERSION, cleanup: 'not-needed', tools: [tool],
    schemaAdmission: { version: MCP_SCHEMA_ADMISSION_VERSION, hashes: [mcpToolSchemaHash(tool)] },
  }, Date.now(), credentialReference, undefined, owner)
  const session = store.createSession('OAuth owner activity', tenantId)
  const attached = { id: connectionId, type: 'mcp' as const, label: 'OAuth fixture', scope: '*' }
  store.attachContext(session.id, attached, owner)
  assert.deepEqual(store.sessionContexts(session.id, owner), [attached])
  assert.deepEqual(store.sessionContexts(session.id, other), [], 'a tenant peer cannot project the private OAuth attachment')
  assert.doesNotMatch(JSON.stringify(store.getSession(session.id, owner)), /user-ada/, 'Session/Message wire projections omit the private owner anchor')
  const activity: ToolActivity = {
    id: `oauth-activity-${Date.now()}`, tool: 'mcp__oauth__lookup', connector: 'OAuth fixture', connectorId: connectionId,
    kind: 'action', status: 'proposed', summary: 'Review call', input: { query: 'exact' },
    mcp: { connectionRevision: 1, toolName: 'lookup', schemaHash: mcpToolSchemaHash(tool) },
  }
  const activityMessage = { id: store.mintMessageId('assistant'), role: 'assistant' as const, content: 'Review.', toolActivities: [activity] }
  store.appendMessage(session.id, activityMessage, { actorUserId: owner })
  const receipt = `tool-activity-decision-${'e'.repeat(24)}`
  assert.equal(store.toolActivityActorPermitted(session.id, activity.id, tenantId), false)
  assert.equal(store.toolActivityActorPermitted(session.id, activity.id, tenantId, other), false)
  assert.equal(store.toolActivityActorPermitted(session.id, activity.id, tenantId, owner), true)
  const unowned = store.createSession('No implicit OAuth actor', tenantId)
  assert.throws(() => store.appendMessage(unowned.id, {
    id: store.mintMessageId('assistant'), role: 'assistant', content: 'Review.', toolActivities: [{ ...activity, id: `${activity.id}-without-owner` }],
  }), /OAuth-backed MCP proposal/)
  assert.equal(store.getToolActivity(unowned.id, `${activity.id}-without-owner`), undefined)
  assert.equal(store.getToolActivityDecision(session.id, activity.id, receipt, tenantId, 'confirm'), undefined)
  assert.equal(store.beginMcpToolActivityExecution(session.id, activity.id, receipt, tenantId, other), undefined)
  assert.equal(store.claimToolActivity(session.id, activity.id, other), false)
  assert.equal(store.resolveToolActivity(session.id, activity.id, 'decline', undefined, { logicalId: receipt, tenantId, actorUserId: other }), undefined)
  assert.equal(store.beginMcpToolActivityExecution(session.id, activity.id, receipt, tenantId, owner)?.status, 'running')
  assert.equal(store.settleMcpToolActivityExecution(session.id, activity.id, receipt, tenantId, {
    status: 'done', summary: 'Known result', result: { resultType: 'complete', content: [{ type: 'text', text: 'ok' }], isError: false },
  }), undefined, 'OAuth settlement requires the frozen owner identity')
  assert.equal(store.settleMcpToolActivityExecution(session.id, activity.id, receipt, tenantId, {
    status: 'done', summary: 'Known result', result: { resultType: 'complete', content: [{ type: 'text', text: 'ok' }], isError: false },
  }, owner)?.status, 'done')

  const crossNamespaceGrant = store.createGrant({
    subject: { kind: 'session', id: session.id }, audience: { kind: 'org', orgId: 'tenant-beta' }, tier: 'propose',
  }, tenantId)
  assert.ok(crossNamespaceGrant && typeof crossNamespaceGrant === 'object')
  const fork = store.forkSession(session.id, activityMessage.id, 'tenant-beta')
  assert.ok(fork && typeof fork === 'object', 'a granted historical transcript can be forked to another namespace')
  assert.equal(fork.tenantId, 'tenant-beta')
  assert.equal(store.toolActivityActorPermitted(fork.id, activity.id, 'tenant-beta', owner), true,
    'the private authority anchor follows the copied historical receipt, retaining its original owner tenant')
  assert.equal(store.toolActivityActorPermitted(fork.id, activity.id, 'tenant-beta', other), false,
    'the destination tenant does not inherit the source person authority')
  store.removeSession(fork.id)

  for (let index = 0; index < 6; index += 1) {
    store.appendMessage(session.id, { id: store.mintMessageId('user'), role: 'user', content: `Later turn ${index}` })
  }
  const compaction = store.prepareSessionCompaction(session.id)
  assert.ok(compaction && compaction.kind === 'ready')
  store.applySessionCompaction(compaction, 'The OAuth call returned a known result.')
  assert.equal(store.getToolActivityDecision(session.id, activity.id, receipt, tenantId, 'confirm', owner)?.decisionId, receipt,
    'owner-bound receipt replay survives compaction')

  store.removeMcpConnection(connectionId, tenantId, 1, owner)
  assert.deepEqual(store.sessionContexts(session.id, other), [])
  assert.deepEqual(store.sessionContexts(session.id, owner), [attached], 'the owner can still see the retained recovery context')
  assert.equal(store.getToolActivityDecision(session.id, activity.id, receipt, tenantId, 'confirm', other), undefined,
    'a same-tenant viewer cannot replay an OAuth receipt after connection deletion')
  assert.equal(store.getToolActivityDecision(session.id, activity.id, receipt, tenantId, 'confirm', owner)?.decisionId, receipt,
    'the exact owner can still inspect its durable historical receipt')
  assert.deepEqual(store.sessionContexts(session.id, other).filter(context => context.id === connectionId), [])
  store.removeSession(session.id)
})

test('already-running OAuth work can settle a known result for its frozen person after account access is revoked', () => {
  const suffix = Date.now().toString(36)
  const owner = `oauth-owner-${suffix}`
  const tenantId = `tenant-oauth-${suffix}`
  const account = accounts.createUser('OAuth Owner', `${owner}@example.test`, 'fixture-password', { userId: owner, tenantId })
  assert.ok(account)
  const connectionId = mcpConnectionCreationId(tenantId, `oauth-settlement-${suffix}`, owner)
  const tool = { name: 'lookup', inputSchema: { type: 'object' as const } }
  store.createMcpConnection({ id: connectionId, label: 'OAuth fixture', endpoint: 'https://mcp.example/tools', authentication: 'device-oauth' }, tenantId, false, owner)
  store.commitMcpInspection(connectionId, tenantId, 0, {
    protocolVersion: MCP_MODERN_VERSION, cleanup: 'not-needed', tools: [tool],
    schemaAdmission: { version: MCP_SCHEMA_ADMISSION_VERSION, hashes: [mcpToolSchemaHash(tool)] },
  }, Date.now(), `MCP_DESKTOP_${'F'.repeat(32)}`, undefined, owner)
  const session = store.createSession('Revoked OAuth owner settlement', tenantId)
  const activity: ToolActivity = {
    id: `activity-${suffix}`, tool: 'mcp__oauth__lookup', connector: 'OAuth fixture', connectorId: connectionId,
    kind: 'action', status: 'proposed', summary: 'Review call', input: {},
    mcp: { connectionRevision: 1, toolName: 'lookup', schemaHash: mcpToolSchemaHash(tool) },
  }
  store.appendMessage(session.id, { id: store.mintMessageId('assistant'), role: 'assistant', content: '', toolActivities: [activity] }, { actorUserId: owner })
  const receipt = `tool-activity-decision-${'f'.repeat(24)}`
  assert.ok(store.beginMcpToolActivityExecution(session.id, activity.id, receipt, tenantId, owner))

  assert.equal(accounts.deactivateUser(owner), 'ok')
  assert.equal(store.toolActivityActorPermitted(session.id, activity.id, tenantId, owner), false,
    'revoked membership cannot authorize new inspection or consent')
  assert.equal(store.getToolActivityDecision(session.id, activity.id, receipt, tenantId, 'confirm', owner), undefined,
    'receipt replay is a fresh owner read and is denied after membership loss')
  assert.equal(store.settleMcpToolActivityExecution(session.id, activity.id, receipt, tenantId, {
    status: 'done', summary: 'Known result', result: { resultType: 'complete', content: [{ type: 'text', text: 'ok' }], isError: false },
  }, owner)?.status, 'done', 'known worker outcome remains durable without restoring the revoked account access')
  store.removeSession(session.id)
})
