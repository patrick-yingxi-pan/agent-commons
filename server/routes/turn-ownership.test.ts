/** Session turns are host control over an owned conversation. Social grants
 *  widen the read wall, but comment/propose tiers govern Discussions and
 *  SocialProposals; they do not authorize sending prompts or stopping a turn. */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import { startModelServer } from '../model/index.ts'
import { store } from '../store/index.ts'
import { turns } from '../turns.ts'
import { call, callRaw } from '../testkit/http.ts'

const OWNER = 'tenant-turn-owner'
const AUDIENCE = 'tenant-beta'
const FOREIGN = 'tenant-turn-foreign'
const tiers = ['view', 'comment', 'propose'] as const

let server: Server
let sequence = 0
const previousModelUrl = process.env.ANTHROPIC_BASE_URL

before(async () => {
  server = startModelServer(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`
})

after(() => {
  if (previousModelUrl === undefined) delete process.env.ANTHROPIC_BASE_URL
  else process.env.ANTHROPIC_BASE_URL = previousModelUrl
  server.close()
})

function sharedSession(tier: typeof tiers[number]) {
  sequence += 1
  const session = store.createSession(`turn ownership ${tier} ${sequence}`, OWNER)
  const grant = store.createGrant({
    subject: { kind: 'session', id: session.id },
    audience: { kind: 'org', orgId: AUDIENCE },
    tier,
  }, OWNER)
  assert.ok(grant && typeof grant === 'object', `fixture ${tier} grant created`)
  return session
}

test('session grants at view, comment, and propose do not authorize prompt sends', async () => {
  const attempts: Array<{ tier: string; status: number; before: unknown; after: unknown; live: boolean }> = []
  for (const tier of tiers) {
    const session = sharedSession(tier)
    const detail = await call('GET', `/sessions/${session.id}`, undefined, { 'x-tenant-id': AUDIENCE })
    assert.equal(detail.status, 200, `${tier} audience can read the shared conversation`)
    assert.equal(detail.json.own, false, `${tier} audience is explicitly not its owner`)
    const beforeMessages = structuredClone(store.getSession(session.id)?.messages)
    const result = await callRaw(
      'POST',
      `/sessions/${session.id}/messages`,
      { text: `unauthorized ${tier} prompt` },
      { 'x-tenant-id': AUDIENCE },
    )
    attempts.push({
      tier,
      status: result.status,
      before: beforeMessages,
      after: structuredClone(store.getSession(session.id)?.messages),
      live: turns.bySession(session.id) !== undefined,
    })
  }
  assert.deepEqual(attempts, tiers.map((tier) => ({
    tier,
    status: 403,
    before: [],
    after: [],
    live: false,
  })), 'each granted reader is known to the wall but lacks turn authority and cannot change the transcript')

  const hidden = store.createSession(`turn ownership foreign ${++sequence}`, OWNER)
  const absentGrant = await callRaw('POST', `/sessions/${hidden.id}/messages`, { text: 'probe' }, { 'x-tenant-id': FOREIGN })
  assert.equal(absentGrant.status, 404, 'a tenant with no grant remains behind the existence-hiding wall')
  assert.deepEqual(store.getSession(hidden.id)?.messages, [], 'the foreign probe leaves the transcript untouched')
})

test('granted readers cannot cancel a live owner turn, while an ungranted tenant stays hidden', async () => {
  const results: Array<{ tier: string; status: number; cancelled: boolean; active: boolean; transcript: unknown }> = []
  for (const tier of tiers) {
    const session = sharedSession(tier)
    let cancelled = false
    const active = turns.start(session.id, () => { cancelled = true })
    assert.ok(active, `fixture ${tier} live turn registered`)
    const detail = await call('GET', `/sessions/${session.id}`, undefined, { 'x-tenant-id': AUDIENCE })
    assert.equal(detail.status, 200, `${tier} audience can read the shared conversation`)
    assert.equal(detail.json.own, false, `${tier} audience is explicitly not its owner`)
    const result = await call('POST', `/sessions/${session.id}/turns/${active.id}/cancel`, undefined, { 'x-tenant-id': AUDIENCE })
    results.push({
      tier,
      status: result.status,
      cancelled,
      active: turns.bySession(session.id)?.id === active.id,
      transcript: store.getSession(session.id)?.messages,
    })
    turns.finish(active.id)
  }
  assert.deepEqual(results, tiers.map((tier) => ({
    tier,
    status: 403,
    cancelled: false,
    active: true,
    transcript: [],
  })), 'a grant cannot stop generation or change its live record')

  const hidden = store.createSession(`turn ownership hidden cancel ${++sequence}`, OWNER)
  const hiddenTurn = turns.start(hidden.id, () => {})
  assert.ok(hiddenTurn)
  const foreign = await call('POST', `/sessions/${hidden.id}/turns/${hiddenTurn.id}/cancel`, undefined, { 'x-tenant-id': FOREIGN })
  assert.equal(foreign.status, 404, 'an ungranted tenant cannot distinguish a live turn')
  turns.finish(hiddenTurn.id)
})

test('the conversation owner can still stop their live turn', async () => {
  const session = store.createSession(`turn ownership owner ${++sequence}`, OWNER)
  let cancelled = false
  const active = turns.start(session.id, () => { cancelled = true })
  assert.ok(active)
  const result = await call('POST', `/sessions/${session.id}/turns/${active.id}/cancel`, undefined, { 'x-tenant-id': OWNER })
  try {
    assert.equal(result.status, 200)
    assert.equal(cancelled, true)
    assert.deepEqual(store.getSession(session.id)?.messages, [], 'cancel routing does not itself rewrite the transcript')
  } finally {
    turns.finish(active.id)
  }
})
