/** Native Responses acceptance against a bounded, test-owned loopback peer.
 * The executable, rendered setup/Dispatch, OS custody, SQLite and relaunch are
 * real. This does not contact OpenAI or establish paid-provider acceptance. */
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect } from '@playwright/test'
import { CREDENTIAL_VAULT_FILE } from './credentialVault.mjs'
import {
  OPENAI_SMOKE_MODEL, OPENAI_SMOKE_KEY, OPENAI_SMOKE_REPLACEMENT_KEY,
  OPENAI_SMOKE_REASONING, startOpenAIResponsesSmokeFixture,
} from './openaiResponsesSmokeFixture.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const TIMEOUT_MS = 30_000

async function api(page, path, body) {
  const result = await page.evaluate(async ({ path, body }) => {
    const response = await fetch(`/api/v1${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', ...(body === undefined ? {} : { 'idempotency-key': crypto.randomUUID() }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return { status: response.status, body: await response.json() }
  }, { path, body })
  assert.ok(result.status >= 200 && result.status < 300, `Packaged Responses ${path} returned HTTP ${result.status}.`)
  return result.body
}

/** Read actual committed product data; never inject into the running store. */
export function readOpenAIState(profile, providerId, sessionId, tenantId) {
  const database = new DatabaseSync(join(profile, 'store.db'), { readOnly: true })
  try {
    const entity = database.prepare('SELECT json FROM entities WHERE slice = ? AND entity_id = ?')
    const entry = database.prepare('SELECT json FROM map_entries WHERE slice = ? AND key = ?')
    const parse = row => row ? JSON.parse(row.json) : undefined
    return {
      provider: parse(entry.get('providers', providerId)),
      config: parse(entry.get('providerConfigs', providerId)),
      session: parse(entity.get('sessions', sessionId)),
      usage: parse(entry.get('usageMeters', tenantId)),
      productJson: database.prepare(`
        SELECT json FROM entities UNION ALL SELECT json FROM map_entries
        UNION ALL SELECT json FROM kv UNION ALL SELECT image_json AS json FROM image_assets
        UNION ALL SELECT original_json AS json FROM image_assets WHERE original_json IS NOT NULL
      `).all().map(row => row.json).join('\n'),
    }
  } finally { database.close() }
}

function assertNoSecrets(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  for (const secret of [OPENAI_SMOKE_KEY, OPENAI_SMOKE_REPLACEMENT_KEY, OPENAI_SMOKE_REASONING.encrypted_content]) {
    assert.ok(!text.includes(secret), 'credentials and opaque provider reasoning stay out of product data and renderer HTTP')
  }
}

export function assertPhaseHistory(message, request) {
  const expected = [
    { text: 'I will check usage. ', phase: 'commentary' },
    { text: 'The packaged OpenAI tool round completed.', phase: 'final_answer' },
  ]
  assert.deepEqual(message.assistantTextItems, expected, 'SQLite keeps each completed native message item')
  assert.equal(message.content, expected.map(item => item.text).join(''))
  if (!request) return
  const assistant = request.input.filter(item => item.role === 'assistant')
  assert.deepEqual(assistant.slice(0, 2), expected.map(({ text, phase }) => ({ role: 'assistant', content: text, phase })),
    'post-relaunch native history replays the original per-item phases')
  assert.equal(assistant.length, 3, 'tool receipts remain a distinct host item')
  assert.deepEqual(Object.keys(assistant[2]).sort(), ['content', 'role'])
  assert.match(assistant[2].content, /External\/tool receipt data/)
  assert.match(assistant[2].content, /"status":"done"/)
  assert.ok(request.input.filter(item => item.role === 'user').every(item => !Object.hasOwn(item, 'phase')))
}

export function assertProviderTransport(requests) {
  for (const [index, request] of requests.entries()) {
    const body = JSON.stringify(request)
    for (const key of [OPENAI_SMOKE_KEY, OPENAI_SMOKE_REPLACEMENT_KEY]) {
      assert.ok(!body.includes(key), 'provider credentials belong in headers, never request bodies')
    }
    if (index === 2) {
      assert.deepEqual(request.input.filter(item => item.type === 'reasoning'), [OPENAI_SMOKE_REASONING])
      const withoutContinuation = { ...request, input: request.input.filter(item => item.type !== 'reasoning') }
      assertNoSecrets(withoutContinuation)
    } else assertNoSecrets(request)
  }
}

export async function smokePackagedOpenAIResponses({ executable, launch, close }) {
  const profile = await mkdtemp(join(tmpdir(), 'agent-commons-openai-smoke-'))
  const evidenceRoot = join(ROOT, '.data', 'desktop-openai-smoke')
  let evidence, fixture, run, stage = 'startup'
  const productRequests = []
  const sessionCreationRequests = []
  const observe = page => page.on('request', request => {
    const pathname = new URL(request.url()).pathname
    if (pathname.startsWith('/api/v1/')) {
      productRequests.push(request.postData() ?? '')
    }
    if (request.method() === 'POST' && pathname === '/api/v1/sessions') sessionCreationRequests.push(request)
  })
  try {
    await mkdir(evidenceRoot, { recursive: true })
    evidence = await mkdtemp(join(evidenceRoot, 'run-'))
    fixture = await startOpenAIResponsesSmokeFixture()
    run = await launch(executable, profile)
    let { page, origin } = run
    observe(page)
    const identity = await api(page, '/auth/signup', {
      name: 'Packaged Responses Owner', email: 'packaged-responses@example.test', password: 'isolated-responses-smoke-password',
    })
    await page.reload()

    stage = 'rendered-secure-setup'
    await page.getByRole('button', { name: 'Connect a model', exact: true }).click()
    const setup = page.getByRole('dialog', { name: 'New provider' })
    await setup.getByRole('combobox', { name: /^Provider preset/ }).selectOption('openai')
    await expect(setup.getByRole('combobox', { name: /^Protocol/ })).toHaveValue('openai-responses')
    await setup.getByLabel('Name', { exact: true }).fill('Packaged OpenAI Responses')
    await setup.getByRole('textbox', { name: /^Endpoint URL/ }).fill(fixture.origin)
    await setup.getByLabel('Model ID', { exact: true }).fill(OPENAI_SMOKE_MODEL)
    await setup.getByPlaceholder('Paste API key', { exact: true }).fill(OPENAI_SMOKE_KEY)
    await setup.getByRole('button', { name: 'Create', exact: true }).click()
    await expect(setup).toHaveCount(0)
    await page.waitForURL(`${origin}/`)
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeEnabled()
    const providers = await api(page, '/providers')
    const provider = providers.find(row => row.label === 'Packaged OpenAI Responses')
    assert.ok(provider, 'rendered setup creates an actual provider')
    assert.equal(provider.protocol, 'openai-responses')
    assert.equal(provider.execution, 'configured')
    assert.equal(provider.defaultModelId, OPENAI_SMOKE_MODEL)
    assertNoSecrets(providers)
    assert.ok(providers.every(row => !row.config && !row.apiKeyEnv), 'public reads keep write-only configuration private')
    const preference = await api(page, '/viewer-preferences/model')
    assert.equal(preference.preferences.providerId, provider.id)
    assert.equal(fixture.requests.length, 1, 'setup makes one non-streaming probe')
    assert.equal(fixture.requests[0].stream, false)
    assertProviderTransport(fixture.requests)
    assert.ok(fixture.catalogCount > 0, 'the catalog is fetched through the native Responses connection')
    const vaultPath = join(profile, CREDENTIAL_VAULT_FILE)
    const originalVault = JSON.parse(await readFile(vaultPath, 'utf8'))
    assertNoSecrets(originalVault)
    assert.equal(Object.keys(originalVault.entries).length, 1, 'one encrypted key is bound before model work')

    stage = 'agent-dispatch-tool-round'
    const instructions = 'PACKAGED_RESPONSES_AGENT: inspect usage and answer briefly.'
    const prompt = await api(page, '/system-prompts', { label: 'Responses instructions', body: instructions, targetFamily: 'gpt' })
    const agent = await api(page, '/agents', { label: 'Responses Agent', providerId: provider.id, systemPromptId: prompt.id, tools: [], instructions })
    await page.goto(`${origin}/dispatch`)
    await page.getByRole('button', { name: 'New dispatch', exact: true }).click()
    const dispatch = page.getByRole('dialog', { name: 'New dispatch' })
    const title = 'Inspect usage through the Responses Agent'
    await dispatch.getByRole('textbox', { name: 'Task', exact: true }).fill(title)
    await dispatch.getByRole('combobox', { name: 'Agent', exact: true }).selectOption(agent.id)
    await dispatch.getByRole('combobox', { name: 'Model connection', exact: true }).selectOption(provider.id)
    await dispatch.getByRole('combobox', { name: 'Model', exact: true }).selectOption(OPENAI_SMOKE_MODEL)
    await dispatch.getByRole('button', { name: 'Dispatch', exact: true }).click()
    await expect(dispatch).toHaveCount(0)
    await expect.poll(async () => (await api(page, '/dispatch')).find(row => row.title === title)?.execution?.state,
      { timeout: TIMEOUT_MS }).toBe('replied')
    const job = (await api(page, '/dispatch')).find(row => row.title === title)
    assert.equal(job.execution.agentId, agent.id)
    assert.equal(job.execution.providerId, provider.id)
    const sessionId = job.execution.sessionId
    await page.goto(`${origin}/s/${sessionId}`)
    await expect(page.locator('[data-turn]').filter({ hasText: 'The packaged OpenAI tool round completed.' })).toBeVisible()
    await expect(page.getByText('GET /api/v1/usage → 200', { exact: true })).toBeVisible()
    assert.equal(fixture.requests.length, 3, 'one probe and exactly two streamed tool-loop requests')
    const [first, continuation] = fixture.requests.slice(1)
    assert.equal(first.stream, true)
    assert.equal(continuation.stream, true)
    assert.ok(first.instructions.includes(instructions), 'the selected Agent instructions reach Responses')
    assert.ok(first.tools.some(tool => tool.type === 'function' && tool.name === 'api__get_usage'))
    assert.deepEqual(continuation.input.find(item => item.id === OPENAI_SMOKE_REASONING.id), OPENAI_SMOKE_REASONING,
      'opaque reasoning returns only to the same provider during tool continuation')
    const output = continuation.input.find(item => item.type === 'function_call_output' && item.call_id === 'openai-smoke-usage')
    assert.ok(output, 'the actual API-read result returns under the exact call identity')
    assert.equal(JSON.parse(output.output).status, 200, 'the continued tool result is the successful workspace read')
    assertProviderTransport(fixture.requests)
    const session = await api(page, `/sessions/${sessionId}`)
    const activities = session.messages.flatMap(message => message.toolActivities ?? [])
    assert.equal(activities.length, 1)
    assert.equal(activities[0].status, 'done')
    assert.match(activities[0].summary, /GET \/api\/v1\/usage → 200/)
    const before = readOpenAIState(profile, provider.id, sessionId, identity.tenant.id)
    assert.equal(before.provider.id, provider.id)
    assert.equal(before.config.protocol, 'openai-responses')
    assertPhaseHistory(before.session.messages.at(-1))
    assert.equal(before.usage.fiveHour.consumed, 60)
    assert.equal(before.usage.weekly.consumed, 60)
    assertNoSecrets(before.productJson)
    assertNoSecrets(productRequests)
    await page.screenshot({ path: join(evidence, 'agent-tool-round.png'), fullPage: true, animations: 'disabled' })

    stage = 'rejected-key-replacement'
    fixture.setMode('failed-probe')
    await page.goto(`${origin}/models/${provider.id}`)
    await page.getByRole('button', { name: 'Update connection', exact: true }).click()
    const replacement = page.getByRole('dialog', { name: 'Update connection' })
    await replacement.getByPlaceholder('Paste replacement API key', { exact: true }).fill(OPENAI_SMOKE_REPLACEMENT_KEY)
    const refused = page.waitForResponse(response => response.request().method() === 'PATCH' && new URL(response.url()).pathname === `/api/v1/providers/${provider.id}/connection`)
    await replacement.getByRole('button', { name: 'Verify & update', exact: true }).click()
    assert.equal((await refused).status(), 400, 'a successful HTTP failed model reply cannot replace the connection')
    await expect(replacement).toContainText('Your connection details are still here.')
    assert.equal(fixture.requests.length, 4, 'failed output does not cause another capability attempt')
    assertProviderTransport(fixture.requests)
    await expect.poll(async () => JSON.parse(await readFile(vaultPath, 'utf8')).entries).toEqual(originalVault.entries)
    const rejected = readOpenAIState(profile, provider.id, sessionId, identity.tenant.id)
    assert.deepEqual(rejected.config, before.config, 'the original private connection remains intact')
    assert.equal(rejected.provider.connectionRevision, before.provider.connectionRevision)
    assert.deepEqual(rejected.usage, before.usage, 'rejected setup does not invent conversation spend')
    assertNoSecrets(rejected.productJson)
    assertNoSecrets(productRequests)
    await replacement.getByRole('button', { name: 'Cancel', exact: true }).click()
    fixture.setMode('text')

    stage = 'full-relaunch-and-restored-key'
    const oldOrigin = origin
    await close(run)
    run = undefined
    await assert.rejects(fetch(`${oldOrigin}/api/v1/me`, { signal: AbortSignal.timeout(1_000) }), 'the first backend actually exits')
    run = await launch(executable, profile)
    ;({ page, origin } = run)
    observe(page)
    const reopened = await api(page, '/me')
    assert.equal(reopened.user.id, identity.user.id, 'ordinary native relaunch retains the same signed identity')
    assert.deepEqual(await api(page, '/viewer-preferences/model'), preference)
    const after = readOpenAIState(profile, provider.id, sessionId, identity.tenant.id)
    assert.deepEqual(after.config, before.config)
    assert.deepEqual(after.session, before.session, 'the exact saved conversation and tool provenance survive relaunch')
    assert.deepEqual(after.usage, before.usage, 'usage counters and reset anchors survive relaunch exactly')
    assert.equal(fixture.requests.length, 4, 'startup never redispatches the saved model turn')
    await page.goto(`${origin}/s/${sessionId}`)
    const composer = page.getByRole('textbox', { name: 'Message', exact: true })
    await composer.fill('Continue after the full native relaunch.')
    await composer.press('Enter')
    await expect(page.locator('[data-turn]').filter({ hasText: 'The restored OpenAI connection completed another turn.' })).toBeVisible({ timeout: TIMEOUT_MS })
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
    assert.equal(fixture.requests.length, 5, 'the restored original device key permits exactly one fresh turn')
    assertPhaseHistory(after.session.messages.at(-1), fixture.requests[4])
    assertProviderTransport(fixture.requests)
    const retained = readOpenAIState(profile, provider.id, sessionId, identity.tenant.id)
    assert.equal(retained.usage.fiveHour.consumed, 90)
    assert.equal(retained.usage.weekly.consumed, 90)
    assert.equal(retained.session.messages.length, before.session.messages.length + 2)
    assertNoSecrets(retained.productJson)
    assertNoSecrets(productRequests)
    assertNoSecrets(await readFile(vaultPath, 'utf8'))
    await page.screenshot({ path: join(evidence, 'restored-connection.png'), fullPage: true, animations: 'disabled' })

    stage = 'agent-page-new-conversation'
    const sessionIdsBefore = (await api(page, '/sessions')).map(session => session.id).sort()
    const creationsBefore = sessionCreationRequests.length
    const fixtureRequestsBefore = fixture.requests.length
    await page.goto(`${origin}/agents/${agent.id}`)
    await page.getByRole('button', { name: 'New conversation', exact: true }).click()
    const agentComposer = page.getByRole('textbox', { name: 'Message', exact: true })
    await expect(agentComposer).toBeEnabled()
    await page.getByRole('button', { name: 'Model and effort', exact: true }).click()
    await expect(page.getByRole('combobox', { name: 'Conversation Agent', exact: true })).toHaveValue(agent.id)
    await page.keyboard.press('Escape')
    assert.deepEqual((await api(page, '/sessions')).map(session => session.id).sort(), sessionIdsBefore,
      'opening New conversation from the Agent page creates only an unsaved draft')
    assert.equal(sessionCreationRequests.length, creationsBefore, 'no session-creation request occurs before Send')
    assert.equal(fixture.requests.length, fixtureRequestsBefore, 'the draft does not call the model before Send')

    await agentComposer.fill('Reply once from the existing authored Agent page.')
    await agentComposer.press('Enter')
    await expect(page).toHaveURL(/\/s\/[^/]+$/)
    const newSessionId = new URL(page.url()).pathname.split('/').at(-1)
    assert.ok(newSessionId && newSessionId !== sessionId && newSessionId !== 'draft')
    await expect(page.locator('[data-turn]').filter({ hasText: 'The restored OpenAI connection completed another turn.' })).toBeVisible({ timeout: TIMEOUT_MS })
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
    assert.equal(sessionCreationRequests.length, creationsBefore + 1, 'Send materializes exactly one new conversation')
    assert.equal(fixture.requests.length, fixtureRequestsBefore + 1, 'one Send produces exactly one provider turn')
    const newSession = await api(page, `/sessions/${newSessionId}`)
    assert.equal(newSession.agentId, agent.id)
    assert.equal(newSession.providerId, undefined, 'the conversation inherits its provider from the selected Agent')
    assert.equal(newSession.modelId, undefined, 'the conversation inherits the provider default model')
    assert.equal(agent.providerId, provider.id)
    assert.equal(provider.defaultModelId, OPENAI_SMOKE_MODEL)
    assert.equal(fixture.requests.at(-1).model, OPENAI_SMOKE_MODEL, 'the new reply uses the inherited provider model')
    const newConversation = readOpenAIState(profile, provider.id, newSessionId, identity.tenant.id)
    const originalAfter = readOpenAIState(profile, provider.id, sessionId, identity.tenant.id)
    assert.deepEqual(originalAfter.session, retained.session, 'the Agent-page conversation does not alter the original session')
    assert.equal(newConversation.usage.fiveHour.consumed, 120)
    assert.equal(newConversation.usage.weekly.consumed, 120)
    assertNoSecrets(newConversation.productJson)
    assertNoSecrets(productRequests)
    assertNoSecrets(await readFile(vaultPath, 'utf8'))

    const preSecondRelaunchOrigin = origin
    await close(run)
    run = undefined
    await assert.rejects(fetch(`${preSecondRelaunchOrigin}/api/v1/me`, { signal: AbortSignal.timeout(1_000) }), 'the second backend actually exits')
    run = await launch(executable, profile)
    ;({ page, origin } = run)
    observe(page)
    assert.equal((await api(page, '/me')).user.id, identity.user.id)
    const durableOriginal = readOpenAIState(profile, provider.id, sessionId, identity.tenant.id)
    const durableNew = readOpenAIState(profile, provider.id, newSessionId, identity.tenant.id)
    assert.deepEqual(durableOriginal.session, retained.session)
    assert.deepEqual(durableNew.session, newConversation.session, 'the Agent-page conversation survives the second real relaunch')
    assert.deepEqual(durableNew.usage, newConversation.usage)
    assert.equal(fixture.requests.length, 6, 'startup does not replay either saved conversation')
    assertNoSecrets(durableNew.productJson)
    assertNoSecrets(productRequests)
    assertNoSecrets(await readFile(vaultPath, 'utf8'))
    await page.screenshot({ path: join(evidence, 'agent-page-conversation.png'), fullPage: true, animations: 'disabled' })
    console.log(`[desktop-openai-smoke] rendered OpenAI setup · OS-encrypted synthetic key · explicit Agent Dispatch · Responses stream + read tool + opaque continuation · exact SQLite usage · refused key replacement · signed-in relaunch and fresh authenticated turn · Agent-page unsent draft, bound conversation, exact usage, and second durable relaunch · evidence ${evidence}`)
  } catch (error) {
    await run?.page.screenshot({ path: join(evidence, `failure-${stage}.png`), fullPage: true }).catch(() => {})
    throw new Error(`Packaged OpenAI Responses acceptance failed at ${stage}: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    try { await close(run) } finally {
      try { await fixture?.close() } finally {
        await rm(profile, { recursive: true, force: true })
      }
    }
  }
}
