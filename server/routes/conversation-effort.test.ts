/** Interactive conversation effort is resolved from the authenticated viewer's
 *  saved preference and the Session -> Agent -> provider/model actually used for
 *  this turn. These local peers inspect the real provider wire; no paid calls. */
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { accounts } from '../accounts.ts'
import { SESSION_COOKIE, signSession } from '../auth.ts'
import { call, callRaw } from '../testkit/http.ts'
import { store } from '../store/index.ts'

type Seen = { path: string; body: any }
const seen: Seen[] = []
let peer: Server
let baseURL = ''
let messagesToolTurn = 0
let beforeMessagesToolReply: (() => void) | undefined

async function read(req: IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined
}

function anthropic(response: ServerResponse, model: string, tool = false) {
  const content = tool
    ? [
        { type: 'thinking', thinking: 'LOCAL_OPAQUE_THINKING', signature: 'local-thinking-signature' },
        { type: 'redacted_thinking', data: 'local-redacted-thinking' },
        { type: 'tool_use', id: 'effort-tool-call', name: 'api__get_usage', input: { query: {} } },
      ]
    : [{ type: 'text', text: 'Local effort fixture reply.' }]
  const events: Array<Record<string, unknown>> = [
    { type: 'message_start', message: { id: `effort-${seen.length}`, type: 'message', role: 'assistant', content: [], model, stop_reason: null, stop_sequence: null, usage: { input_tokens: 3, output_tokens: 0 } } },
  ]
  for (const [index, block] of content.entries()) {
    if (block.type === 'thinking' || block.type === 'redacted_thinking') {
      events.push({ type: 'content_block_start', index, content_block: block }, { type: 'content_block_stop', index })
      continue
    }
    events.push({ type: 'content_block_start', index, content_block: block.type === 'text' ? { type: 'text', text: '' } : { type: 'tool_use', id: block.id, name: block.name, input: {} } })
    events.push(block.type === 'text'
      ? { type: 'content_block_delta', index, delta: { type: 'text_delta', text: block.text } }
      : { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } })
    events.push({ type: 'content_block_stop', index })
  }
  events.push({ type: 'message_delta', delta: { stop_reason: tool ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 2 } }, { type: 'message_stop' })
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  response.end(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''))
}

function responseSse(response: ServerResponse, model: string) {
  const result = {
    id: `resp-${seen.length}`, object: 'response', created_at: 1_760_000_000,
    status: 'completed', model, output: [{
      id: `msg-${seen.length}`, type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: 'Local effort fixture reply.', annotations: [] }],
    }], usage: { input_tokens: 3, output_tokens: 2 },
  }
  response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive' })
  const emit = (event: Record<string, unknown>) => response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
  emit({ type: 'response.created', response: { ...result, status: 'in_progress', output: [], usage: null } })
  emit({ type: 'response.output_item.added', output_index: 0, item: { ...result.output[0], status: 'in_progress' } })
  emit({ type: 'response.output_text.delta', item_id: result.output[0].id, output_index: 0, content_index: 0, delta: 'Local effort fixture reply.' })
  emit({ type: 'response.output_item.done', output_index: 0, item: result.output[0] })
  emit({ type: 'response.completed', response: result })
  response.end()
}

before(async () => {
  peer = createServer(async (req, res) => {
    const body = await read(req)
    seen.push({ path: req.url ?? '', body })
    const model = body?.model ?? 'missing-model'
    if ((req.url ?? '').endsWith('/messages')) {
      const shouldTool = model === 'chosen-messages-model' && messagesToolTurn++ === 0
      if (shouldTool) beforeMessagesToolReply?.()
      anthropic(res, model, shouldTool)
      return
    }
    if ((req.url ?? '').endsWith('/responses')) {
      responseSse(res, model)
      return
    }
    res.writeHead(404).end()
  })
  await new Promise<void>((resolve, reject) => {
    peer.once('error', reject)
    peer.listen(0, '127.0.0.1', resolve)
  })
  const address = peer.address()
  assert.ok(address && typeof address === 'object')
  baseURL = `http://127.0.0.1:${address.port}/v1`
})

after(() => {
  peer.closeAllConnections?.()
  peer.close()
})

function cookie(userId: string, tenantId: string) {
  return { cookie: `${SESSION_COOKIE}=${signSession({ userId, tenantId, iat: Date.now() })}` }
}

async function createPeerProvider(
  protocol: 'anthropic-messages' | 'openai-responses',
  label: string,
  models: any[],
  effortLevels = ['Low', 'Medium', 'High'],
  configuredModel = 'configured-model-that-session-overrides',
) {
  return store.createProvider({
    label, modelFamily: protocol === 'anthropic-messages' ? 'claude' : 'gpt', effortLevels, models,
  }, { protocol, baseURL, model: configuredModel, capabilities: { toolUse: true } })
}

