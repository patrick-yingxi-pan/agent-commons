/** D22 — global search (docs/agent-commons.md): one route, typed grouped hits across
 *  everything the CALLER can see, composed exclusively from the same per-tenant reads
 *  and redactions the pages use. The invariants under test: search never widens
 *  visibility (a foreign private row is absent; a foreign SHARED/PUBLISHED row is
 *  present via its public face); the private/commons split partitions (nothing appears
 *  twice); groups are capped with a true total; an empty query answers nothing. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../store/index.ts'
import { call } from '../testkit/http.ts'
import { artifactCreationId } from '../artifactCreationIdentity.ts'
import { runSessionId } from '../../contract/ids.ts'

const A = 'tenant-srch-A'
const B = 'tenant-srch-B'
let n = 0

const search = async (q: string, tenant: string) =>
  (await call('GET', `/search?q=${encodeURIComponent(q)}`, undefined, { 'x-tenant-id': tenant })).json

const groupOf = (json: any, type: string) => json.groups.find((g: any) => g.type === type)

test('tenant walls: a foreign PRIVATE row is absent; the owner finds it', async () => {
  const needle = `wallmark-${(n += 1)}`
  store.applyRelationOp({ kind: 'create-project', projectId: `p-srch-${n}`, projectName: `Project ${needle}`, projectDescription: '' }, A)
  store.createAgent({ label: `Agent ${needle}`, systemPrompt: 'x', tools: [], instructions: '' }, A)

  const mine = await search(needle, A)
  assert.ok(groupOf(mine, 'project')?.hits.some((h: any) => h.title.includes(needle)), 'the owner finds their project')
  assert.ok(groupOf(mine, 'agent')?.hits.some((h: any) => h.title.includes(needle)), 'the owner finds their agent')

  const theirs = await search(needle, B)
  assert.equal(theirs.groups.length, 0, 'a foreign tenant sees NOTHING of private rows')
})

test('the commons is findable: shared project, published agent (ref = owner), owner, open work', async () => {
  const needle = `commons-${(n += 1)}`
  const projectId = `p-srch-${n}`
  store.applyRelationOp({ kind: 'create-project', projectId, projectName: `Shared ${needle}`, projectDescription: '' }, A)
  store.applyRelationOp({ kind: 'share-project', projectId, projectName: `Shared ${needle}`, shared: true }, A)
  const agent = store.createAgent({ label: `Published ${needle}`, systemPrompt: 'x', tools: [], instructions: '' }, A)
  await call('PATCH', `/agents/${agent.id}`, { published: true }, { 'x-tenant-id': A })
  await call(
    'POST', `/projects/${projectId}/open-subgoals`,
    { subGoal: `todo-${needle}`, type: 'charge', target: 'budget:demo', note: '' },
    { 'x-tenant-id': A },
  )

  const found = await search(needle, B)
  const shared = groupOf(found, 'sharedProject')
  assert.ok(shared?.hits.some((h: any) => h.id === projectId), 'a foreign shared project surfaces via its directory face')
  const pub = groupOf(found, 'publishedAgent')
  const pubHit = pub?.hits.find((h: any) => h.id === agent.id)
  assert.ok(pubHit, 'a foreign published agent surfaces via its directory face')
  assert.equal(pubHit.ref, A, 'ref carries the owner name — the door to its public face (the profile)')
  const work = groupOf(found, 'openWork')
  const workHit = work?.hits.find((h: any) => h.title === `todo-${needle}`)
  assert.ok(workHit, 'open work on a shared project is findable')
  assert.equal(workHit.ref, projectId, 'ref carries the projectId — the door to the backlog')

  // Owners are entities: the workspace name itself matches (D21 profiles are findable).
  const owners = await search(A, B)
  assert.ok(groupOf(owners, 'owner')?.hits.some((h: any) => h.id === A), 'a workspace with a public face is findable by name')
})

test('the private/commons split partitions: an own shared project is "yours", a foreign one is commons — never both', async () => {
  const needle = `partition-${(n += 1)}`
  const projectId = `p-srch-${n}`
  store.applyRelationOp({ kind: 'create-project', projectId, projectName: `Both ${needle}`, projectDescription: '' }, A)
  store.applyRelationOp({ kind: 'share-project', projectId, projectName: `Both ${needle}`, shared: true }, A)

  const mine = await search(needle, A)
  assert.ok(groupOf(mine, 'project')?.hits.some((h: any) => h.id === projectId), 'the owner finds it under Your projects')
  assert.ok(!groupOf(mine, 'sharedProject')?.hits.some((h: any) => h.id === projectId), '…and NOT duplicated in the commons group')

  const theirs = await search(needle, B)
  assert.ok(groupOf(theirs, 'sharedProject')?.hits.some((h: any) => h.id === projectId), 'a visitor finds it in the commons group')
  assert.ok(!groupOf(theirs, 'project')?.hits.some((h: any) => h.id === projectId), '…and NOT under Your projects')
})

test('groups are capped with a true total; hits beyond the cap are counted, not silently dropped', async () => {
  const needle = `capfill-${(n += 1)}`
  for (let i = 0; i < 7; i += 1) {
    store.createAgent({ label: `Agent ${needle} ${i}`, systemPrompt: 'x', tools: [], instructions: '' }, A)
  }
  const found = await search(needle, A)
  const agents = groupOf(found, 'agent')
  assert.equal(agents.hits.length, 5, 'capped at SEARCH_GROUP_CAP')
  assert.equal(agents.total, 7, 'the total is honest')
})

test('category paging returns live 20-hit slices, true totals, and stable empty groups', async () => {
  const needle = `pages-${(n += 1)}`
  const createdIds: string[] = []
  for (let i = 0; i < 45; i += 1) {
    createdIds.push(store.createAgent({ label: `Agent ${needle} ${i}`, systemPrompt: 'x', tools: [], instructions: '' }, A).id)
  }
  const expectedIds = store.listAgents(A).filter((agent) => agent.label.includes(needle)).map((agent) => agent.id)
  assert.equal(expectedIds.length, 45)
  assert.deepEqual(new Set(expectedIds), new Set(createdIds), 'expected IDs come from the live reader projection')
  const page = async (offset: number) => call('GET', `/search?q=${needle}&type=agent&offset=${offset}`, undefined, { 'x-tenant-id': A })
  const first = await page(0)
  const second = await page(20)
  const last = await page(40)
  const beyond = await page(60)
  const foreign = await call('GET', `/search?q=${needle}&type=agent&offset=0`, undefined, { 'x-tenant-id': B })
  const allPageIds = [first, second, last].flatMap((response) => response.json.groups[0].hits.map((hit: any) => hit.id))
  assert.deepEqual(allPageIds, expectedIds, 'page concatenation preserves actual store reader order and exhausts the category')
  assert.equal(new Set(allPageIds).size, allPageIds.length, 'pages are disjoint')
  assert.deepEqual(foreign.json.groups[0].hits, [], 'another tenant receives no private page rows')
  assert.equal(foreign.json.groups[0].total, 0)
  for (const [response, length, offset] of [[first, 20, 0], [second, 20, 20], [last, 5, 40], [beyond, 0, 60]] as const) {
    assert.equal(response.status, 200)
    assert.deepEqual(response.json.page, { type: 'agent', offset })
    assert.equal(response.json.groups.length, 1, 'paged category stays present, including beyond its end')
    assert.equal(response.json.groups[0].label, 'Your agents')
    assert.equal(response.json.groups[0].total, 45)
    assert.equal(response.json.groups[0].hits.length, length)
  }
  const empty = await call('GET', '/search?type=agent', undefined, { 'x-tenant-id': B })
  assert.deepEqual(empty.json.groups, [{ type: 'agent', label: 'Your agents', total: 0, hits: [] }])
  assert.deepEqual(empty.json.page, { type: 'agent', offset: 0 })
})

test('session search returns one readable conversation hit with the first current message match', async () => {
  const needle = `message-only-${(n += 1)}`
  const session = store.createSession(`Title without needle ${n}`, A)
  store.appendMessage(session.id, { id: `first-${n}`, role: 'user', content: `前置語 ${needle} 本文` })
  store.appendMessage(session.id, { id: `later-${n}`, role: 'assistant', content: `later ${needle}` })
  store.appendMessage(session.id, { id: `latest-${n}`, role: 'assistant', content: 'latest preview without the term' })

  const response = await call('GET', `/search?q=${encodeURIComponent(needle)}&type=session`, undefined, { 'x-tenant-id': A })
  assert.equal(response.status, 200)
  const hits = groupOf(response.json, 'session')
  assert.equal(hits.total, 1, 'a conversation is counted once even if multiple messages match')
  assert.deepEqual(hits.hits, [{
    type: 'session', id: session.id, title: session.title,
    subtitle: `前置語 ${needle} 本文`, match: { messageId: `first-${n}`, role: 'user' },
  }], 'the first current user/assistant match supplies the bounded preview and identity')
})

test('session global search retains title/preview fallback and follows grants without crossing foreign walls', async () => {
  const needle = `session-fallback-${(n += 1)}`
  const fallback = store.createSession(`Title ${needle}`, A)
  const owner = store.defaultTenantId()
  const reader = 'tenant-beta'
  const shared = store.createSession(`Shared title ${n}`, owner)
  store.appendMessage(shared.id, { id: `shared-message-${n}`, role: 'assistant', content: needle })
  const grant = store.createGrant({
    subject: { kind: 'session', id: shared.id }, audience: { kind: 'org', orgId: reader }, tier: 'view',
  }, owner)
  assert.equal(typeof grant, 'object')

  const ownerResults = await search(needle, A)
  const fallbackHit = groupOf(ownerResults, 'session')?.hits.find((hit: any) => hit.id === fallback.id)
  assert.ok(fallbackHit)
  assert.equal(fallbackHit.match, undefined, 'metadata-only matches keep the existing session preview without message identity')

  const sharedResults = await call('GET', `/search?q=${encodeURIComponent(needle)}&type=session`, undefined, { 'x-tenant-id': reader })
  assert.equal(sharedResults.json.groups[0].total, 1, 'a reader grant makes the matching message globally findable')
  assert.equal(sharedResults.json.groups[0].hits[0].id, shared.id)
  assert.equal(sharedResults.json.groups[0].hits[0].match.messageId, `shared-message-${n}`)

  const foreign = await call('GET', `/search?q=${encodeURIComponent(needle)}&type=session`, undefined, { 'x-tenant-id': 'tenant-search-foreign' })
  assert.equal(foreign.json.groups[0].total, 0, 'an ungranted foreign tenant cannot discover the session')

  assert.ok(grant && typeof grant === 'object')
  store.revokeGrant(grant.id, owner)
  const revoked = await call('GET', `/search?q=${encodeURIComponent(needle)}&type=session`, undefined, { 'x-tenant-id': reader })
  assert.equal(revoked.json.groups[0].total, 0, 'the live grant is rechecked for each global query')
})

test('session message hits keep conversation ordering, overview cap, and 20-row category paging', async () => {
  const needle = `session-page-${(n += 1)}`
  const created: string[] = []
  for (let index = 0; index < 23; index += 1) {
    const session = store.createSession(`Conversation ${index}`, A)
    store.appendMessage(session.id, { id: `page-message-${n}-${index}`, role: 'assistant', content: `${needle} row-${index}` })
    created.push(session.id)
  }
  const expected = [...created].reverse()
  const overview = await search(needle, A)
  const overviewGroup = groupOf(overview, 'session')
  assert.equal(overviewGroup.total, 23)
  assert.equal(overviewGroup.hits.length, 5, 'overview stays capped at SEARCH_GROUP_CAP')
  assert.deepEqual(overviewGroup.hits.map((hit: any) => hit.id), expected.slice(0, 5))

  const pages = await Promise.all([0, 20, 40].map((offset) => call(
    'GET', `/search?q=${encodeURIComponent(needle)}&type=session&offset=${offset}`, undefined, { 'x-tenant-id': A },
  )))
  assert.deepEqual(pages.map((page) => page.json.groups[0].hits.length), [20, 3, 0])
  assert.deepEqual(pages.map((page) => page.json.groups[0].total), [23, 23, 23])
  assert.deepEqual(pages.flatMap((page) => page.json.groups[0].hits.map((hit: any) => hit.id)), expected)
})

test('global search bounds every query at the declared shared search limit', async () => {
  const tooLong = await call('GET', `/search?q=${'x'.repeat(257)}`, undefined, { 'x-tenant-id': A })
  assert.equal(tooLong.status, 400)
  const allowed = await call('GET', `/search?q=${'x'.repeat(256)}`, undefined, { 'x-tenant-id': A })
  assert.equal(allowed.status, 200)
  assert.throws(() => store.searchAll(A, 'x'.repeat(257)), /limited to 256 characters/)
  const padded = ` ${'x'.repeat(256)}`
  assert.equal((await call('GET', `/search?q=${encodeURIComponent(padded)}`, undefined, { 'x-tenant-id': A })).status, 400)
  assert.throws(() => store.searchAll(A, padded), /limited to 256 characters/)

  const { catalogOf } = await import('../apiSurface.ts')
  const { buildRouter } = await import('./index.ts')
  const operation = catalogOf(buildRouter()).find((item) => item.method === 'GET' && item.pattern === '/search')
  assert.equal(operation?.query?.q && (operation.query.q as any).maxLength, 256, 'HTTP/MCP share the same bounded route schema')
})

test('global session search excludes attachments, tool details, archived originals, and scheduled runs', async () => {
  const needle = `excluded-transcript-source-${(n += 1)}`
  const session = store.createSession('No indexed text here', A)
  store.appendMessage(session.id, { id: `plain-${n}`, role: 'user', content: 'ordinary user text' })
  store.appendMessage(session.id, { id: `latest-${n}`, role: 'assistant', content: 'ordinary assistant text' })
  session.compactedMessages = [{ id: `archive-${n}`, role: 'assistant', content: needle }]
  session.workspace = {
    workspaces: [], repos: [], connectors: [],
    attachments: [{ id: `attachment-${n}`, kind: 'file', label: needle, previewText: needle }],
  }
  session.messages[1]!.toolActivities = [{ tool: needle, summary: needle }] as any
  session.messages.push({ id: `tool-${n}`, role: 'tool', content: needle } as any)

  const source = store.listSchedules()[0]
  assert.ok(source, 'a fixture routine is available to materialize a run conversation')
  const { id: _id, tenantId: _tenantId, ...seed } = structuredClone(source)
  const task = store.addSchedule({
    ...seed, name: `Search exclusion routine ${n}`, tenantId: A, runs: [], enabled: false,
  })
  try {
    const run = store.runSchedule(task.id, { manualRunId: `run-search-exclusion-${n}` })
    assert.ok(run)
    const runSession = store.getSession(runSessionId(task.id, run.id))
    assert.ok(runSession)
    store.appendMessage(runSession.id, { id: `scheduled-hit-${n}`, role: 'assistant', content: needle })

    const response = await call('GET', `/search?q=${encodeURIComponent(needle)}&type=session`, undefined, { 'x-tenant-id': A })
    assert.equal(response.status, 200)
    assert.equal(response.json.groups[0].total, 0, 'only current user/assistant body text is indexed in human sessions')
  } finally {
    store.removeSchedule(task.id)
  }
})

test('search page inputs reject absent type, malformed offsets, unsupported types, and duplicates', async () => {
  for (const query of [
    '?offset=0', '?type=agent&offset=', '?type=agent&offset=-1', '?type=agent&offset=1.5',
    '?type=agent&offset=1e2', '?type=agent&offset=9007199254740992', '?type=missing',
    '?type=agent&type=agent', '?type=agent&offset=0&offset=1', '?q=x&q=y',
  ]) {
    const response = await call('GET', `/search${query}`, undefined, { 'x-tenant-id': A })
    assert.equal(response.status, 400, query)
  }
})

test('artifact body excerpts are searchable and category pages recheck current visibility', async () => {
  const excerptNeedle = `bodyexcerpt-${(n += 1)}`
  const artifactId = artifactCreationId(A, `search-excerpt-${n}`)
  store.createArtifact({ name: `Notes ${n}.md`, kind: 'doc', body: `A body contains ${excerptNeedle} only.` }, A, artifactId)
  const artifactSearch = await call('GET', `/search?q=${excerptNeedle}&type=artifact`, undefined, { 'x-tenant-id': A })
  assert.ok(artifactSearch.json.groups[0].hits.some((hit: any) => hit.id === artifactId), 'the reader-projected excerpt participates in matching')
  const foreignArtifactSearch = await call('GET', `/search?q=${excerptNeedle}&type=artifact`, undefined, { 'x-tenant-id': B })
  assert.equal(foreignArtifactSearch.json.groups[0].total, 0, 'a private body excerpt does not cross the tenant wall')

  const projectId = `p-live-page-${n}`
  const liveNeedle = `livepage-${n}`
  store.applyRelationOp({ kind: 'create-project', projectId, projectName: `Visible ${liveNeedle}`, projectDescription: '' }, A)
  store.applyRelationOp({ kind: 'share-project', projectId, projectName: `Visible ${liveNeedle}`, shared: true }, A)
  const visible = await call('GET', `/search?q=${liveNeedle}&type=sharedProject`, undefined, { 'x-tenant-id': B })
  assert.equal(visible.json.groups[0].total, 1)
  store.applyRelationOp({ kind: 'share-project', projectId, projectName: `Visible ${liveNeedle}`, shared: false }, A)
  const revoked = await call('GET', `/search?q=${liveNeedle}&type=sharedProject`, undefined, { 'x-tenant-id': B })
  assert.equal(revoked.json.groups[0].total, 0, 'each page composes current authorized reads')
})

test('an empty (or whitespace) query answers no groups', async () => {
  const empty = await call('GET', '/search?q=%20%20', undefined, { 'x-tenant-id': A })
  assert.equal(empty.status, 200)
  assert.deepEqual(empty.json.groups, [])
  const missing = await call('GET', '/search', undefined, { 'x-tenant-id': A })
  assert.deepEqual(missing.json.groups, [])
})

test('registries and routines are findable through the same scoped reads their pages use', async () => {
  const needle = `registry-${(n += 1)}`
  store.createSystemPrompt({ label: `Prompt ${needle}`, body: 'be kind', targetFamily: 'claude' }, A)
  const found = await search(needle, A)
  assert.ok(groupOf(found, 'prompt')?.hits.some((h: any) => h.title.includes(needle)), 'a created prompt is findable by its owner')
  const foreign = await search(needle, B)
  assert.ok(!groupOf(foreign, 'prompt'), 'and invisible to a foreign tenant')
})
