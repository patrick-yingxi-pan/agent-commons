/** Authority is inherited per dimension, not per object. Exercise ordinary
 * signed-cookie configuration and the real mapped-runner effect boundary. */
import { after, afterEach, before, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Agent, Authority, Commission, ModelProvider } from '../../contract/index.ts'

// The fixed runner binding is captured at import time. Only this suite's
// disposable files can be read, even when a regression bypasses an ancestor.
const runnerRoot = mkdtempSync(join(tmpdir(), 'agent-commons-authority-'))
for (const name of ['allowed', 'blocked']) {
  mkdirSync(join(runnerRoot, name))
  writeFileSync(join(runnerRoot, name, 'note.txt'), `${name} test-owned bytes`)
}
const priorRunnerRoot = process.env.CONTEXT_RUNNER_ROOT
process.env.CONTEXT_RUNNER_ROOT = runnerRoot
const { accounts } = await import('../accounts.ts')
const { SESSION_COOKIE, signSession } = await import('../auth.ts')
const { store } = await import('../store/index.ts')
const { call, callFresh } = await import('../testkit/http.ts')

let externalRequests = 0
before(() => {
  mock.method(globalThis, 'fetch', async () => {
    externalRequests += 1
    throw new Error('Authority configuration and local runner reads must not perform external I/O.')
  })
})
afterEach(() => assert.equal(externalRequests, 0, 'no external or provider requests'))
after(() => {
  mock.restoreAll()
  if (priorRunnerRoot === undefined) delete process.env.CONTEXT_RUNNER_ROOT
  else process.env.CONTEXT_RUNNER_ROOT = priorRunnerRoot
  rmSync(runnerRoot, { recursive: true, force: true })
})

async function fixture(authority: Authority) {
  const stamp = randomUUID()
  const org = accounts.createOrg('user-ada', `Authority inheritance ${stamp}`)
  assert.ok(org)
  const headers = { cookie: `${SESSION_COOKIE}=${signSession({ userId: 'user-ada', tenantId: org.id, iat: Date.now() })}` }
  const provider = await call('POST', '/providers', {
    label: `Authority provider ${stamp}`, modelFamily: 'claude', effortLevels: [], authority,
  }, headers)
  assert.equal(provider.status, 200)
  assert.deepEqual(provider.json.authority, authority, 'provider intent remains sparse')
  const prompt = await call('POST', '/system-prompts', {
    label: `Authority prompt ${stamp}`, body: 'No model work.', targetFamily: 'claude',
  }, headers)
  assert.equal(prompt.status, 200)
  const project = await call('POST', '/projects', { name: `Authority Project ${stamp}` }, headers)
  assert.equal(project.status, 201)
  return { headers, provider: provider.json as ModelProvider, promptId: prompt.json.id as string,
    projectId: project.json.project.id as string, projectName: project.json.project.name as string }
}
type Fixture = Awaited<ReturnType<typeof fixture>>
function agentRequest(f: Fixture, authority?: Authority) {
  return { label: `Authority Agent ${randomUUID()}`, providerId: f.provider.id,
    systemPromptId: f.promptId, tools: [], ...(authority === undefined ? {} : { authority }) }
}
async function agent(f: Fixture, authority?: Authority): Promise<Agent> {
  const response = await call('POST', '/agents', agentRequest(f, authority), f.headers)
  assert.equal(response.status, 200, JSON.stringify(response.json))
  assert.deepEqual(response.json.authority, authority)
  return response.json
}
function commissionRequest(f: Fixture, agentId: string, authority?: Authority) {
  return { agentId, projectId: f.projectId, role: 'writer', ...(authority === undefined ? {} : { authority }) }
}
async function commission(f: Fixture, agentId: string, authority?: Authority): Promise<Commission> {
  const response = await call('POST', '/commissions', commissionRequest(f, agentId, authority), f.headers)
  assert.equal(response.status, 200, JSON.stringify(response.json))
  assert.deepEqual(response.json.authority, authority)
  return response.json
}
async function admit(f: Fixture, connectors: string[], scopes: string[]) {
  for (const [kind, labels] of [['connector', connectors], ['folder', scopes]] as const) {
    for (const label of labels) {
      const response = await call('POST', '/relations/ops', { op: {
        kind: 'scope-context', projectId: f.projectId, projectName: f.projectName,
        context: { id: randomUUID(), kind, label },
      } }, f.headers)
      assert.equal(response.status, 200, JSON.stringify(response.json))
    }
  }
}
async function state(f: Fixture) {
  const paths = ['/agents', `/commissions?project=${f.projectId}`, `/providers/${f.provider.id}`, '/relations', '/usage']
  const responses = await Promise.all(paths.map(path => call('GET', path, undefined, f.headers)))
  for (const response of responses) assert.equal(response.status, 200)
  return responses.map(response => response.json)
}
async function quietRefusal(f: Fixture, method: 'POST' | 'PATCH', path: string, body: unknown, status = 400) {
  const before = await state(f)
  const events: unknown[] = []
  const unsubscribe = store.subscribe(event => events.push(event))
  try {
    const response = await call(method, path, body, { ...f.headers, 'idempotency-key': randomUUID() })
    assert.equal(response.status, status, JSON.stringify(response.json))
    assert.equal(response.json.error.code, status === 409 ? 'conflict' : 'bad_request')
    assert.deepEqual(await state(f), before, 'refusal preserves rows, sparse grants, revisions, graph and usage')
    assert.deepEqual(events, [], 'refused configuration emits no event')
  } finally { unsubscribe() }
}