async function setEffort(headers: Record<string, string>, tenantId: string, userId: string, effort: string, expectedRevision = 0) {
  const current = await call('GET', '/viewer-preferences/model', undefined, headers)
  if (expectedRevision === 0 && current.json.revision > 0) expectedRevision = current.json.revision
  return call('PATCH', '/viewer-preferences/model', {
    expectedTenantId: tenantId, expectedUserId: userId, expectedRevision,
    preferences: { effort, ultracode: false, fast: false },
  }, headers)
}

function wireEfforts(model: string) {
  return seen.filter(hit => hit.body?.model === model).map(hit => hit.body?.output_config?.effort ?? hit.body?.reasoning?.effort)
}

function frames(body: string) {
  return body.split('\n\n').filter(Boolean)
    .map(frame => frame.split('\n').find(line => line.startsWith('data:')))
    .filter((line): line is string => !!line)
    .map(line => JSON.parse(line.slice(5).trim()))
}

test('Messages turn freezes the scoped saved effort through tool continuation and idempotent replay', async () => {
  seen.length = 0
  messagesToolTurn = 0
  const org = accounts.createOrg('user-ada', `Conversation effort ${Date.now()}`)
  assert.ok(org)
  const invite = accounts.createInvite(org.id, 'grace@acme.example', 'Ada')
  assert.ok(invite)
  assert.equal(accounts.resolveInvite(invite.id, 'user-grace', 'accept')?.kind, 'accepted')
  const ada = cookie('user-ada', org.id)
  const grace = cookie('user-grace', org.id)

  const provider = await createPeerProvider('anthropic-messages', 'Messages effort test', [
    { id: 'chosen-messages-model', label: 'Chosen Messages model', effortLevels: ['Low', 'High'], capabilities: { thinking: true, adaptiveThinking: true } },
    { id: 'subset-messages-model', label: 'Subset Messages model', effortLevels: ['Medium'], capabilities: { thinking: true, adaptiveThinking: false } },
    { id: 'no-effort-messages-model', label: 'No effort Messages model', effortLevels: [], capabilities: { adaptiveThinking: true } },
    { id: 'inherits-messages-model', label: 'Inherits provider effort', capabilities: { thinking: true } },
  ])
  assert.equal((await setEffort(ada, org.id, 'user-ada', 'Low')).status, 200)
  assert.equal((await setEffort(grace, org.id, 'user-grace', 'High')).status, 200)

  const created = await call('POST', '/sessions', { firstMessage: 'start', providerId: provider.id, modelId: 'chosen-messages-model' }, ada)
  assert.equal(created.status, 200)
  beforeMessagesToolReply = () => {
    store.setModelPreferences(org.id, 'user-ada', org.id, 'user-ada', 1,
      { effort: 'High', ultracode: false, fast: false })
    store.replaceStaticProviderModels(provider.id, provider.models!.map(model => model.id === 'chosen-messages-model'
      ? { ...model, capabilities: { thinking: true, adaptiveThinking: false } } : model))
    beforeMessagesToolReply = undefined
  }
  const first = await callRaw('POST', `/sessions/${created.json.id}/messages`, { text: 'Use the ordinary tool, then answer.' }, { ...ada, 'idempotency-key': 'effort-frozen-turn' })
  assert.equal(first.status, 200)
  assert.deepEqual(wireEfforts('chosen-messages-model'), ['low', 'low'], 'the exact saved effort reaches the first request and its tool continuation')
  const modelRequests = seen.filter(hit => hit.body?.model === 'chosen-messages-model')
  assert.deepEqual(modelRequests.map(hit => hit.body.thinking), [{ type: 'adaptive' }, { type: 'adaptive' }],
    'the declared adaptive mode stays frozen even when the catalog changes during the turn')
  assert.deepEqual(modelRequests[1].body.messages.find(message => message.role === 'assistant').content.slice(0, 2), [
    { type: 'thinking', thinking: 'LOCAL_OPAQUE_THINKING', signature: 'local-thinking-signature' },
    { type: 'redacted_thinking', data: 'local-redacted-thinking' },
  ], 'tool continuation retains opaque signed and redacted thinking blocks unchanged')
  const end = frames(first.body).find(frame => frame.type === 'message.end')
  assert.ok(end)
  assert.equal(end.message.content, 'Local effort fixture reply.')
  assert.doesNotMatch(JSON.stringify(end.message), /LOCAL_OPAQUE_THINKING|local-thinking-signature|local-redacted-thinking/)

  // The authored peer changed the preference after receiving the tool request but
  // before the continuation. The turn must remain frozen at its admission value.
  const replayPref = await call('GET', '/viewer-preferences/model', undefined, ada)
  assert.equal(replayPref.json.preferences.effort, 'High')
  const replay = await callRaw('POST', `/sessions/${created.json.id}/messages`, { text: 'Use the ordinary tool, then answer.' }, { ...ada, 'idempotency-key': 'effort-frozen-turn' })
  assert.equal(replay.status, 200)
  assert.match(replay.body, /Local effort fixture reply\./, 'replay returns the recorded assistant result')
  assert.deepEqual(wireEfforts('chosen-messages-model'), ['low', 'low'], 'an idempotent replay does not re-read preferences or re-execute generation')

  // A second authenticated person in the same tenant uses their own High choice.
  assert.equal((await setEffort(ada, org.id, 'user-ada', 'Low', 2)).status, 200)
  const peerSession = await call('POST', '/sessions', { firstMessage: 'start', providerId: provider.id, modelId: 'chosen-messages-model' }, grace)
  assert.equal(peerSession.status, 200)
  const peerTurn = await callRaw('POST', `/sessions/${peerSession.json.id}/messages`, { text: 'Answer as Grace.' }, grace)
  assert.equal(peerTurn.status, 200)
  assert.deepEqual(wireEfforts('chosen-messages-model'), ['low', 'low', 'high'], 'same-tenant viewer preference is isolated by authenticated user')
  assert.equal(seen.filter(hit => hit.body?.model === 'chosen-messages-model').at(-1)?.body.thinking, undefined,
    'the next turn uses the updated catalog, not a stale adaptive choice')

  // Resolve against the session's concrete model vocabulary, not the provider's
  // broader list. Empty model vocabulary suppresses the field; absent inherits.
  for (const [modelId, expected] of [
    ['subset-messages-model', 'medium'],
    ['no-effort-messages-model', undefined],
    ['inherits-messages-model', 'low'],
  ] as const) {
    const session = await call('POST', '/sessions', { firstMessage: 'start', providerId: provider.id, modelId }, ada)
    assert.equal(session.status, 200)
    const beforeCount = seen.length
    const result = await callRaw('POST', `/sessions/${session.json.id}/messages`, { text: `Check ${modelId}.` }, ada)
    assert.equal(result.status, 200)
    const hit = seen.slice(beforeCount).find(request => request.body?.model === modelId)
    assert.ok(hit, `effective model ${modelId} was called`)
    assert.equal(hit.body?.output_config?.effort, expected, `${modelId} follows its own vocabulary (absence inherits; empty explicitly suppresses)`)
    assert.deepEqual(hit.body.thinking, modelId === 'no-effort-messages-model' ? { type: 'adaptive' } : undefined,
      'only explicit adaptive support enables thinking; effort and general thinking alone are not proof')
  }
})

