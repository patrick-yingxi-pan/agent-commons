/** Unbound imported/forked definitions inherit grants from the current fixed
 * default row. Personal preferred providers never redefine that root. */
import { after, afterEach, before, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { DEFAULT_PROVIDER_ID, type Agent, type Authority, type Budget, type Commission, type ModelProvider } from '../../contract/index.ts'
import { accounts } from '../accounts.ts'
import { SESSION_COOKIE, signSession } from '../auth.ts'
import { store } from '../store/index.ts'
import { call, callFresh } from '../testkit/http.ts'

const FIVE_HOUR = '5-hour limit'
const budget = (ceiling: number): Budget => ({ windows: [{ label: FIVE_HOUR, ceiling }] })
const cards = new Map<string, { name: string; hits: number }>()
let unexpectedRequests = 0
before(() => {
  mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const card = cards.get(url)
    if (!card) {
      unexpectedRequests += 1
      throw new Error('Only the authored card fixture may be fetched; no provider/model I/O.')
    }
    card.hits += 1
    return new Response(JSON.stringify({ protocolVersion: '0.3.0', name: card.name,
      description: 'A definition to configure locally.', url: `${url}/agent`,
      skills: [{ id: 'review', name: 'Review', description: 'Review only.', tags: [] }] }),
    { status: 200, headers: { 'content-type': 'application/json' } })
  })
})
afterEach(() => assert.equal(unexpectedRequests, 0, 'no public network or model endpoint is called'))
after(() => mock.restoreAll())

function cookie(userId: string, tenantId: string) {
  return { cookie: `${SESSION_COOKIE}=${signSession({ userId, tenantId, iat: Date.now() })}` }
}
const rootHeaders = () => cookie('user-ada', store.defaultTenantId())

async function read<T>(path: string, headers: Record<string, string>): Promise<T> {
  const response = await call('GET', path, undefined, headers)
  assert.equal(response.status, 200, JSON.stringify(response.json))
  return response.json
}

async function setRoot(ceiling: number, authority: Authority, key = randomUUID()) {
  const before = await read<ModelProvider>(`/providers/${DEFAULT_PROVIDER_ID}`, rootHeaders())
  const body = { plan: budget(ceiling), authority, expectedRevision: before.definitionRevision ?? 0 }
  const headers = { ...rootHeaders(), 'idempotency-key': key }
  const response = await call('PATCH', `/providers/${DEFAULT_PROVIDER_ID}`, body, headers)
  assert.equal(response.status, 200)
  assert.deepEqual(response.json.plan, budget(ceiling))
  assert.deepEqual(response.json.authority, authority)
  return { body, headers, provider: response.json as ModelProvider }
}

type Mode = 'import' | 'fork'
async function fixture(mode: Mode, ceiling = 100, authority: Authority = { tools: ['read'] }) {
  await setRoot(ceiling, authority)
  const stamp = randomUUID()
  const org = accounts.createOrg('user-ada', `Unbound grants ${stamp}`)
  assert.ok(org)
  const headers = cookie('user-ada', org.id)
  // A deliberately more permissive personal preference must remain a shortcut,
  // never the root of an absent provider binding.
  const preferred = await call('POST', '/providers', {
    label: `Preferred provider ${stamp}`, modelFamily: 'claude', effortLevels: [],
    plan: budget(1_000), authority: { tools: ['*'], connectors: ['*'], scopes: ['*'] }, isDefault: true,
  }, headers)
  assert.equal(preferred.status, 200)
  const registry = await read<ModelProvider[]>('/providers', headers)
  assert.equal(registry.find(row => row.isDefault)?.id, preferred.json.id)
  assert.deepEqual(registry.find(row => row.id === DEFAULT_PROVIDER_ID)?.plan, budget(ceiling))
  const creationHeaders = { ...headers, 'idempotency-key': randomUUID() }
  let response: Awaited<ReturnType<typeof call>>
  let replay: () => Promise<Awaited<ReturnType<typeof call>>>
  let noRefetchOrCredit: () => void
  let foreignProviderId: string | undefined
  if (mode === 'import') {
    const url = `https://authored-card.example.test/${stamp}/card.json`
    const card = { name: `Imported definition ${stamp}`, hits: 0 }
    cards.set(url, card)
    response = await call('POST', '/agents/import-card', { url }, creationHeaders)
    replay = () => callFresh('POST', '/agents/import-card', { url: 'https://never-fetch.example.test/changed' }, creationHeaders)
    noRefetchOrCredit = () => assert.equal(card.hits, 1, 'exact import replay never fetches the card twice')
  } else {
    const sourceOrg = accounts.createOrg('user-grace', `Private fork source ${stamp}`)
    assert.ok(sourceOrg)
    const sourceHeaders = cookie('user-grace', sourceOrg.id)
    const sourceProvider = await call('POST', '/providers', {
      label: `Foreign private provider ${stamp}`, modelFamily: 'claude', effortLevels: [],
    }, sourceHeaders)
    assert.equal(sourceProvider.status, 200)
    foreignProviderId = sourceProvider.json.id
    const prompt = await call('POST', '/system-prompts', { label: `Private source prompt ${stamp}`, body: 'Review.', targetFamily: 'claude' }, sourceHeaders)
    assert.equal(prompt.status, 200)
    const source = await call('POST', '/agents', {
      label: `Forked definition ${stamp}`, providerId: sourceProvider.json.id, systemPromptId: prompt.json.id, tools: [],
    }, sourceHeaders)
    assert.equal(source.status, 200)
    assert.equal((await call('PATCH', `/agents/${source.json.id}`, { published: true, expectedRevision: 0 }, sourceHeaders)).status, 200)
    response = await call('POST', `/agents/${source.json.id}/fork`, {}, creationHeaders)
    replay = () => callFresh('POST', `/agents/${source.json.id}/fork`, {}, creationHeaders)
    noRefetchOrCredit = () => assert.equal(store.getAgent(source.json.id).forks, 1, 'exact fork replay awards credit only once')
  }
  assert.equal(response.status, 200)
  const agent = response.json as Agent
  assert.equal(agent.providerId, undefined, 'a missing/foreign-private binding stays absent')
  assert.equal(agent.budget, undefined)
  assert.equal(agent.authority, undefined)
  const project = await call('POST', '/projects', { name: `Unbound Project ${stamp}` }, headers)
  assert.equal(project.status, 201)
  return { mode, headers, tenantId: org.id, agent, preferredId: preferred.json.id as string,
    projectId: project.json.project.id as string, replay, noRefetchOrCredit, foreignProviderId }
}
type Fixture = Awaited<ReturnType<typeof fixture>>