const axes = [
  { dimension: 'tools', allowed: 'read', denied: 'write', other: { connectors: ['Linear'] } },
  { dimension: 'connectors', allowed: 'Linear', denied: 'Slack', other: { tools: ['read'] } },
  { dimension: 'scopes', allowed: '~/projects/allowed', denied: '~/projects/blocked', other: { tools: ['read'] } },
] as const

for (const { dimension, allowed, denied, other } of axes) {
  for (const method of ['POST', 'PATCH'] as const) {
    test(`Commission ${method} cannot widen provider ${dimension} omitted by a partial Agent`, async () => {
      const f = await fixture({ [dimension]: [allowed] })
      const a = await agent(f, other)
      const c = method === 'PATCH' ? await commission(f, a.id) : undefined
      for (const values of [[denied], ['*']]) {
        const authority = { [dimension]: values }
        await quietRefusal(f, method, c ? `/commissions/${c.id}` : '/commissions', c
          ? { authority, expectedRevision: 0 }
          : commissionRequest(f, a.id, authority))
      }
    })
  }
}

for (const method of ['POST', 'PATCH'] as const) {
  test(`Agent ${method} preserves sparse authority while inheriting omitted provider axes`, async () => {
    const f = await fixture({ tools: ['read'] })
    const initial = method === 'PATCH' ? await agent(f) : undefined
    const authority = { connectors: ['Linear'] }
    const body = initial ? { authority, expectedRevision: 0 } : agentRequest(f, authority)
    const path = initial ? `/agents/${initial.id}` : '/agents'
    const headers = { ...f.headers, 'idempotency-key': randomUUID() }
    const response = await call(method, path, body, headers)
    assert.equal(response.status, 200)
    assert.deepEqual(response.json.authority, authority, 'inherited tools are not materialized into Agent intent')
    assert.equal(response.json.revision, initial ? 1 : 0)
    assert.deepEqual((await call('GET', `/agents/${response.json.id}`, undefined, f.headers)).json.authority, authority)
    const saved = await state(f)
    const events: unknown[] = []
    const unsubscribe = store.subscribe(event => events.push(event))
    try {
      const replay = await call(method, path, body, headers)
      assert.equal(replay.status, 200)
      assert.equal(replay.headers['idempotency-replayed'], 'true')
      assert.deepEqual(replay.json, response.json)
      assert.deepEqual(await state(f), saved)
      assert.deepEqual(events, [])
    } finally { unsubscribe() }
    await quietRefusal(f, 'PATCH', `/agents/${response.json.id}`, { authority: { tools: ['write'] }, expectedRevision: response.json.revision })
    await quietRefusal(f, 'PATCH', `/agents/${response.json.id}`, { label: 'stale edit', expectedRevision: response.json.revision + 1 }, 409)
  })

  test(`Commission ${method} stores sparse dimensions and replays without widening or duplicate writes`, async () => {
    const f = await fixture({ tools: ['read'], connectors: ['Linear'], scopes: ['~/projects/allowed'] })
    const a = await agent(f, { tools: ['read'] })
    const initial = method === 'PATCH' ? await commission(f, a.id, { tools: ['read'] }) : undefined
    const authority = { connectors: ['Linear'] }
    const body = initial ? { authority, expectedRevision: 0 } : commissionRequest(f, a.id, authority)
    const path = initial ? `/commissions/${initial.id}` : '/commissions'
    const headers = { ...f.headers, 'idempotency-key': randomUUID() }
    const response = await call(method, path, body, headers)
    assert.equal(response.status, 200)
    const savedAuthority = initial ? { tools: ['read'], ...authority } : authority
    assert.deepEqual(response.json.authority, savedAuthority, 'PATCH preserves explicit dimensions; inherited scopes stay absent')
    assert.equal(response.json.configurationRevision, initial ? 1 : 0)
    const saved = await state(f)
    const events: unknown[] = []
    const unsubscribe = store.subscribe(event => events.push(event))
    try {
      const replay = await call(method, path, body, headers)
      assert.equal(replay.status, 200)
      assert.equal(replay.headers['idempotency-replayed'], 'true')
      assert.deepEqual(replay.json, response.json)
      if (method === 'POST') {
        const durable = await callFresh('POST', path, { ...body, authority: { tools: ['write'] } }, headers)
        assert.equal(durable.status, 200, 'represented replay precedes changed grant admission')
        assert.deepEqual(durable.json, { ...response.json, mine: true })
      }
      assert.deepEqual(await state(f), saved)
      assert.deepEqual(events, [])
    } finally { unsubscribe() }
    await quietRefusal(f, 'PATCH', `/commissions/${response.json.id}`, { role: 'reader', expectedRevision: response.json.configurationRevision + 1 }, 409)
  })
}