test('Responses conversation receives the authenticated saved effort on its native wire', async () => {
  seen.length = 0
  const provider = await createPeerProvider('openai-responses', 'Responses effort test', [
    { id: 'chosen-responses-model', label: 'Chosen Responses model', effortLevels: ['Low', 'High'], capabilities: { thinking: true, adaptiveThinking: true } },
  ])
  const headers = cookie('user-maya', 'tenant-growthworks')
  assert.equal((await setEffort(headers, 'tenant-growthworks', 'user-maya', 'Low')).status, 200)
  const session = await call('POST', '/sessions', { firstMessage: 'start', providerId: provider.id, modelId: 'chosen-responses-model' }, headers)
  assert.equal(session.status, 200)
  const turn = await callRaw('POST', `/sessions/${session.json.id}/messages`, { text: 'Respond.' }, headers)
  assert.equal(turn.status, 200)
  const request = seen.find(hit => hit.body?.model === 'chosen-responses-model')
  assert.ok(request)
  assert.equal(request.path, '/v1/responses')
  assert.equal(request.body?.reasoning?.effort, 'low', 'Responses uses its native reasoning.effort field')
  assert.equal(Object.hasOwn(request.body, 'thinking'), false, 'Messages adaptive metadata never changes the Responses wire')
})

test('Session relay prompts never receive endpoint effort preferences', async () => {
  const headers = cookie('user-maya', 'tenant-growthworks')
  assert.equal((await setEffort(headers, 'tenant-growthworks', 'user-maya', 'High')).status, 200)
  const relay = await call('POST', '/providers', {
    label: 'Effort omission relay', modelFamily: 'claude', effortLevels: ['Default'], kind: 'session',
  }, headers)
  assert.equal(relay.status, 200)
  const session = await call('POST', '/sessions', { firstMessage: 'start', providerId: relay.json.id }, headers)
  assert.equal(session.status, 200)
  const parked = call('GET', '/relay/poll', undefined, { authorization: `Bearer ${relay.json.secret}` })
  await new Promise(resolve => setTimeout(resolve, 10))
  const send = callRaw('POST', `/sessions/${session.json.id}/messages`, { text: 'Relay answer.' }, headers)
  const pulled = await parked
  assert.equal(pulled.status, 200)
  assert.equal(pulled.json.prompt.messages.at(-1).text, 'Relay answer.')
  assert.equal(Object.hasOwn(pulled.json.prompt, 'effort'), false, 'a Session provider receives only its relay prompt, not provider endpoint effort')
  assert.equal((await call('POST', '/relay/reply', { entryId: pulled.json.entryId, completion: 'Received.' }, { authorization: `Bearer ${relay.json.secret}` })).status, 200)
  assert.equal((await send).status, 200)
})