async function commission(f: Fixture, grant?: Budget, authority?: Authority) {
  const response = await call('POST', '/commissions', {
    agentId: f.agent.id, projectId: f.projectId, role: 'writer', ...(grant ? { grant } : {}), ...(authority ? { authority } : {}),
  }, f.headers)
  assert.equal(response.status, 200)
  return response.json as Commission
}

async function snapshot(f: Fixture) {
  return Promise.all([
    read<Agent>(`/agents/${f.agent.id}`, f.headers),
    read<Commission[]>(`/commissions?project=${f.projectId}`, f.headers),
    read<ModelProvider[]>('/providers', f.headers),
  ])
}

async function refuseWithoutMutation(f: Fixture, method: 'POST' | 'PATCH', path: string, body: unknown, status = 400) {
  const before = await snapshot(f)
  const events: unknown[] = []
  const unsubscribe = store.subscribe(event => events.push(event))
  try {
    const response = await call(method, path, body, f.headers)
    assert.equal(response.status, status, 'the current fixed default—not a static seed or personal preference—bounds the grant')
    assert.equal(response.json.error.code, status === 404 ? 'not_found' : 'bad_request')
    assert.deepEqual(await snapshot(f), before)
    assert.deepEqual(events, [], 'refusal changes no row/revision or event stream')
  } finally { unsubscribe() }
}

