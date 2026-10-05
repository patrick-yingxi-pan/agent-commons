/** Session turns are host control over an owned conversation. Social grants
 *  widen the read wall, but comment/propose tiers govern Discussions and
 *  SocialProposals; they do not authorize sending prompts or stopping a turn. */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import type { ReplyStreamEvent } from '../../contract/index.ts'
import { startModelServer } from '../model/index.ts'
import { store } from '../store/index.ts'
import { turns } from '../turns.ts'
import { call, callRaw } from '../testkit/http.ts'
import { buildRouter } from './index.ts'

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

async function openSyntheticReattach(
  sessionId: string,
  turnId: string,
  tenantId: string,
  after: number,
  onWrite?: (chunk: string) => void,
) {
  const chunks: string[] = []
  const headers: Record<string, string> = {}
  let status = 0
  let ended = false
  let closeHandler: (() => void) | undefined
  let responseCloseHandler: (() => void) | undefined
  const req: any = {
    method: 'GET',
    headers: { 'x-tenant-id': tenantId },
    on(event: string, listener: () => void) {
      if (event === 'close') closeHandler = listener
      return req
    },
  }
  const res: any = {
    writeHead(code: number, values?: Record<string, string>) {
      status = code
      for (const [key, value] of Object.entries(values ?? {})) headers[key.toLowerCase()] = String(value)
      return res
    },
    setHeader(key: string, value: string) { headers[key.toLowerCase()] = value },
    write(chunk: string) {
      chunks.push(String(chunk))
      onWrite?.(String(chunk))
      return true
    },
    end(chunk?: string) {
      if (chunk) chunks.push(chunk)
      ended = true
    },
    flushHeaders() {},
    on(event: string, listener: () => void) {
      if (event === 'close') responseCloseHandler = listener
      return res
    },
    get writableEnded() { return ended },
  }
  await buildRouter().handle(
    req,
    res,
    new URL(`http://test/sessions/${sessionId}/turns/${turnId}/stream?after=${after}`),
  )
  return {
    status: () => status,
    headers,
    body: () => chunks.join(''),
    frames: () => chunks.join('').split('\n\n').filter(Boolean)
      .map((frame) => frame.split('\n').find((line) => line.startsWith('data:')))
      .filter((line): line is string => !!line)
      .map((line) => JSON.parse(line.slice(5).trim()) as Record<string, unknown>),
    ended: () => ended,
    clientDisconnect: () => { closeHandler?.(); responseCloseHandler?.() },
  }
}

