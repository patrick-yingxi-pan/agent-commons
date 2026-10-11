/** OAuth attachment changes fan out as safe session invalidations, not private rows. */
import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import type { ServerEvent } from '../../contract/index.ts'
import { signSession } from '../auth.ts'
import { call } from '../testkit/http.ts'
import { store } from '../store/index.ts'
import { eventlog } from '../eventlog.ts'
import { configureMcpRuntime, initializeMcpRuntime } from '../mcpRuntime.ts'
import { MCP_MODERN_VERSION } from '../mcpProtocol.ts'
import { MCP_SCHEMA_ADMISSION_VERSION, mcpToolSchemaHash } from '../mcpToolAdmission.ts'
import { buildRouter } from './index.ts'

async function stream(headers: Record<string, string>) {
  let body = ''
  let status = 0
  let ended = false
  const callbacks = new Map<string, () => void>()
  const req = { method: 'GET', headers, on(name: string, callback: () => void) { callbacks.set(name, callback); return req } }
  const res = {
    writeHead(value: number) { status = value; return res }, setHeader() {}, flushHeaders() {}, on() {},
    write(chunk: unknown) { body += String(chunk); return true }, end() { ended = true },
    get writableEnded() { return ended },
  }
  await buildRouter().handle(req as never, res as never, new URL('http://test/events'))
  assert.equal(status, 200)
  return {
    close: () => callbacks.get('close')?.(),
    events: (): ServerEvent[] => [...body.matchAll(/^data: (.+)$/gm)].flatMap((match) => {
      const value = JSON.parse(match[1])
      return value?.type ? [value] : []
    }),
  }
}

let sequence = 0
const endpoint = 'https://context-events.example.test/mcp'
const credentialReference = `MCP_DESKTOP_${'A'.repeat(32)}`
const tool = { name: 'lookup', inputSchema: { type: 'object', properties: {}, additionalProperties: false } }
const schemaHash = mcpToolSchemaHash(tool)
afterEach(() => configureMcpRuntime({ deviceBearerAvailable: false, allowLoopback: false }))
async function account(label: string) {
  const tag = `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${++sequence}`
  const response = await call('POST', '/auth/signup', { name: label, email: `${tag}@context-events.example`, password: `${tag}-password` })
  assert.equal(response.status, 200)
  return { userId: response.json.user.id as string, email: `${tag}@context-events.example`, cookie: response.headers['set-cookie']?.split(';')[0] ?? '' }
}

function headers(userId: string, tenantId: string) {
  return { cookie: `uw_session=${signSession({ userId, tenantId, iat: Date.now() })}` }
}

test('session context SSE live and replay are ID-only while context GET remains owner-filtered', async () => {
  const owner = await account('Context event owner')
  const member = await account('Context event member')
  const org = await call('POST', '/orgs', { name: `Context events ${sequence}` }, { cookie: owner.cookie })
  assert.equal(org.status, 201)
  const invite = await call('POST', `/orgs/${org.json.id}/invites`, { email: member.email }, { cookie: owner.cookie })
  assert.equal(invite.status, 201)
  assert.equal((await call('POST', `/me/invites/${invite.json.id}/accept`, undefined, { cookie: member.cookie })).status, 200)

  configureMcpRuntime({ deviceBearerAvailable: false, deviceOAuthAvailable: true, allowLoopback: false,
    resolveOAuthCredential: async () => 'unused-test-token', synchronizeBindings: async () => ({ available: true }) })
  await initializeMcpRuntime(store.mcpCredentialBindings())
  const connectionId = `mcp-connection-${(++sequence).toString(16).padStart(32, '0')}`
  store.createMcpConnection({ id: connectionId, label: 'Private OAuth connection', endpoint, authentication: 'device-oauth' }, org.json.id, false, owner.userId)
  store.commitMcpInspection(connectionId, org.json.id, 0, {
    protocolVersion: MCP_MODERN_VERSION, cleanup: 'not-needed', tools: [tool],
    schemaAdmission: { version: MCP_SCHEMA_ADMISSION_VERSION, hashes: [schemaHash] },
  }, Date.now(), credentialReference, undefined, owner.userId)

  const session = store.createSession(`Context event session ${sequence}`, org.json.id)
  const contextId = connectionId
  const privateLabel = `Private OAuth label ${sequence}`
  const before = eventlog.seq()
  const ownerStream = await stream(headers(owner.userId, org.json.id))
  const memberStream = await stream(headers(member.userId, org.json.id))
  try {
    store.attachContext(session.id, { id: contextId, type: 'mcp', label: privateLabel, scope: '*' }, owner.userId)
    const liveOwner = ownerStream.events().filter((event) => event.type === 'session.contexts.changed')
    const liveMember = memberStream.events().filter((event) => event.type === 'session.contexts.changed')
    assert.deepEqual(liveOwner.at(-1), { type: 'session.contexts.changed', sessionId: session.id })
    assert.deepEqual(liveMember.at(-1), { type: 'session.contexts.changed', sessionId: session.id })
    assert.ok(!JSON.stringify(memberStream.events()).includes(contextId))
    assert.ok(!JSON.stringify(memberStream.events()).includes(privateLabel))

    const ownerContexts = await call('GET', `/sessions/${session.id}/contexts`, undefined, headers(owner.userId, org.json.id))
    const memberContexts = await call('GET', `/sessions/${session.id}/contexts`, undefined, headers(member.userId, org.json.id))
    assert.ok(ownerContexts.json.some((context: { id: string }) => context.id === contextId), 'owner can refetch the attachment')
    assert.ok(!memberContexts.json.some((context: { id: string }) => context.id === contextId), 'same-org member refetch stays filtered')

    const replay = await stream({ ...headers(member.userId, org.json.id), 'last-event-id': String(before) })
    try {
      assert.ok(replay.events().some((event) => event.type === 'hello' && event.resumed), 'the retained tail is replayed')
      const replayed = replay.events().filter((event) => event.type === 'session.contexts.changed')
      assert.deepEqual(replayed, [{ type: 'session.contexts.changed', sessionId: session.id }])
      assert.ok(!JSON.stringify(replay.events()).includes(contextId))
      assert.ok(!JSON.stringify(replay.events()).includes(privateLabel))
    } finally { replay.close() }
  } finally {
    ownerStream.close()
    memberStream.close()
  }
})
