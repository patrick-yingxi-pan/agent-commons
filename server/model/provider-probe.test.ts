/** Connection checks use real local HTTP peers, never provider credentials or
 * paid services. HTTP success alone must not publish a working connection. */
import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { createServer } from 'node:http'
import { probeProviderEndpoint } from '../generate.ts'
import { ProviderProbeError, type ProviderConfig } from '../data/providers.ts'
import { call } from '../testkit/http.ts'
import { store } from '../store/index.ts'

type Protocol = 'anthropic-messages' | 'openai-responses'
const protocols: Protocol[] = ['anthropic-messages', 'openai-responses']
const privateMarker = 'SYNTHETIC_PRIVATE_PROBE_BODY'

function reply(protocol: Protocol, stop = 'completed') {
  const usage = { input_tokens: 5, output_tokens: 1 }
  return protocol === 'openai-responses'
    ? { id: 'resp-probe', status: stop, output: [{ type: 'message', role: 'assistant',
      content: [{ type: 'output_text', text: 'ok' }] }], usage }
    : { id: 'msg-probe', type: 'message', role: 'assistant', model: 'probe-model',
      stop_reason: stop === 'completed' ? 'end_turn' : stop,
      content: [{ type: 'text', text: 'ok' }], usage }
}

async function fixture(t: TestContext, protocol: Protocol) {
  const requests: any[] = []
  const state = { body: reply(protocol) as any, rejectTools: false }
  const server = createServer(async (req, res) => {
    let text = ''
    for await (const chunk of req) text += chunk
    if (req.method === 'GET') {
      res.writeHead(404).end()
      return
    }
    const body = JSON.parse(text)
    requests.push(body)
    const reject = state.rejectTools && body.tools?.length
    res.writeHead(reject ? 400 : 200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(reject ? { error: { message: privateMarker } } : state.body))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  })
  const address = server.address()!
  assert.notEqual(typeof address, 'string')
  const config: ProviderConfig = { protocol, baseURL: `http://127.0.0.1:${address.port}/v1`, model: 'probe-model' }
  return { state, requests, config }
}

function invalidProbe(error: unknown) {
  assert.ok(error instanceof ProviderProbeError)
  assert.match(error.message, /invalid|unsuccessful/i)
  assert.doesNotMatch(error.message, /could not be reached/i, 'a received invalid response is not a network outage')
  assert.doesNotMatch(error.message, new RegExp(privateMarker))
  assert.equal(error.cause, undefined, 'no upstream body is attached as a cause')
  return true
}

