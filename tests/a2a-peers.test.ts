/** D28 — peer credentials: verified identity at the A2A edge (docs/agent-commons.md;
 *  the GitHub-parity ledger row 10). The invariants under test: the token is shown
 *  ONCE and only its hash persists (list serves hints, never hashes/tokens); a call
 *  presenting it acts under the peer's REGISTERED name as a verified stamp (postedBy
 *  = the name; verifiedPeer set; comments + bells attribute likewise); an invalid
 *  token is simply unverified on the open dev seam; `A2A_REQUIRE_AUTH` flips the
 *  edge to enforcing (HTTP 401 — auth is transport-level per spec, never a JSON-RPC
 *  error); revocation is deletion. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../server/store.ts'
import { call } from './helpers/http.ts'

const A = 'tenant-peer-A'
const B = 'tenant-peer-B'
let n = 0

async function sharedProject() {
  const projectId = `p-peer-${(n += 1)}`
  store.applyRelationOp({ kind: 'create-project', projectId, projectName: `Peer ${n}`, projectDescription: '' }, A)
  store.applyRelationOp({ kind: 'share-project', projectId, projectName: `Peer ${n}`, shared: true }, A)
  return projectId
}

const sendMsg = (subGoal: string) => ({
  jsonrpc: '2.0',
  id: 1,
  method: 'message/send',
  params: {
    message: { kind: 'message', role: 'user', messageId: 'm-1', parts: [{ kind: 'text', text: subGoal }, { kind: 'data', data: { type: 'charge', target: 'budget:demo' } }] },
  },
})

test('mint shows the token once; the registry serves hints, never hashes or tokens', async () => {
  const minted = await call('POST', '/a2a/peers', { name: `  Beta Instance ${(n += 1)}  ` })
  assert.equal(minted.status, 200)
  assert.ok(minted.json.token.startsWith('rv_live_'), 'the one-time credential')
  assert.equal(minted.json.peer.name, `Beta Instance ${n}`, 'trimmed registered name')
  assert.equal(minted.json.peer.secretHint, minted.json.token.slice(-4))

  const list = await call('GET', '/a2a/peers')
  const raw = JSON.stringify(list.json)
  assert.ok(!raw.includes(minted.json.token), 'the token never appears again')
  assert.ok(!raw.includes('tokenHash'), 'the hash never rides the wire')
  assert.ok(list.json.some((p: any) => p.id === minted.json.peer.id))
})

test('a valid credential stamps the REGISTERED name as verified identity — post, comment, bell', async () => {
  const projectId = await sharedProject()
  const { json: minted } = await call('POST', '/a2a/peers', { name: 'Verified Peer Co' })
  const auth = { authorization: `Bearer ${minted.token}` }

  const posted = await call('POST', `/a2a/projects/${projectId}`, sendMsg(`peer-item-${n}`), { ...auth, 'x-tenant-id': B })
  assert.equal(posted.status, 200)
  const items = (await call('GET', `/projects/${projectId}/open-subgoals`, undefined, { 'x-tenant-id': A })).json
  const item = items.find((o: any) => o.subGoal === `peer-item-${n}`)
  assert.equal(item.postedBy, 'Verified Peer Co', 'the registered name, never the caller headers')
  assert.equal(item.verifiedPeer, 'Verified Peer Co', 'the verification stamp')

  // A continuation comment under the same credential attributes to the peer.
  const cont = {
    jsonrpc: '2.0', id: 2, method: 'message/send',
    params: { message: { kind: 'message', role: 'user', messageId: 'm-2', taskId: item.id, parts: [{ kind: 'text', text: 'peer follow-up' }] } },
  }
  const continued = await call('POST', `/a2a/projects/${projectId}`, cont, { ...auth, 'x-tenant-id': B })
  assert.equal(continued.json.result.history[0].metadata.author, 'Verified Peer Co')
  // The owner's bell names the verified peer as the actor.
  const bell = (await call('GET', '/notifications', undefined, { 'x-tenant-id': A })).json
  assert.ok(bell.some((x: any) => x.kind === 'work.commented' && x.actor === 'Verified Peer Co'))
})

test('open seam: an invalid token is just unverified; enforcement flips to transport 401; revocation kills the credential', async () => {
  const projectId = await sharedProject()
  // Invalid token, open seam ⇒ lands unverified (posting stays the free act).
  const junk = await call('POST', `/a2a/projects/${projectId}`, sendMsg(`unverified-${n}`), { authorization: 'Bearer nonsense', 'x-tenant-id': B })
  assert.equal(junk.status, 200)
  const item = (await call('GET', `/projects/${projectId}/open-subgoals`, undefined, { 'x-tenant-id': A })).json.find((o: any) => o.subGoal === `unverified-${n}`)
  assert.equal(item.verifiedPeer, undefined, 'no stamp without a valid credential')

  // Enforcement: A2A_REQUIRE_AUTH set ⇒ credential-less calls are HTTP 401.
  const { json: minted } = await call('POST', '/a2a/peers', { name: 'Enforced Peer' })
  process.env.A2A_REQUIRE_AUTH = '1'
  try {
    const refused = await call('POST', `/a2a/projects/${projectId}`, sendMsg('walled'), { 'x-tenant-id': B })
    assert.equal(refused.status, 401, 'auth is transport-level, per spec')
    const admitted = await call('POST', `/a2a/projects/${projectId}`, sendMsg(`enforced-${n}`), { authorization: `Bearer ${minted.token}`, 'x-tenant-id': B })
    assert.equal(admitted.status, 200)

    // Revocation is deletion: the same token dies with the peer.
    await call('DELETE', `/a2a/peers/${minted.peer.id}`)
    const dead = await call('POST', `/a2a/projects/${projectId}`, sendMsg('revoked'), { authorization: `Bearer ${minted.token}`, 'x-tenant-id': B })
    assert.equal(dead.status, 401)
  } finally {
    delete process.env.A2A_REQUIRE_AUTH
  }
})

test('the card advertises the scheme; `security` requires it only when enforcing', async () => {
  const open = (await call('GET', '/a2a/card')).json
  assert.ok(open.securitySchemes?.peerBearer, 'the scheme is always advertised')
  assert.equal(open.security, undefined, 'not REQUIRED on the open seam')
  process.env.A2A_REQUIRE_AUTH = '1'
  try {
    const enforced = (await call('GET', '/a2a/card')).json
    assert.ok(Array.isArray(enforced.security), 'enforcement is declared on the card')
  } finally {
    delete process.env.A2A_REQUIRE_AUTH
  }
})