function appendSyntheticTurnFrames(sessionId: string, turnId: string) {
  const assistantId = `assistant-${turnId}`
  const shell: ReplyStreamEvent = {
    type: 'message.start',
    sessionId,
    turnId,
    message: { id: assistantId, role: 'assistant', content: '' },
  }
  const firstDelta: ReplyStreamEvent = {
    type: 'message.delta', sessionId, messageId: assistantId, text: 'before revoke',
  }
  const secondDelta: ReplyStreamEvent = {
    type: 'message.delta', sessionId, messageId: assistantId, text: ' after revoke',
  }
  assert.ok(turns.append(turnId, shell))
  assert.ok(turns.append(turnId, firstDelta))
  return { assistantId, secondDelta }
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

test('revoking a reader during buffered replay ends the channel before any later frame', async () => {
  const session = store.createSession(`turn stream revoke during replay ${++sequence}`, OWNER)
  const grant = store.createGrant({
    subject: { kind: 'session', id: session.id },
    audience: { kind: 'org', orgId: AUDIENCE },
    tier: 'view',
  }, OWNER)
  assert.ok(grant && typeof grant === 'object')
  let cancellations = 0
  const active = turns.start(session.id, () => { cancellations++ })
  assert.ok(active)
  const { secondDelta } = appendSyntheticTurnFrames(session.id, active.id)
  let revoked = false
  let regrantId: string | undefined
  let stream: Awaited<ReturnType<typeof openSyntheticReattach>> | undefined
  let freshStream: Awaited<ReturnType<typeof openSyntheticReattach>> | undefined

  try {
    stream = await openSyntheticReattach(session.id, active.id, AUDIENCE, 0, () => {
      if (revoked) return
      revoked = true
      assert.equal(store.revokeGrant(grant.id, OWNER), 'ok', 'the owner revokes from the first response.write hook')
    })
    assert.equal(stream.status(), 200, 'the reader was authorized when the stream opened')
    assert.equal(revoked, true, 'replay began before the grant was revoked')
    assert.deepEqual(stream.frames().map((frame) => frame.type), ['message.start'], 'only the frame written before revocation escaped')
    assert.equal(stream.ended(), true, 'revocation closes the already-open response')
    assert.equal(cancellations, 0, 'revoking a reader does not cancel the owner generation')
    assert.equal(turns.get(active.id)?.id, active.id, 'the owner generation stays registered')

    const beforeNextFrame = stream.body()
    const replacement = store.createGrant({
      subject: { kind: 'session', id: session.id },
      audience: { kind: 'org', orgId: AUDIENCE },
      tier: 'view',
    }, OWNER)
    assert.ok(replacement && typeof replacement === 'object', 'a fresh grant can authorize a new request')
    regrantId = replacement.id
    assert.ok(turns.append(active.id, secondDelta))
    assert.equal(stream.body(), beforeNextFrame, 'regrant cannot revive the old, closed stream')

    freshStream = await openSyntheticReattach(session.id, active.id, AUDIENCE, 0)
    assert.equal(freshStream.status(), 200, 'a new stream request may use the new grant')
    assert.deepEqual(freshStream.frames().map((frame) => frame.type), ['message.start', 'message.delta', 'message.delta'])
  } finally {
    stream?.clientDisconnect()
    freshStream?.clientDisconnect()
    turns.finish(active.id)
    store.revokeGrant(grant.id, OWNER)
    if (regrantId) store.revokeGrant(regrantId, OWNER)
  }
})

test('revoking after live attach closes the reader before a new live frame, and regrant needs a new stream', async () => {
  const session = store.createSession(`turn stream revoke live tail ${++sequence}`, OWNER)
  const grant = store.createGrant({
    subject: { kind: 'session', id: session.id },
    audience: { kind: 'org', orgId: AUDIENCE },
    tier: 'view',
  }, OWNER)
  assert.ok(grant && typeof grant === 'object')
  let cancellations = 0
  const active = turns.start(session.id, () => { cancellations++ })
  assert.ok(active)
  const { secondDelta } = appendSyntheticTurnFrames(session.id, active.id)
  let regrantId: string | undefined
  let stream: Awaited<ReturnType<typeof openSyntheticReattach>> | undefined
  let freshStream: Awaited<ReturnType<typeof openSyntheticReattach>> | undefined

  try {
    const liveEdge = turns.bySession(session.id)?.seq ?? 0
    stream = await openSyntheticReattach(session.id, active.id, AUDIENCE, liveEdge)
    assert.equal(stream.status(), 200)
    assert.deepEqual(stream.frames(), [], 'attaching at the current edge has no replay')
    assert.equal(stream.ended(), false, 'the live channel stays open before revocation')

    assert.equal(store.revokeGrant(grant.id, OWNER), 'ok')
    assert.ok(turns.append(active.id, secondDelta))
    assert.deepEqual(stream.frames(), [], 'no live frame is delivered after the grant is revoked')
    assert.equal(stream.ended(), true, 'the revoked live channel is closed')
    assert.equal(cancellations, 0, 'reader teardown leaves server generation running')
    assert.equal(turns.get(active.id)?.id, active.id)

    const replacement = store.createGrant({
      subject: { kind: 'session', id: session.id },
      audience: { kind: 'org', orgId: AUDIENCE },
      tier: 'view',
    }, OWNER)
    assert.ok(replacement)
    regrantId = replacement.id
    const beforeLaterFrame = stream.body()
    const finalDelta: ReplyStreamEvent = {
      type: 'message.delta', sessionId: session.id, messageId: `assistant-${active.id}`, text: ' after regrant',
    }
    assert.ok(turns.append(active.id, finalDelta))
    assert.equal(stream.body(), beforeLaterFrame, 'a later grant cannot reopen the old live subscription')

    freshStream = await openSyntheticReattach(session.id, active.id, AUDIENCE, 0)
    assert.equal(freshStream.status(), 200, 'a post-regrant request is independently authorized')
    assert.equal(freshStream.frames().length, 4, 'the fresh request can replay the active turn from its start')
  } finally {
    stream?.clientDisconnect()
    freshStream?.clientDisconnect()
    turns.finish(active.id)
    store.revokeGrant(grant.id, OWNER)
    if (regrantId) store.revokeGrant(regrantId, OWNER)
  }
})

test('a buffered turn for an unpersisted session id cannot be attached', async () => {
  const sessionId = `unpersisted-turn-session-${++sequence}`
  let cancelled = false
  const active = turns.start(sessionId, () => { cancelled = true })
  assert.ok(active)
  appendSyntheticTurnFrames(sessionId, active.id)
  try {
    const stream = await openSyntheticReattach(sessionId, active.id, OWNER, 0)
    try {
      assert.equal(stream.status(), 404, 'a registry handle alone does not authorize a session stream')
      assert.equal(stream.ended(), true)
      assert.deepEqual(stream.frames(), [])
      assert.equal(cancelled, false, 'a denied attach cannot cancel generation')
    } finally {
      stream.clientDisconnect()
    }
  } finally {
    turns.finish(active.id)
  }
})