test('a Session without its own model pick inherits the bound Agent provider model before resolving effort', async () => {
  seen.length = 0
  const headers = cookie('user-maya', 'tenant-growthworks')
  assert.equal((await setEffort(headers, 'tenant-growthworks', 'user-maya', 'Low')).status, 200)
  const provider = await createPeerProvider('anthropic-messages', 'Agent-inherited effort test', [
    { id: 'agent-inherited-model', label: 'Agent inherited model', effortLevels: ['Medium'], capabilities: { adaptiveThinking: true } },
  ], ['Low', 'Medium', 'High'], 'agent-inherited-model')
  const agent = await call('POST', '/agents', {
    label: 'Agent-inherited model effort', providerId: provider.id, systemPromptId: 'sp-concise-reviewer',
  }, headers)
  assert.equal(agent.status, 200)
  assert.equal(agent.json.providerId, provider.id)
  const session = await call('POST', '/sessions', { firstMessage: 'start', agentId: agent.json.id }, headers)
  assert.equal(session.status, 200)
  assert.equal(session.json.providerId, undefined, 'the Session has no overriding provider pick')
  assert.equal(session.json.modelId, undefined, 'the Session has no overriding model pick')

  const turn = await callRaw('POST', `/sessions/${session.json.id}/messages`, { text: 'Use the Agent model.' }, headers)
  assert.equal(turn.status, 200)
  const request = seen.find(hit => hit.body?.model === 'agent-inherited-model')
  assert.ok(request, 'the bound Agent provider supplies the effective provider and configured model')
  assert.equal(request.body?.output_config?.effort, 'medium', 'the Agent provider’s configured model vocabulary overrides its broader provider ladder')
  assert.deepEqual(request.body.thinking, { type: 'adaptive' }, 'adaptive support resolves from the Agent-inherited configured model too')
})

test('Dispatch uses selected model adaptive support without inheriting personal effort', async () => {
  seen.length = 0
  const headers = cookie('user-maya', 'tenant-growthworks')
  const provider = await createPeerProvider('anthropic-messages', 'Adaptive Dispatch fixture', [
    { id: 'dispatch-adaptive', label: 'Adaptive', capabilities: { adaptiveThinking: true } },
  ])
  const agent = await call('POST', '/agents', {
    label: 'Adaptive Dispatch Agent', providerId: provider.id, systemPromptId: 'sp-concise-reviewer',
  }, headers)
  assert.equal(agent.status, 200)
  const started = await call('POST', '/dispatch', {
    title: 'Answer a local test question.', detail: 'No external actions.',
    execution: { agentId: agent.json.id, providerId: provider.id, modelId: 'dispatch-adaptive' },
  }, { ...headers, 'idempotency-key': 'adaptive-dispatch-fixture' })
  assert.equal(started.status, 200)
  const deadline = Date.now() + 3_000
  let run = store.getRealDispatch(started.json.id, 'tenant-growthworks')
  while (run && run !== 'retired' && run.execution?.state === 'running' && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 2))
    run = store.getRealDispatch(started.json.id, 'tenant-growthworks')
  }
  assert.ok(run && run !== 'retired')
  assert.equal(run.execution?.state, 'replied')
  const requests = seen.filter(hit => hit.body?.model === 'dispatch-adaptive')
  assert.equal(requests.length, 1)
  assert.deepEqual(requests[0].body.thinking, { type: 'adaptive' })
  assert.equal(requests[0].body.output_config, undefined, 'Dispatch never adopts a person’s composer effort')
})