for (const protocol of protocols) {
  test(`${protocol}: invalid HTTP-success responses fail once without capability fallback`, async t => {
    const { state, requests, config } = await fixture(t, protocol)
    const valid = reply(protocol)
    const invalid = [
      { ...valid, id: '' },
      { ...valid, usage: null },
      { ...valid, usage: { input_tokens: 5 } },
      { ...valid, usage: { input_tokens: -1, output_tokens: 1 } },
      { ...valid, usage: { input_tokens: 1.5, output_tokens: 1 } },
      { ...valid, usage: { input_tokens: Number.MAX_SAFE_INTEGER, output_tokens: 1 } },
      ...(protocol === 'openai-responses' ? [
        { ...valid, status: 'failed', error: { message: privateMarker } },
        { ...valid, status: 'in_progress' },
        { ...valid, status: 'cancelled' },
        { ...valid, status: 'incomplete', incomplete_details: { reason: 'content_filter' } },
        { ...valid, status: 'incomplete' },
        { ...valid, output: [{ type: privateMarker }] },
        { ...valid, output: [] },
        { ...valid, output: [{ type: 'message', role: 'user', content: [{ type: 'output_text', text: 'ok' }] }] },
        { ...valid, output: [{ type: 'function_call', call_id: 'probe-call', name: privateMarker, arguments: '{}' }] },
      ] : [
        { ...valid, stop_reason: null, error: privateMarker },
        { ...valid, stop_reason: 'unknown' },
        { ...valid, content: null },
        { ...valid, content: [{ type: 'text', text: 5 }] },
        { ...valid, content: [] },
        { ...valid, role: 'user' },
        { ...valid, stop_reason: 'tool_use', content: [] },
        { ...valid, stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'probe-call', name: privateMarker, input: {} }] },
      ]),
    ]
    for (const body of invalid) {
      state.body = body
      const before = requests.length
      await assert.rejects(probeProviderEndpoint(config), invalidProbe)
      assert.equal(requests.length, before + 1, 'invalid output never triggers a no-tools retry')
    }
  })

  test(`${protocol}: valid completion and deliberate tiny-token exhaustion remain conformant`, async t => {
    const { state, requests, config } = await fixture(t, protocol)
    assert.deepEqual(await probeProviderEndpoint(config), { toolUse: true })
    state.body = protocol === 'openai-responses'
      ? { ...reply(protocol, 'incomplete'), output: [], incomplete_details: { reason: 'max_output_tokens' } }
      : { ...reply(protocol, 'max_tokens'), content: [] }
    assert.deepEqual(await probeProviderEndpoint(config), { toolUse: true }, 'the small probe need not finish prose')
    state.rejectTools = true
    state.body = reply(protocol)
    assert.deepEqual(await probeProviderEndpoint(config), { toolUse: false })
    assert.equal(requests.length, 4)
    assert.ok(requests[2].tools.length)
    assert.equal(requests[3].tools, undefined)
  })

  test(`${protocol}: the no-tools fallback must also contain a valid response`, async t => {
    const { state, requests, config } = await fixture(t, protocol)
    state.rejectTools = true
    state.body = { ...reply(protocol), usage: null, error: privateMarker }
    await assert.rejects(probeProviderEndpoint(config), invalidProbe)
    assert.equal(requests.length, 2)
  })

  test(`${protocol}: declared probe tool and opaque reasoning are accepted but never executed`, async t => {
    const { state, requests, config } = await fixture(t, protocol)
    state.body = protocol === 'openai-responses'
      ? { ...reply(protocol), output: [
        { type: 'reasoning', summary: [], encrypted_content: privateMarker },
        { type: 'function_call', call_id: 'probe-call', name: 'probe_noop', arguments: '{}' },
      ] }
      : { ...reply(protocol, 'tool_use'), content: [
        { type: 'thinking', thinking: privateMarker, signature: 'opaque-signature' },
        { type: 'redacted_thinking', data: 'opaque-data' },
        { type: 'tool_use', id: 'probe-call', name: 'probe_noop', input: {} },
      ] }
    assert.deepEqual(await probeProviderEndpoint(config), { toolUse: true })
    assert.equal(requests.length, 1, 'no tool output or continuation is sent')
    state.rejectTools = true
    await assert.rejects(probeProviderEndpoint(config), invalidProbe)
    assert.equal(requests.length, 3, 'a no-tools reply cannot request a tool')
  })

  test(`${protocol}: failed probes neither create a provider nor replace its working connection`, async t => {
    const { state, requests, config } = await fixture(t, protocol)
    const definition = { label: `Probe ${protocol}`, modelFamily: 'fixture', effortLevels: ['Standard'], config }
    const before = store.listProviders().length
    state.body = { ...reply(protocol), usage: null }
    const refused = await call('POST', '/providers', definition)
    assert.equal(refused.status, 400)
    assert.equal(store.listProviders().length, before)
    state.body = reply(protocol)
    const created = await call('POST', '/providers', definition)
    assert.equal(created.status, 200)
    const original = structuredClone(store.providerConfig(created.json.id))
    state.body = { ...reply(protocol), usage: null }
    const beforeReplacement = requests.length
    const replaced = await call('PATCH', `/providers/${created.json.id}/connection`, {
      model: 'replacement-model', expectedRevision: created.json.connectionRevision,
    })
    assert.equal(replaced.status, 400)
    assert.equal(requests.length, beforeReplacement + 1, 'the refusal came from the real probe')
    assert.deepEqual(store.providerConfig(created.json.id), original)
    const listed = await call('GET', '/providers')
    assert.equal(listed.json.find((p: any) => p.id === created.json.id).connectionRevision, created.json.connectionRevision)
  })
}
