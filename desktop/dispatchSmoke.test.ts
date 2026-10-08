import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { ignoreFromPackage } from './packager.config.mjs'
import { DISPATCH_SMOKE_MODEL, startDispatchSmokeFixture } from './dispatchSmokeFixture.mjs'

const userRequest = (text: string) => ({
  model: DISPATCH_SMOKE_MODEL,
  messages: [{ role: 'user', content: text }],
  tools: [],
})

async function post(origin: string, body: unknown) {
  return fetch(`${origin}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer must-not-be-captured' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

async function waitFor(fixture: Awaited<ReturnType<typeof startDispatchSmokeFixture>>, predicate: () => boolean) {
  for (let attempt = 0; !predicate() && attempt < 100; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5))
  assert.equal(predicate(), true)
}

test('packaged Dispatch smoke and its local model fixture are excluded from the shipped app', () => {
  assert.equal(ignoreFromPackage('/desktop/dispatchSmoke.mjs'), true)
  assert.equal(ignoreFromPackage('/desktop/dispatchSmokeFixture.mjs'), true)
})

test('ordinary packaged smoke awaits the Dispatch workflow with its production launcher', () => {
  const source = readFileSync(new URL('./smoke.mjs', import.meta.url), 'utf8')
  assert.ok(source.includes("import { smokePackagedDispatch } from './dispatchSmoke.mjs'"))
  assert.ok(source.includes('await smokePackagedDispatch({ executable, launch: launchPackagedDesktop, close: closePackagedDesktop })'))
})

test('packaged Dispatch acceptance drives the rendered binding, observes durable interruption, then replays without model work', () => {
  for (const path of ['./dispatchSmoke.mjs', './dispatchSmokeFixture.mjs']) {
    const syntax = spawnSync(process.execPath, ['--check', fileURLToPath(new URL(path, import.meta.url))], { encoding: 'utf8' })
    assert.equal(syntax.status, 0, syntax.stderr || syntax.stdout || `${path} must be valid JavaScript`)
  }
  const source = readFileSync(new URL('./dispatchSmoke.mjs', import.meta.url), 'utf8')
  for (const selector of [
    "getByRole('button', { name: 'New dispatch', exact: true })",
    'getByRole("combobox", { name: "Agent", exact: true }).selectOption(binding.agentId)',
    'getByRole("combobox", { name: "Model connection", exact: true }).selectOption(binding.providerId)',
    'getByRole("combobox", { name: "Model", exact: true }).selectOption(binding.modelId)',
    "getByRole('button', { name: 'Dispatch', exact: true })",
  ]) assert.ok(source.includes(selector), `the native smoke must drive ${selector}`)
  let previous = -1
  for (const stage of ['rendered-first-dispatch', 'ordinary-continuation', 'durable-pending-before-quit', 'relaunch-and-exact-replay']) {
    const at = source.indexOf(`stage = '${stage}'`)
    assert.ok(at > previous, `the packaged smoke preserves ${stage} ordering`)
    previous = at
  }
  assert.match(source, /new DatabaseSync\(join\(profile, 'store\.db'\), \{ readOnly: true \}\)/)
  assert.match(source, /assert\.equal\(dispatchBeforeQuit\?\.status, 'running'/)
  assert.match(source, /assert\.equal\(recovered\?\.execution\?\.state, 'interrupted'/)
  assert.match(source, /assert\.equal\(fixture\.requests\.length, 3, 'startup recovery and exact Retry never redispatch the model call'/)
  assert.doesNotMatch(source, /_electron|use-mock-keychain|store\.\w+\(/,
    'the smoke uses the ordinary executable and public HTTP surface, not injected app or product-store authority')
})

test('the local endpoint captures detached model requests, ignores registration probes, and releases held replies', async () => {
  const fixture = await startDispatchSmokeFixture()
  try {
    const catalog = await fetch(`${fixture.origin}/v1/models`)
    assert.equal(catalog.status, 200)
    assert.equal((await catalog.json()).data[0].id, DISPATCH_SMOKE_MODEL)

    const probe = await post(fixture.origin, {
      ...userRequest('Conformance check. Reply with one word.'),
      tools: [{ name: 'probe_noop', input_schema: { type: 'object', properties: {} } }],
    })
    assert.equal(probe.status, 200)
    assert.equal(fixture.requests.length, 0, 'provider registration is not counted as an Agent run')

    const submitted = userRequest('Exact packaged task · café · 東京')
    const reply = await post(fixture.origin, submitted)
    const result = await reply.json()
    assert.equal(reply.status, 200)
    assert.equal(result.stop_reason, 'end_turn')
    assert.equal(result.usage.input_tokens, 17)
    assert.match(result.content[0].text, /Exact packaged task · café · 東京/)
    submitted.messages[0].content = 'mutated after response'
    assert.equal(fixture.requests.length, 1)
    assert.deepEqual(fixture.requests[0], userRequest('Exact packaged task · café · 東京'))
    assert.doesNotMatch(JSON.stringify(fixture.requests), /must-not-be-captured|authorization/i)

    const streamed = await post(fixture.origin, { ...userRequest('Streamed Dispatch response.'), stream: true })
    assert.equal(streamed.status, 200)
    assert.match(streamed.headers.get('content-type') ?? '', /text\/event-stream/)
    const events = await streamed.text()
    for (const event of ['message_start', 'content_block_delta', 'message_delta', 'message_stop']) {
      assert.ok(events.includes(`event: ${event}`), `streaming fixture emits ${event}`)
    }
    assert.match(events, /Local Dispatch fixture reply: Streamed Dispatch response\./)
    assert.deepEqual(fixture.requests[1], { ...userRequest('Streamed Dispatch response.'), stream: true })

    fixture.setMode('hold')
    const held = post(fixture.origin, userRequest('Held until process exit.'))
    await waitFor(fixture, () => fixture.requests.length === 3 && fixture.heldCount === 1)
    assert.equal(fixture.releaseHeld(), 1)
    assert.match((await (await held).json()).content[0].text, /Held until process exit/)
    assert.equal(fixture.heldCount, 0)
    assert.equal(fixture.requests.length, 3)
  } finally {
    await fixture.close()
    await fixture.close()
  }
})

test('a disconnected packaged request is released and never becomes a retained fixture call', async () => {
  const fixture = await startDispatchSmokeFixture()
  try {
    fixture.setMode('hold')
    const controller = new AbortController()
    const pending = fetch(`${fixture.origin}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(userRequest('The packaged app exits during this request.')),
      signal: controller.signal,
    })
    await waitFor(fixture, () => fixture.requests.length === 1 && fixture.heldCount === 1)
    controller.abort()
    await assert.rejects(pending)
    await waitFor(fixture, () => fixture.heldCount === 0)
    assert.equal(fixture.releaseHeld(), 0)
    assert.equal(fixture.requests.length, 1)
  } finally {
    await fixture.close()
  }
})