for (const leaf of [undefined, {}, { connectors: ['Linear'] }, { scopes: ['~/projects/allowed'] }] as const) {
  test(`GET Commission authority intersects every ancestor and Project with leaf ${JSON.stringify(leaf)}`, async () => {
    const f = await fixture({ tools: ['read', 'write'], connectors: ['Linear', 'Slack', 'Private connector'],
      scopes: ['~/projects/allowed', '~/projects/private'] })
    const a = await agent(f, { tools: ['read'], connectors: ['Linear', 'Private connector'] })
    await admit(f, ['Linear', 'Slack', 'Project-only connector'], ['~/projects/allowed', '~/projects/blocked'])
    const c = await commission(f, a.id, leaf)
    const response = await call('GET', `/commissions/${c.id}/authority`, undefined, f.headers)
    assert.equal(response.status, 200)
    assert.deepEqual(response.json, { tools: ['read'], connectors: ['Linear'], scopes: ['~/projects/allowed'] })
    assert.deepEqual((await call('GET', `/agents/${a.id}`, undefined, f.headers)).json.authority, a.authority)
    assert.deepEqual((await call('GET', `/commissions/${c.id}`, undefined, f.headers)).json.authority, leaf,
      'effective reads do not materialize inherited dimensions into stored intent')
  })
}