for (const mode of ['import', 'fork'] as const) {
  for (const face of ['budget', 'authority'] as const) {
    for (const target of ['Agent PATCH', 'Commission POST', 'Commission PATCH'] as const) {
      test(`${mode} ${target} refuses ${face} beyond the live fixed default despite a wider preferred provider`, async () => {
        const f = await fixture(mode)
        const invalid = face === 'budget' ? budget(101) : { tools: ['write'] }
        if (target === 'Agent PATCH') {
          await refuseWithoutMutation(f, 'PATCH', `/agents/${f.agent.id}`, {
            [face === 'budget' ? 'budget' : 'authority']: invalid, expectedRevision: f.agent.revision ?? 0,
          })
        } else if (target === 'Commission POST') {
          await refuseWithoutMutation(f, 'POST', '/commissions', {
            agentId: f.agent.id, projectId: f.projectId, role: 'writer', [face === 'budget' ? 'grant' : 'authority']: invalid,
          })
        } else {
          const created = await commission(f)
          await refuseWithoutMutation(f, 'PATCH', `/commissions/${created.id}`, {
            [face === 'budget' ? 'grant' : 'authority']: invalid, expectedRevision: created.configurationRevision ?? 0,
          })
        }
      })
    }
  }

  test(`${mode} inherited Commission authority reads the live fixed default without binding the Agent`, async () => {
    const f = await fixture(mode)
    const created = await commission(f)
    const reach = await read<Authority>(`/commissions/${created.id}/authority`, f.headers)
    assert.deepEqual(reach, { tools: ['read'], connectors: [], scopes: [] }, 'Project admission retains the current inherited tool ceiling')
    assert.equal((await read<Agent>(`/agents/${f.agent.id}`, f.headers)).providerId, undefined)
    const inherited = await read<Commission>(`/commissions/${created.id}`, f.headers)
    assert.equal(inherited.authority, undefined, 'runtime inheritance does not expand stored configuration')
  })

  test(`${mode} valid grant edits preserve absent binding and exact import/fork/Commission replay`, async () => {
    const f = await fixture(mode)
    const creationReplay = await f.replay()
    assert.equal(creationReplay.status, 200)
    assert.deepEqual(creationReplay.json, f.agent)
    f.noRefetchOrCredit()
    const patched = await call('PATCH', `/agents/${f.agent.id}`, {
      budget: budget(90), authority: { tools: ['read'] }, expectedRevision: 0,
    }, f.headers)
    assert.equal(patched.status, 200)
    assert.equal(patched.json.providerId, undefined)
    assert.deepEqual(patched.json.budget, budget(90))
    const headers = { ...f.headers, 'idempotency-key': randomUUID() }
    const body = { agentId: f.agent.id, projectId: f.projectId, role: 'writer', grant: budget(80), authority: { tools: ['read'] } }
    const created = await call('POST', '/commissions', body, headers)
    assert.equal(created.status, 200)
    const events: unknown[] = []
    const unsubscribe = store.subscribe(event => events.push(event))
    try {
      const replay = await callFresh('POST', '/commissions', { ...body, role: 'reader' }, headers)
      assert.equal(replay.status, 200)
      assert.deepEqual(replay.json, { ...created.json, mine: true })
      assert.deepEqual(events, [])
    } finally { unsubscribe() }
    const updateHeaders = { ...f.headers, 'idempotency-key': randomUUID() }
    const update = { grant: budget(70), expectedRevision: 0 }
    const saved = await call('PATCH', `/commissions/${created.json.id}`, update, updateHeaders)
    assert.equal(saved.status, 200)
    assert.deepEqual(saved.json.grant, budget(70))
    assert.equal(saved.json.configurationRevision, 1)
    const replay = await call('PATCH', `/commissions/${created.json.id}`, update, updateHeaders)
    assert.equal(replay.status, 200)
    assert.deepEqual(replay.json, saved.json)
    assert.equal((await read<Commission[]>(`/commissions?project=${f.projectId}`, f.headers)).length, 1)
    assert.equal((await read<Agent>(`/agents/${f.agent.id}`, f.headers)).providerId, undefined)
    assert.equal((await read<ModelProvider[]>('/providers', f.headers)).find(row => row.isDefault)?.id, f.preferredId)
  })

  for (const explicitAgentGrant of [false, true]) {
    test(`${mode} default shrink clamps ${explicitAgentGrant ? 'explicit Agent and child' : 'child through inherited Agent'} grants exactly once`, async () => {
      const f = await fixture(mode, 100, { tools: ['read', 'write'] })
      if (explicitAgentGrant) {
        const updated = await call('PATCH', `/agents/${f.agent.id}`, {
          budget: budget(80), authority: { tools: ['read', 'write'] }, expectedRevision: 0,
        }, f.headers)
        assert.equal(updated.status, 200)
      }
      const child = await commission(f, budget(70), { tools: ['write'] })
      const beforeAgent = await read<Agent>(`/agents/${f.agent.id}`, f.headers)
      const shrunk = await setRoot(50, { tools: ['read'] })
      const afterAgent = await read<Agent>(`/agents/${f.agent.id}`, f.headers)
      assert.equal(afterAgent.providerId, undefined)
      assert.deepEqual(afterAgent.budget, explicitAgentGrant ? budget(50) : undefined)
      assert.deepEqual(afterAgent.authority, explicitAgentGrant ? { tools: ['read'] } : undefined)
      assert.equal(afterAgent.revision, (beforeAgent.revision ?? 0) + (explicitAgentGrant ? 1 : 0))
      const afterChild = await read<Commission>(`/commissions/${child.id}`, f.headers)
      assert.deepEqual(afterChild.grant, budget(50), 'unbound Agent children follow the live fixed default shrink')
      assert.deepEqual(afterChild.authority, { tools: [] })
      assert.equal(afterChild.configurationRevision, (child.configurationRevision ?? 0) + 1)
      const beforeReplay = await snapshot(f)
      const events: unknown[] = []
      const unsubscribe = store.subscribe(event => events.push(event))
      try {
        const replay = await call('PATCH', `/providers/${DEFAULT_PROVIDER_ID}`, shrunk.body, shrunk.headers)
        assert.equal(replay.status, 200)
        assert.deepEqual(await snapshot(f), beforeReplay)
        assert.deepEqual(events, [], 'keyed parent replay never re-clamps or advances child revisions twice')
      } finally { unsubscribe() }
      f.noRefetchOrCredit()
    })
  }
}

test('normal Agent binding edits still existence-hide explicit unknown and foreign-private provider ids', async () => {
  const f = await fixture('fork')
  assert.ok(f.foreignProviderId)
  await refuseWithoutMutation(f, 'PATCH', `/agents/${f.agent.id}`, { providerId: 'provider-does-not-exist', expectedRevision: 0 }, 404)
  await refuseWithoutMutation(f, 'PATCH', `/agents/${f.agent.id}`, { providerId: f.foreignProviderId, expectedRevision: 0 }, 404)
})
