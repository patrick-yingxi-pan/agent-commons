/** Integration tests for the capability-invocation route, through the real
 *  router + store + runner runtime. Covers addressing, routing, the two
 *  authorities — context mediation at the broker (D5) and the host grant in the
 *  runtime (D3) — and the offline / unknown / unsupported error paths. */
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { call } from './helpers/http.ts'

// The seeded local runner grants fs.read/fs.write over ~/projects and terminal/process over *.
// Every invoke now names a session + an attached context (the mediation handle): the broker
// checks target ∈ context.scope, then the runtime checks the runner's host grant.
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
  // ctx-any (scope '*') passes mediation; /etc/passwd is outside the runner's fs grant.
  const { status, json } = await call('POST', '/agents/agent-local/invoke', {
    sessionId: 'inv',
    contextId: 'ctx-any',
    capability: 'fs.read',
    target: '/etc/passwd',
  })
  assert.equal(status, 403)
  assert.equal(json.error.code, 'forbidden')
})

test('invoke a capability the runner does not advertise is 409 capability_unavailable', async () => {
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

test('invoke on an offline runner is 409 capability_unavailable', async () => {
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

test('invoke on an unknown runner is 404', async () => {
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

// ── Resource guardian (D5) — escrow on the effect path ──────────────────────

test('a non-monotonic write is escrow-blocked for a second session, freed on release', async () => {
  // Two sessions bound to the SAME shared resource id ('shared-res').
  await call('POST', '/sessions/gX/contexts', { id: 'shared-res', type: 'repo', label: 'shared', scope: '*' })
  await call('POST', '/sessions/gY/contexts', { id: 'shared-res', type: 'repo', label: 'shared', scope: '*' })

  // Session X writes — acquires + holds the resource.
  const wx = await call('POST', '/agents/agent-local/invoke', {
    sessionId: 'gX', contextId: 'shared-res', capability: 'fs.write', target: '~/projects/f.ts', args: { content: 'x' },
  })
  assert.equal(wx.status, 200)

  // Session Y writes the same resource — refused up front (escrow conflict).
  const wy = await call('POST', '/agents/agent-local/invoke', {
    sessionId: 'gY', contextId: 'shared-res', capability: 'fs.write', target: '~/projects/f.ts', args: { content: 'y' },
  })
  assert.equal(wy.status, 409)
  assert.equal(wy.json.error.code, 'conflict')

  // Release X's hold (found via the resource status), then Y succeeds.
  const status = await call('GET', '/resources/shared-res')
  const held = status.json.active.find((r: any) => r.holder === 'gX')
  assert.ok(held)
  await call('POST', `/reservations/${held.id}/release`)
  const wy2 = await call('POST', '/agents/agent-local/invoke', {
    sessionId: 'gY', contextId: 'shared-res', capability: 'fs.write', target: '~/projects/f.ts', args: { content: 'y' },
  })
  assert.equal(wy2.status, 200)
})

test('a monotonic read is coordination-free — allowed while another session holds the write lock', async () => {
  await call('POST', '/sessions/gP/contexts', { id: 'res-ro', type: 'repo', label: 'ro', scope: '*' })
  await call('POST', '/sessions/gQ/contexts', { id: 'res-ro', type: 'repo', label: 'ro', scope: '*' })
  // P holds the write lock on the resource.
  const wp = await call('POST', '/agents/agent-local/invoke', {
    sessionId: 'gP', contextId: 'res-ro', capability: 'fs.write', target: '~/projects/r.ts', args: { content: 'p' },
  })
  assert.equal(wp.status, 200)
  // Q reads the same resource — fs.read is monotonic, so it bypasses the guardian.
  const rq = await call('POST', '/agents/agent-local/invoke', {
    sessionId: 'gQ', contextId: 'res-ro', capability: 'fs.read', target: '~/projects/r.ts',
  })
  assert.equal(rq.status, 200)
})

test('the same session may write a resource repeatedly (re-entrant)', async () => {
  await call('POST', '/sessions/gR/contexts', { id: 'res-re', type: 'repo', label: 're', scope: '*' })
  for (const content of ['a', 'b']) {
    const w = await call('POST', '/agents/agent-local/invoke', {
      sessionId: 'gR', contextId: 'res-re', capability: 'fs.write', target: '~/projects/re.ts', args: { content },
    })
    assert.equal(w.status, 200)
  }
})

test('a failed invoke does not release a session’s pre-existing explicit reservation', async () => {
  await call('POST', '/sessions/gZ/contexts', { id: 'res-hold', type: 'repo', label: 'h', scope: '*' })
  // gZ holds the resource explicitly (e.g. across a consent gate).
  assert.equal((await call('POST', '/resources/res-hold/reserve', { holder: 'gZ' })).status, 200)
  // A non-monotonic invoke that FAILS at the host grant (target outside ~/projects).
  const bad = await call('POST', '/agents/agent-local/invoke', {
    sessionId: 'gZ', contextId: 'res-hold', capability: 'fs.write', target: '/etc/x', args: { content: 'z' },
  })
  assert.equal(bad.status, 403)
  assert.equal(bad.json.error.code, 'forbidden')
  // gZ's explicit hold survives the failed invoke (it released only what it would have acquired — nothing).
  const status = await call('GET', '/resources/res-hold')
  assert.ok(status.json.active.some((x: any) => x.holder === 'gZ' && x.status !== 'released'))
})
