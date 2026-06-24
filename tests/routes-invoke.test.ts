/** Integration tests for the capability-invocation route, through the real
 *  router + store + agent runtime. Covers addressing, routing, the two
 *  authorities — context mediation at the broker (D5) and the host grant in the
 *  runtime (D3) — and the offline / unknown / unsupported error paths. */
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { call } from './helpers/http.ts'

// The seeded local agent grants fs.read/fs.write over ~/projects and terminal/process over *.
// Every invoke now names a session + an attached context (the mediation handle): the broker
// checks target ∈ context.scope, then the runtime checks the agent's host grant.
before(async () => {
  // `ctx-any` (scope '*') passes mediation so tests can exercise the grant / liveness
  // paths; `ctx-projects` (scope ~/projects) exercises mediation itself.
  await call('POST', '/sessions/inv/contexts', { id: 'ctx-any', type: 'folder', label: 'any', scope: '*' })
  await call('POST', '/sessions/inv/contexts', { id: 'ctx-projects', type: 'repo', label: 'projects', scope: '~/projects' })
})

test('invoke within the context scope and host grant returns output', async () => {
  const { status, json } = await call('POST', '/agents/agent-local/invoke', {
    sessionId: 'inv',
    contextId: 'ctx-projects',
    capability: 'fs.read',
    target: '~/projects/insights/main.ts',
  })
  assert.equal(status, 200)
  assert.equal(json.agentId, 'agent-local')
  assert.equal(json.capability, 'fs.read')
  assert.match(json.output.content, /mock contents of/)
})

test('invoke outside the context scope is 403 forbidden (mediation, D5)', async () => {
  const { status, json } = await call('POST', '/agents/agent-local/invoke', {
    sessionId: 'inv',
    contextId: 'ctx-projects',
    capability: 'fs.read',
    target: '~/elsewhere/secret.ts',
  })
  assert.equal(status, 403)
  assert.equal(json.error.code, 'forbidden')
})

test('invoke naming a context not attached to the session is 403 forbidden', async () => {
  const { status, json } = await call('POST', '/agents/agent-local/invoke', {
    sessionId: 'inv',
    contextId: 'ctx-absent',
    capability: 'fs.read',
    target: '~/projects/x.ts',
  })
  assert.equal(status, 403)
  assert.equal(json.error.code, 'forbidden')
})

test('invoke inside the context but outside the host grant is 403 forbidden (grant, D3)', async () => {
  // ctx-any (scope '*') passes mediation; /etc/passwd is outside the agent's fs grant.
  const { status, json } = await call('POST', '/agents/agent-local/invoke', {
    sessionId: 'inv',
    contextId: 'ctx-any',
    capability: 'fs.read',
    target: '/etc/passwd',
  })
  assert.equal(status, 403)
  assert.equal(json.error.code, 'forbidden')
})

test('invoke a capability the agent does not advertise is 409 capability_unavailable', async () => {
  await call('POST', '/agents', {
    id: 'agent-term-only',
    label: 'T',
    host: 'h',
    capabilities: [{ type: 'terminal', scopes: ['*'] }],
  })
  const { status, json } = await call('POST', '/agents/agent-term-only/invoke', {
    sessionId: 'inv',
    contextId: 'ctx-any',
    capability: 'fs.read',
    target: '~/x',
  })
  assert.equal(status, 409)
  assert.equal(json.error.code, 'capability_unavailable')
})

test('invoke on an offline agent is 409 capability_unavailable', async () => {
  await call('POST', '/agents', {
    id: 'agent-going-offline',
    label: 'O',
    host: 'h',
    capabilities: [{ type: 'terminal', scopes: ['*'] }],
  })
  await call('DELETE', '/agents/agent-going-offline') // mark offline (durable)
  const { status, json } = await call('POST', '/agents/agent-going-offline/invoke', {
    sessionId: 'inv',
    contextId: 'ctx-any',
    capability: 'terminal',
    target: 'ls',
  })
  assert.equal(status, 409)
  assert.equal(json.error.code, 'capability_unavailable')
})

test('invoke on an unknown agent is 404', async () => {
  const { status, json } = await call('POST', '/agents/ghost/invoke', {
    sessionId: 'inv',
    contextId: 'ctx-any',
    capability: 'terminal',
    target: 'ls',
  })
  assert.equal(status, 404)
  assert.equal(json.error.code, 'not_found')
})

test('invoke without capability/target is 400 bad_request', async () => {
  const { status, json } = await call('POST', '/agents/agent-local/invoke', {
    sessionId: 'inv',
    contextId: 'ctx-any',
    target: '~/x',
  })
  assert.equal(status, 400)
  assert.equal(json.error.code, 'bad_request')
})

test('invoke without sessionId/contextId is 400 bad_request (missing mediation handle)', async () => {
  const { status, json } = await call('POST', '/agents/agent-local/invoke', {
    capability: 'fs.read',
    target: '~/projects/x.ts',
  })
  assert.equal(status, 400)
  assert.equal(json.error.code, 'bad_request')
})