for (const { dimension, allowed, denied, other } of axes) {
  test(`provider ${dimension} shrink clamps a Commission through a partial Agent once`, async () => {
    const f = await fixture({ [dimension]: [allowed, denied] })
    const a = await agent(f, other)
    const c = await commission(f, a.id, { [dimension]: [allowed, denied] })
    const headers = { ...f.headers, 'idempotency-key': randomUUID() }
    const body = { authority: { [dimension]: [allowed] }, expectedRevision: 0 }
    const response = await call('PATCH', `/providers/${f.provider.id}`, body, headers)
    assert.equal(response.status, 200)
    const currentAgent = await call('GET', `/agents/${a.id}`, undefined, f.headers)
    assert.equal(currentAgent.json.revision, 0, 'inherited shrink does not rewrite the sparse Agent')
    assert.deepEqual(currentAgent.json.authority, other)
    const current = await call('GET', `/commissions/${c.id}`, undefined, f.headers)
    assert.deepEqual(current.json.authority, { [dimension]: [allowed] })
    assert.equal(current.json.configurationRevision, 1, 'changed explicit child grant advances once')
    const saved = await state(f)
    const events: unknown[] = []
    const unsubscribe = store.subscribe(event => events.push(event))
    try {
      const replay = await call('PATCH', `/providers/${f.provider.id}`, body, headers)
      assert.equal(replay.status, 200)
      assert.equal(replay.headers['idempotency-replayed'], 'true')
      assert.deepEqual(await state(f), saved)
      assert.deepEqual(events, [])
    } finally { unsubscribe() }
  })
}

for (const capability of ['fs.read', 'fs.list'] as const) {
  test(`mapped runner ${capability} refuses a scope omitted by partial Agent and Commission`, async () => {
    const f = await fixture({ scopes: ['~/projects/allowed'] })
    const a = await agent(f, { tools: ['read'] })
    const c = await commission(f, a.id, { connectors: [] })
    await admit(f, [], ['~/projects/allowed', '~/projects/blocked'])
    const session = await call('POST', '/sessions', { firstMessage: 'Local authority check', agentId: a.id }, f.headers)
    assert.equal(session.status, 200)
    const contextId = randomUUID()
    const attached = await call('PATCH', `/sessions/${session.json.id}/context-state`, {
      operations: [{ action: 'attach', context: { id: contextId, type: 'folder', label: 'Test runner', scope: '~/projects' } }],
      workspace: { workspaces: [], repos: [], connectors: [], attachments: [] },
    }, f.headers)
    assert.equal(attached.status, 200)
    const target = (name: string) => `~/projects/${name}${capability === 'fs.read' ? '/note.txt' : ''}`
    const invoke = (name: string, commandId: string) => call('POST', '/runners/runner-local/invoke', {
      sessionId: session.json.id, contextId, commissionId: c.id, capability, target: target(name), commandId,
    }, f.headers)
    const allowed = await invoke('allowed', randomUUID())
    assert.equal(allowed.status, 200, 'the exact same mapped runner, session, Project and Commission can access its inherited scope')
    if (capability === 'fs.read') assert.equal(allowed.json.output.content, 'allowed test-owned bytes')
    else assert.deepEqual(allowed.json.output.entries.map((entry: { name: string }) => entry.name), ['note.txt'])
    const beforeEffects = await call('GET', '/runners/runner-local/effects', undefined, f.headers)
    assert.equal(beforeEffects.status, 200)
    const denied = await invoke('blocked', randomUUID())
    assert.equal(denied.status, 403, 'Project/context/runner admission cannot erase the provider scope restriction')
    assert.equal(denied.json.error.code, 'forbidden')
    assert.ok(!JSON.stringify(denied.json).includes('blocked test-owned bytes'))
    const afterEffects = await call('GET', '/runners/runner-local/effects', undefined, f.headers)
    assert.deepEqual(afterEffects.json, beforeEffects.json, 'a refused read/list adds no successful effect')
  })
}
