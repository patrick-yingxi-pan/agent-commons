/** Native Responses acceptance against a bounded, test-owned loopback peer.
 * The executable, rendered setup/Dispatch, OS custody, SQLite and relaunch are
 * real. This does not contact OpenAI or establish paid-provider acceptance. */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect } from '@playwright/test'
import { CREDENTIAL_VAULT_FILE } from './credentialVault.mjs'
import { readProviderState as readOpenAIState } from './providerSmokeState.mjs'
import { patchProviderSmokeCeiling, assertProviderSmokeBudget, assertProviderSmokeBudgetRefusal } from './providerBudgetSmoke.mjs'
export { readProviderState as readOpenAIState } from './providerSmokeState.mjs'
import {
  OPENAI_SMOKE_MODEL, OPENAI_SMOKE_KEY, OPENAI_SMOKE_REPLACEMENT_KEY,
  OPENAI_SMOKE_REASONING, OPENAI_SMOKE_PRIVATE_ERROR, startOpenAIResponsesSmokeFixture,
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

function assertNoSecrets(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  for (const secret of [OPENAI_SMOKE_KEY, OPENAI_SMOKE_REPLACEMENT_KEY, OPENAI_SMOKE_REASONING.encrypted_content, OPENAI_SMOKE_PRIVATE_ERROR]) {
    assert.ok(!text.includes(secret), 'credentials, opaque reasoning and private provider diagnostics stay out of product data and renderer HTTP')
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
    if (index === 2 || index === 3) {
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
    fixture.setMode('retry-tools')
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
    assert.equal(fixture.requests.length, 4, 'one probe, the tool call, and two identical continuation attempts')
    const [first, failedContinuation, continuation] = fixture.requests.slice(1)
    assert.equal(first.stream, true)
    assert.equal(failedContinuation.stream, true)
    assert.equal(continuation.stream, true)
    assert.deepEqual(failedContinuation, continuation, 'the retry replays the exact admitted continuation body')
    assert.ok(first.instructions.includes(instructions), 'the selected Agent instructions reach Responses')
    assert.ok(first.tools.some(tool => tool.type === 'function' && tool.name === 'api__get_usage'))
    assert.deepEqual(continuation.input.find(item => item.id === OPENAI_SMOKE_REASONING.id), OPENAI_SMOKE_REASONING,
      'opaque reasoning returns only to the same provider during tool continuation')
    const failedOutput = failedContinuation.input.find(item => item.type === 'function_call_output' && item.call_id === 'openai-smoke-usage')
    assert.ok(failedOutput, 'the failed continuation contains the exact tool receipt')
    assert.equal(JSON.parse(failedOutput.output).status, 200)
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
    assert.equal(fixture.requests.length, 5, 'failed output does not cause another capability attempt')
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
    assert.equal(agent.budget, undefined, 'the authored Agent inherits its provider budget')
    const savedBudgetProvider = await patchProviderSmokeCeiling(page, provider.id, 60)
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
    assertProviderSmokeBudget(after, savedBudgetProvider)
    assert.equal((await api(page, `/agents/${agent.id}`)).budget, undefined, 'native rehydration preserves sparse Agent inheritance')
    assert.deepEqual(after.config, before.config)
    assert.deepEqual(after.session, before.session, 'the exact saved conversation and tool provenance survive relaunch')
    assert.deepEqual(after.usage, before.usage, 'usage counters and reset anchors survive relaunch exactly')
    assert.equal(fixture.requests.length, 5, 'startup never redispatches the saved model turn')
    await page.goto(`${origin}/s/${sessionId}`)
    const composer = page.getByRole('textbox', { name: 'Message', exact: true })
    const budgetSessionIds = (await api(page, '/sessions')).map(session => session.id).sort()
    const budgetRequestsBefore = fixture.requests.length
    const budgetRefusal = page.waitForResponse(response => response.request().method() === 'POST'
      && new URL(response.url()).pathname === `/api/v1/sessions/${sessionId}/messages`)
    await composer.fill('Continue after the full native relaunch.')
    await composer.press('Enter')
    const budgetResponse = await budgetRefusal
    assertProviderSmokeBudgetRefusal({ status: budgetResponse.status(), body: await budgetResponse.json() },
      after, readOpenAIState(profile, provider.id, sessionId, identity.tenant.id), budgetRequestsBefore, fixture.requests.length)
    assert.deepEqual((await api(page, '/sessions')).map(session => session.id).sort(), budgetSessionIds, 'the refused send creates no extra Session')
    const budgetError = page.getByRole('alert').filter({ hasText: /Plan limit reached for '5-hour limit'/ })
    await expect(budgetError).toBeVisible()
    await expect(budgetError.getByRole('button', { name: 'Retry', exact: true })).toBeEnabled()
    await patchProviderSmokeCeiling(page, provider.id, 1000)
    assert.equal(fixture.requests.length, budgetRequestsBefore, 'repairing the plan never replays the refused intent')
    await budgetError.getByRole('button', { name: 'Retry', exact: true }).click()
    await expect(page.locator('[data-turn]').filter({ hasText: 'The restored OpenAI connection completed another turn.' })).toBeVisible({ timeout: TIMEOUT_MS })
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
    assert.equal(fixture.requests.length, 6, 'the restored original device key permits exactly one fresh turn')
    assertPhaseHistory(after.session.messages.at(-1), fixture.requests[5])
    assertProviderTransport(fixture.requests)
    const retained = readOpenAIState(profile, provider.id, sessionId, identity.tenant.id)
    assert.equal(retained.usage.fiveHour.consumed, 90)
    assert.equal(retained.usage.weekly.consumed, 90)
    assert.equal(retained.session.messages.length, before.session.messages.length + 2)
    assert.equal(retained.session.messages.at(-2).content, 'Continue after the full native relaunch.', 'explicit Retry preserves the exact refused intent once')
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
    assert.equal(fixture.requests.length, 7, 'startup does not replay either saved conversation')
    assertNoSecrets(durableNew.productJson)
    assertNoSecrets(productRequests)
    assertNoSecrets(await readFile(vaultPath, 'utf8'))
    await page.screenshot({ path: join(evidence, 'agent-page-conversation.png'), fullPage: true, animations: 'disabled' })

    stage = 'rendered-quota-refusal'
    fixture.setMode('quota')
    await page.goto(`${origin}/s/${newSessionId}`)
    const quotaBefore = readOpenAIState(profile, provider.id, newSessionId, identity.tenant.id)
    const quotaComposer = page.getByRole('textbox', { name: 'Message', exact: true })
    await quotaComposer.fill('Check that a provider quota refusal is shown safely.')
    await quotaComposer.press('Enter')
    const quotaAdvice = 'The model provider requires a billing or quota change (HTTP 429). Check credits, spending limits and account usage limits with the provider.'
    await expect(page.locator('[data-turn]').filter({ hasText: quotaAdvice })).toBeVisible({ timeout: TIMEOUT_MS })
    await expect(page.getByText(OPENAI_SMOKE_PRIVATE_ERROR, { exact: false })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
    assert.equal(fixture.requests.length, 8, 'quota refusal makes exactly one provider call')
    const quotaAfter = readOpenAIState(profile, provider.id, newSessionId, identity.tenant.id)
    assert.deepEqual(quotaAfter.usage, quotaBefore.usage, 'quota refusal records no model usage')
    assert.deepEqual(quotaAfter.session.messages.slice(0, quotaBefore.session.messages.length), quotaBefore.session.messages,
      'the refused send preserves the complete prior Agent-page conversation')
    assert.equal(quotaAfter.session.messages.length, quotaBefore.session.messages.length + 2,
      'the refused send persists its user row and static assistant refusal')
    assert.equal(quotaAfter.session.messages.at(-2)?.role, 'user')
    assert.equal(quotaAfter.session.messages.at(-2)?.content, 'Check that a provider quota refusal is shown safely.')
    assert.equal(quotaAfter.session.messages.at(-1)?.role, 'assistant')
    assert.equal(quotaAfter.session.messages.at(-1)?.content,
      `*(${quotaAdvice} This turn will not be retried automatically.)*`, 'the persisted quota advice is exact and excludes provider diagnostics')
    assertNoSecrets(quotaAfter.productJson)
    assertNoSecrets(productRequests)
    await page.screenshot({ path: join(evidence, 'quota-refusal.png'), fullPage: true, animations: 'disabled' })

    stage = 'rendered-stop-during-retry-wait'
    fixture.setMode('retry-wait')
    const waitComposer = page.getByRole('textbox', { name: 'Message', exact: true })
    await waitComposer.fill('Stop while the provider retry delay is active.')
    await waitComposer.press('Enter')
    const stop = page.getByRole('button', { name: 'Stop', exact: true })
    await expect(stop).toBeVisible({ timeout: TIMEOUT_MS })
    await expect.poll(() => fixture.retryWaitResponses, { timeout: TIMEOUT_MS }).toBe(1)
    // Let the loopback 503 reach the native client; an immediate replay despite
    // Retry-After: 30 becomes a second fixture request before the user cancels.
    await page.waitForTimeout(250)
    await expect(stop).toBeVisible()
    assert.equal(fixture.requests.length, 9, 'positive Retry-After produces only the first provider request')
    await stop.click()
    await expect(stop).toHaveCount(0, { timeout: TIMEOUT_MS })
    await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible({ timeout: TIMEOUT_MS })
    const stopped = readOpenAIState(profile, provider.id, newSessionId, identity.tenant.id)
    assert.equal(fixture.requests.length, 9, 'Stop aborts the active retry wait without replay')
    assert.deepEqual(stopped.usage, quotaAfter.usage, 'aborted retry wait records no model usage')
    assert.deepEqual(stopped.session.messages.slice(0, quotaAfter.session.messages.length), quotaAfter.session.messages,
      'Stop retains the exact quota-refusal history')
    assert.equal(stopped.session.messages.length, quotaAfter.session.messages.length + 1,
      'transport cancellation before message.start persists only the sent user row')
    assert.equal(stopped.session.messages.at(-1)?.role, 'user')
    assert.equal(stopped.session.messages.at(-1)?.content, 'Stop while the provider retry delay is active.')
    assert.equal(stopped.session.messages.filter(message => message.role === 'assistant').length,
      quotaAfter.session.messages.filter(message => message.role === 'assistant').length,
      'the pre-stream Stop has no partial assistant text or separate cancel receipt')
    await expect(page.getByText(OPENAI_SMOKE_PRIVATE_ERROR, { exact: false })).toHaveCount(0)
    assertNoSecrets(stopped.productJson)
    assertNoSecrets(productRequests)
    await page.screenshot({ path: join(evidence, 'stopped-retry-wait.png'), fullPage: true, animations: 'disabled' })

    stage = 'final-relaunch-no-replay'
    const preFinalRelaunchOrigin = origin
    await close(run)
    run = undefined
    await assert.rejects(fetch(`${preFinalRelaunchOrigin}/api/v1/me`, { signal: AbortSignal.timeout(1_000) }), 'the third backend actually exits')
    run = await launch(executable, profile)
    ;({ page, origin } = run)
    observe(page)
    assert.equal((await api(page, '/me')).user.id, identity.user.id)
    const finalOriginal = readOpenAIState(profile, provider.id, sessionId, identity.tenant.id)
    const finalNew = readOpenAIState(profile, provider.id, newSessionId, identity.tenant.id)
    assert.deepEqual(finalOriginal.session, retained.session, 'the original tool conversation remains exact after the final relaunch')
    assert.deepEqual(finalOriginal.usage, stopped.usage, 'account-wide usage still includes the Agent-page conversation and no refused/aborted spend')
    assert.deepEqual(finalNew.session, stopped.session, 'quota refusal and stopped retry history survive without mutation')
    assert.deepEqual(finalNew.usage, stopped.usage)
    assert.equal(fixture.requests.length, 9, 'final startup does not dispatch saved work')
    assertProviderTransport(fixture.requests)
    assertNoSecrets(finalNew.productJson)
    assertNoSecrets(productRequests)
    assertNoSecrets(await readFile(vaultPath, 'utf8'))
    await page.screenshot({ path: join(evidence, 'final-relaunch.png'), fullPage: true, animations: 'disabled' })
    console.log(`[desktop-openai-smoke] rendered OpenAI setup · OS-encrypted synthetic key · explicit Agent Dispatch · Responses stream + read tool + retried opaque continuation · exact SQLite usage · refused key replacement · inherited budget refusal after signed-in relaunch and explicit Retry with restored key · Agent-page draft/relaunch · rendered quota refusal and stopped positive retry wait · final exact-history relaunch without replay · evidence ${evidence}`)
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
