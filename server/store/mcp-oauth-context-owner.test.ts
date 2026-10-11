import assert from 'node:assert/strict'
import test from 'node:test'
import { accounts } from '../accounts.ts'
import { MCP_MODERN_VERSION } from '../mcpProtocol.ts'
import { MCP_SCHEMA_ADMISSION_VERSION, mcpToolSchemaHash } from '../mcpToolAdmission.ts'
import { ValidationError } from '../conflict.ts'
import { mcpConnectionCreationId } from '../mcpConnections.ts'
import { store } from './index.ts'

test('a shared-session peer can read the transcript but cannot detach a hidden OAuth context', () => {
  const suffix = Date.now().toString(36)
  const ownerId = `mcp-context-owner-${suffix}`
  const memberId = `mcp-context-member-${suffix}`
  const owner = accounts.createUser('Context Owner', `${ownerId}@example.test`, 'fixture-password', { userId: ownerId })
  const member = accounts.createUser('Context Member', `${memberId}@example.test`, 'fixture-password', { userId: memberId })
  assert.ok(owner && member)
  const org = accounts.createOrg(ownerId, `OAuth Context ${suffix}`)
  assert.ok(org)
  const invite = accounts.issueInvite(org.id, member.user.email, 'Context Owner')
  assert.equal(invite.kind, 'represented')
  assert.equal(accounts.resolveInvite(invite.invite.id, memberId, 'accept')?.kind, 'accepted')

  const oauthId = mcpConnectionCreationId(org.id, `oauth-context-${suffix}`, ownerId)
  const tool = { name: 'lookup', inputSchema: { type: 'object' as const } }
  store.createMcpConnection({ id: oauthId, label: 'Owner OAuth', endpoint: 'https://mcp.example.test/tools', authentication: 'device-oauth' }, org.id, false, ownerId)
  store.commitMcpInspection(oauthId, org.id, 0, {
    protocolVersion: MCP_MODERN_VERSION,
    cleanup: 'not-needed',
    tools: [tool],
    schemaAdmission: { version: MCP_SCHEMA_ADMISSION_VERSION, hashes: [mcpToolSchemaHash(tool)] },
  }, Date.now(), `MCP_DESKTOP_${'A'.repeat(32)}`, undefined, ownerId)

  const session = store.createSession('Shared OAuth transcript', org.id)
  const attachment = { id: oauthId, type: 'mcp' as const, label: 'Owner OAuth', scope: '*' }
  const workspace = { workspaces: [], repos: [], connectors: [], attachments: [] }
  store.updateSessionContextState(session.id, [{ action: 'attach', context: attachment }], workspace, org.id, ownerId)
  store.appendMessage(session.id, { id: store.mintMessageId('user'), role: 'user', content: 'Shared transcript remains visible.' })

  const memberView = store.getSession(session.id, memberId)
  assert.ok(memberView && store.sessionOwnedBy(memberView, org.id))
  assert.equal(memberView.messages?.some(message => message.content === 'Shared transcript remains visible.'), true)
  assert.deepEqual(memberView.contexts, [], 'private OAuth binding remains hidden from the same-org reader')
  assert.throws(() => store.updateSessionContextState(
    session.id,
    [{ action: 'detach', contextId: oauthId }],
    workspace,
    org.id,
    memberId,
  ), ValidationError)
  assert.deepEqual(store.sessionContexts(session.id, ownerId), [attachment], 'denied peer mutation leaves owner binding intact')

  assert.equal(store.removeMcpConnection(oauthId, org.id, 1, ownerId), true)
  assert.throws(() => store.updateSessionContextState(
    session.id,
    [{ action: 'detach', contextId: oauthId }],
    workspace,
    org.id,
    memberId,
  ), ValidationError, 'the retired registry identity continues to protect the hidden attachment')
  assert.deepEqual(store.sessionContexts(session.id, ownerId), [attachment])
  store.updateSessionContextState(session.id, [{ action: 'detach', contextId: oauthId }], workspace, org.id, ownerId)
  assert.deepEqual(store.sessionContexts(session.id, ownerId), [])

  const bearerId = mcpConnectionCreationId(org.id, `bearer-context-${suffix}`, ownerId)
  store.createMcpConnection({ id: bearerId, label: 'Shared bearer', endpoint: 'https://mcp.example.test/bearer', authentication: 'device-bearer' }, org.id)
  store.commitMcpInspection(bearerId, org.id, 0, {
    protocolVersion: MCP_MODERN_VERSION,
    cleanup: 'not-needed',
    tools: [tool],
    schemaAdmission: { version: MCP_SCHEMA_ADMISSION_VERSION, hashes: [mcpToolSchemaHash(tool)] },
  }, Date.now(), `MCP_DESKTOP_${'B'.repeat(32)}`)
  const bearerAttachment = { id: bearerId, type: 'mcp' as const, label: 'Shared bearer', scope: '*' }
  store.updateSessionContextState(session.id, [{ action: 'attach', context: bearerAttachment }], workspace, org.id, ownerId)
  store.updateSessionContextState(session.id, [{ action: 'detach', contextId: bearerId }], workspace, org.id, memberId)
  assert.deepEqual(store.sessionContexts(session.id, ownerId), [], 'non-OAuth shared bearer detach semantics remain tenant-scoped')
  store.removeSession(session.id)
})
