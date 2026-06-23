/** Integration tests for the capability-invocation route, through the real
 *  router + store + agent runtime. Covers addressing, routing, grant enforcement,
 *  and the offline/unknown/unsupported error paths. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { call } from './helpers/http.ts'

// The seeded local agent grants fs.read/fs.write over ~/projects and terminal/process over *.

test('invoke fs.read within the local agent grant returns output', async () => {
  const { status, json } = await call('POST', '/agents/agent-local/invoke', {
    capability: 'fs.read',
    target: '~/projects/insights/main.ts',
  })
  assert.equal(status, 200)
  assert.equal(json.agentId, 'agent-local')
  assert.equal(json.capability, 'fs.read')
  assert.match(json.output.content, /mock contents of/)
})

test('invoke outside the granted scope is 403 forbidden', async () => {
  const { status, json } = await call('POST', '/agents/agent-local/invoke', {
    capability: 'fs.read',
    target: '/etc/passwd',
  })
  assert.equal(status, 403)
  assert.equal(json.error.code, 'forbidden')
})

test('invoke a capability the agent does not advertise is 409 capability_unavailable', async () => {
  // Enroll an agent that only offers terminal, then ask it for fs.read.
  await call('POST', '/agents', {
    id: 'agent-term-only',
    label: 'T',
    host: 'h',
    capabilities: [{ type: 'terminal', scopes: ['*'] }],
  })
  const { status, json } = await call('POST', '/agents/agent-term-only/invoke', {
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
    capability: 'terminal',
    target: 'ls',
  })
  assert.equal(status, 409)
  assert.equal(json.error.code, 'capability_unavailable')
})

test('invoke on an unknown agent is 404', async () => {
  const { status, json } = await call('POST', '/agents/ghost/invoke', {
    capability: 'terminal',
    target: 'ls',
  })
  assert.equal(status, 404)
  assert.equal(json.error.code, 'not_found')
})

test('invoke without capability/target is 400 bad_request', async () => {
  const { status, json } = await call('POST', '/agents/agent-local/invoke', { target: '~/x' })
  assert.equal(status, 400)
  assert.equal(json.error.code, 'bad_request')
})
