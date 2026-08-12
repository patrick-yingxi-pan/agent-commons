/** D20, the outbound half — importing a remote A2A Agent Card (the federation seed):
 *  `POST /agents/import-card` fetches a REAL remote card over HTTP (an in-test server
 *  here, so the wire path is exercised, not a transcript of it) and mints a private,
 *  UNBOUND definition-stub Agent. The invariants under test: the stub carries the
 *  card's definition + `importedFrom` lineage and NOTHING capability-shaped (no
 *  authority / budget / provider binding — D18's wall, across instances); it is
 *  tenant-private; and a bad URL / unreachable host / non-card payload is refused
 *  without minting anything. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { store } from '../store/index.ts'
import { call } from '../testkit/http.ts'

const A = 'tenant-import-A'
const B = 'tenant-import-B'

/** Serve one canned response; returns the base URL + a close handle. */
function serve(payload: string, status = 200, headers: Record<string, string> = {}): Promise<{ url: string; close: () => Promise<void>; hits: () => number }> {
  let hits = 0
  const server: Server = createServer((_req, res) => {
    hits += 1
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers })
    res.end(payload)
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number }
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(() => r())),
        hits: () => hits,
      })
    })
  })
}

const CARD = JSON.stringify({
  protocolVersion: '0.3.0',
  name: 'Remote Researcher',
  description: 'Summarizes sources with citations.',
  url: 'http://elsewhere.example/api/v1/a2a/agents/agent-9',
  skills: [{ id: 'summarize', name: 'Summarize', description: 'x', tags: [] }],
})

test('importing a card mints a private, UNBOUND definition stub with lineage', async () => {
  const remote = await serve(CARD)
  try {
    const cardUrl = `${remote.url}/a2a/agents/agent-9/card`
    const res = await call('POST', '/agents/import-card', { url: cardUrl }, { 'x-tenant-id': A })
    assert.equal(res.status, 200)
    assert.equal(remote.hits(), 1, 'the server really fetched the remote card')
    const agent = res.json
    assert.equal(agent.label, 'Remote Researcher')
    assert.deepEqual(agent.importedFrom, { url: cardUrl, name: 'Remote Researcher' }, 'lineage stamped')
    assert.match(agent.instructions, /Summarizes sources/, 'the card description survives as instructions')
    assert.match(agent.instructions, /Advertised skills \(remote\): Summarize/, 'skills digest recorded')
    // The wall: nothing capability-shaped was created (the importing owner re-grants via D8).
    assert.deepEqual(agent.tools, [], 'a remote skill maps to no local tool')
    assert.equal(agent.authority, undefined)
    assert.equal(agent.budget, undefined)
    assert.equal(agent.providerId, undefined)

    // Tenant-private, like any created Agent: the importer sees it; a stranger does not.
    assert.ok(store.listAgents(A).some((a) => a.id === agent.id))
    assert.ok(!store.listAgents(B).some((a) => a.id === agent.id))
  } finally {
    await remote.close()
  }
})

test('refusals: non-http url, unreachable host, and a payload that is not a card — nothing minted', async () => {
  const before = store.listAgents(A).length

  const scheme = await call('POST', '/agents/import-card', { url: 'ftp://cards.example/card.json' }, { 'x-tenant-id': A })
  assert.equal(scheme.status, 400, 'http(s) only')

  // A closed port on loopback: connection refused, surfaced as the server's message.
  const dead = await call('POST', '/agents/import-card', { url: 'http://127.0.0.1:9/card.json' }, { 'x-tenant-id': A })
  assert.equal(dead.status, 400)
  assert.match(dead.json.error.message, /Could not fetch/i)

  const notCard = await serve(JSON.stringify({ hello: 'world' }))
  try {
    const res = await call('POST', '/agents/import-card', { url: `${notCard.url}/x.json` }, { 'x-tenant-id': A })
    assert.equal(res.status, 400)
    assert.match(res.json.error.message, /name/, 'a card without a name is not a card')
  } finally {
    await notCard.close()
  }

  const notJson = await serve('<html>hi</html>')
  try {
    const res = await call('POST', '/agents/import-card', { url: `${notJson.url}/x.json` }, { 'x-tenant-id': A })
    assert.equal(res.status, 400)
  } finally {
    await notJson.close()
  }

  const upstream404 = await serve('nope', 404)
  try {
    const res = await call('POST', '/agents/import-card', { url: `${upstream404.url}/x.json` }, { 'x-tenant-id': A })
    assert.equal(res.status, 400)
    assert.match(res.json.error.message, /HTTP 404/)
  } finally {
    await upstream404.close()
  }

  // An oversized body is cut off DURING the read (streamed cap), not buffered whole.
  const huge = await serve('x'.repeat(300 * 1024))
  try {
    const res = await call('POST', '/agents/import-card', { url: `${huge.url}/x.json` }, { 'x-tenant-id': A })
    assert.equal(res.status, 400)
    assert.match(res.json.error.message, /too large/i)
  } finally {
    await huge.close()
  }

  // A redirect would hop the vetted URL to another host — refused, never followed.
  const bounce = await serve('', 302, { Location: 'http://127.0.0.1:9/elsewhere.json' })
  try {
    const res = await call('POST', '/agents/import-card', { url: `${bounce.url}/x.json` }, { 'x-tenant-id': A })
    assert.equal(res.status, 400)
    assert.match(res.json.error.message, /Could not fetch/i)
  } finally {
    await bounce.close()
  }

  assert.equal(store.listAgents(A).length, before, 'no refusal minted an agent')
})

test('untrusted card fields are trimmed and capped before landing in the registry', async () => {
  const bloated = await serve(JSON.stringify({
    name: `  ${'N'.repeat(500)}  `,
    description: 'D'.repeat(9000),
    skills: Array.from({ length: 40 }, (_, i) => ({ id: `skill-${i}`, name: 'S'.repeat(300) })),
  }))
  try {
    const res = await call('POST', '/agents/import-card', { url: `${bloated.url}/card.json` }, { 'x-tenant-id': A })
    assert.equal(res.status, 200)
    assert.equal(res.json.label.length, 120, 'label trimmed + capped')
    assert.equal(res.json.importedFrom.name, res.json.label, 'lineage carries the same capped name')
    assert.ok(res.json.instructions.length < 4000, 'description + skills digest bounded')
    assert.equal((res.json.instructions.match(/S{80}/g) ?? []).length, 12, 'at most 12 skills, each capped')
  } finally {
    await bloated.close()
  }
})

test('the imported stub forks/edits like any local agent (it IS one — the definition landed)', async () => {
  const remote = await serve(CARD)
  try {
    const res = await call('POST', '/agents/import-card', { url: `${remote.url}/card` }, { 'x-tenant-id': A })
    const imported = res.json
    // The owner may publish its import onward (definition re-shared, still no capability)…
    const published = await call('PATCH', `/agents/${imported.id}`, { published: true }, { 'x-tenant-id': A })
    assert.equal(published.status, 200)
    // …and a third tenant may fork it — lineage chains locally from there.
    const fork = await call('POST', `/agents/${imported.id}/fork`, {}, { 'x-tenant-id': B })
    assert.equal(fork.status, 200)
    assert.equal(fork.json.forkedFrom.agentId, imported.id)
  } finally {
    await remote.close()
  }
})
