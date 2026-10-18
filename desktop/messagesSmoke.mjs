/** Ordinary packaged Claude/DeepSeek acceptance. Only the bounded upstream is
 * authored: native vault, UI, routes, SQLite, shutdown and relaunch stay real. */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect } from '@playwright/test'
import { CREDENTIAL_VAULT_FILE } from './credentialVault.mjs'
import { readProviderState } from './providerSmokeState.mjs'
import { patchProviderSmokeCeiling, assertProviderSmokeBudget, assertProviderSmokeBudgetRefusal } from './providerBudgetSmoke.mjs'
import { MESSAGES_SMOKE_KEY, MESSAGES_SMOKE_MODEL, MESSAGES_SMOKE_PRIVATE_ERROR,
  MESSAGES_SMOKE_TOOL_REPLY, MESSAGES_SMOKE_TEXT_REPLY, startMessagesSmokeFixture } from './messagesSmokeFixture.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const TIMEOUT_MS = 30_000
const STOP_TEXT = 'Stop while the packaged Messages retry wait is active.'
const QUOTA_ADVICE = 'The model provider requires a billing or quota change (HTTP 429). Check credits, spending limits and account usage limits with the provider.'

async function api(page, path, body) {
  const result = await page.evaluate(async ({ path, body }) => {
    const response = await fetch(`/api/v1${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', ...(body === undefined ? {} : { 'idempotency-key': crypto.randomUUID() }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return { status: response.status, body: await response.json() }
  }, { path, body })
  assert.ok(result.status >= 200 && result.status < 300, `Packaged Messages ${path} returned HTTP ${result.status}.`)
  return result.body
}

export function assertMessagesPrivate(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  for (const secret of [MESSAGES_SMOKE_KEY, MESSAGES_SMOKE_PRIVATE_ERROR]) {
    assert.ok(!text.includes(secret), 'provider credentials and private diagnostics never enter product data or request bodies')
  }
}

export function assertMessagesToolRound(requests, state) {
  assert.equal(requests.length, 4, 'one probe, one tool response and two identical continuation attempts')
  const [probe, first, failed, continuation] = requests
  assert.ok(probe.stream === undefined || probe.stream === false, 'the setup probe is non-streaming')
  assert.ok(first.tools.some(tool => tool.name === 'api__get_usage'))
  assert.deepEqual(failed, continuation, 'retry repeats only the failed continuation body')
  const results = continuation.messages.at(-1).content
  assert.ok(Array.isArray(results))
  const result = results.find(block => block.type === 'tool_result' && block.tool_use_id === 'messages-smoke-usage')
  assert.ok(result, 'the exact generated tool result reaches the real continuation')
  assert.equal(JSON.parse(result.content).status, 200)
  for (const body of requests.slice(1)) {
    assert.equal(body.model, MESSAGES_SMOKE_MODEL)
    assert.equal(body.stream, true)
    assert.equal(Object.hasOwn(body, 'output_config'), false, 'explicit unsupported effort remains omitted')
  }
  const activities = state.session.messages.flatMap(message => message.toolActivities ?? [])
  assert.equal(activities.length, 1, 'the completed tool is never repeated by a transport retry')
  assert.equal(activities[0].status, 'done')
  assert.equal(state.usage.fiveHour.consumed, 40, 'both completed responses include cache tokens exactly once')
  assert.equal(state.usage.weekly.consumed, 40)
  assertMessagesPrivate(requests)
  assertMessagesPrivate(state.productJson)
}

export function assertMessagesStopped(before, after) {
  assert.deepEqual(after.usage, before.usage, 'pre-output cancellation adds no usage')
  assert.deepEqual(after.session.messages.slice(0, -1), before.session.messages, 'Stop preserves all prior prose and tool receipts')
  assert.equal(after.session.messages.length, before.session.messages.length + 1)
  assert.equal(after.session.messages.at(-1).role, 'user', 'no invented assistant or separate cancellation receipt')
  assert.equal(after.session.messages.at(-1).content, STOP_TEXT)
  assertMessagesPrivate(after.productJson)
}

async function smokeFamily({ executable, launch, close }, family) {
  const profile = await mkdtemp(join(tmpdir(), `agent-commons-${family}-messages-smoke-`))
  let fixture, run, evidence, stage = 'startup'
  const requests = []
  const observe = page => page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/api/v1/')) requests.push(request.postData() ?? '')
  })
  try {
    const evidenceRoot = join(ROOT, '.data', 'desktop-messages-smoke')
    await mkdir(evidenceRoot, { recursive: true })
    evidence = await mkdtemp(join(evidenceRoot, `${family}-`))
    fixture = await startMessagesSmokeFixture({ family })
    run = await launch(executable, profile)
    let { page, origin } = run
    observe(page)
    const identity = await api(page, '/auth/signup', {
      name: `Packaged ${family} Owner`, email: `${family}-messages@example.test`, password: 'isolated-messages-smoke-password',
    })
    await page.reload()

    stage = 'rendered-secure-setup-and-page-two-catalog'
    await page.getByRole('button', { name: 'Connect a model', exact: true }).click()
    const setup = page.getByRole('dialog', { name: 'New provider' })
    await setup.getByRole('combobox', { name: /^Provider preset/ }).selectOption(family === 'claude' ? 'anthropic' : 'deepseek')
    await expect(setup.getByRole('combobox', { name: /^Protocol/ })).toHaveValue('anthropic-messages')
    const label = `Packaged ${family} Messages`
    await setup.getByLabel('Name', { exact: true }).fill(label)
    await setup.getByRole('textbox', { name: /^Endpoint URL/ }).fill(fixture.baseURL)
    await setup.getByLabel('Model ID', { exact: true }).fill(MESSAGES_SMOKE_MODEL)
    await setup.getByPlaceholder('Paste API key', { exact: true }).fill(MESSAGES_SMOKE_KEY)
    await setup.getByRole('button', { name: 'Create', exact: true }).click()
    await expect(setup).toHaveCount(0)
    await page.waitForURL(`${origin}/`)
    const composer = page.getByRole('textbox', { name: 'Message', exact: true })
    await expect(composer).toBeEnabled()
    const providers = await api(page, '/providers')
    const provider = providers.find(row => row.label === label)
    assert.ok(provider)
    assert.equal(provider.protocol, 'anthropic-messages')
    assert.equal(provider.execution, 'configured')
    assert.equal(provider.defaultModelId, MESSAGES_SMOKE_MODEL)
    assert.equal(provider.models.length, 2, 'discovery includes both pages, not a first-page prefix')
    assert.deepEqual(provider.models.find(model => model.id === MESSAGES_SMOKE_MODEL).effortLevels, [])
    assert.equal(fixture.catalogCount, 2)
    assert.equal(fixture.requests.length, 1, 'setup makes just one non-streaming probe')
    assertMessagesPrivate(providers)
    assert.ok(providers.every(row => !row.config && !row.apiKeyEnv))
    const preference = await api(page, '/viewer-preferences/model')
    assert.equal(preference.preferences.providerId, provider.id)
    await page.getByRole('button', { name: 'Model and effort', exact: true }).click()
    const picker = page.getByRole('dialog', { name: 'Model and effort', exact: true })
    await expect(picker.getByText('This model declares no effort levels.', { exact: true })).toBeVisible()
    await expect(picker.getByText('Effort', { exact: true })).toHaveCount(0)
    await page.keyboard.press('Escape')
    const vaultPath = join(profile, CREDENTIAL_VAULT_FILE)
    const originalVault = JSON.parse(await readFile(vaultPath, 'utf8'))
    assert.equal(Object.keys(originalVault.entries).length, 1)
    assertMessagesPrivate(originalVault)

    stage = 'tool-continuation-retry-and-cache-usage'
    fixture.setMode('retry-tools')
    await composer.fill('Read my usage and continue after a transient provider failure.')
    await composer.press('Enter')
    await expect(page).toHaveURL(/\/s\/[^/]+$/)
    const sessionId = new URL(page.url()).pathname.split('/').at(-1)
    await expect(page.locator('[data-turn]').filter({ hasText: MESSAGES_SMOKE_TOOL_REPLY })).toBeVisible({ timeout: TIMEOUT_MS })
    await expect(page.getByText('GET /api/v1/usage → 200', { exact: true })).toBeVisible()
    await expect(composer).toBeEnabled()
    const state = () => readProviderState(profile, provider.id, sessionId, identity.tenant.id)
    const completed = state()
    assertMessagesToolRound(fixture.requests, completed)
    assert.equal(completed.config.protocol, 'anthropic-messages')
    assert.equal(completed.config.baseURL, fixture.baseURL)
    assert.equal(completed.session.messages.at(-1).providerId, provider.id)
    assert.equal(completed.session.messages.at(-1).modelId, MESSAGES_SMOKE_MODEL)
    assertMessagesPrivate(requests)
    await page.screenshot({ path: join(evidence, 'tool-continuation.png'), fullPage: true, animations: 'disabled' })

    stage = 'terminal-quota-refusal'
    fixture.setMode('quota')
    await composer.fill('Explain a provider quota refusal safely.')
    await composer.press('Enter')
    await expect(page.locator('[data-turn]').filter({ hasText: QUOTA_ADVICE })).toBeVisible({ timeout: TIMEOUT_MS })
    await expect(composer).toBeEnabled()
    assert.equal(fixture.requests.length, 5, 'quota refusal does not trigger transport replay')
    const refused = state()
    assert.deepEqual(refused.usage, completed.usage)
    assert.equal(refused.session.messages.length, completed.session.messages.length + 2)
    assert.deepEqual(refused.session.messages.slice(0, -2), completed.session.messages)
    assert.equal(refused.session.messages.at(-2).role, 'user')
    assert.equal(refused.session.messages.at(-2).content, 'Explain a provider quota refusal safely.')
    assert.equal(refused.session.messages.at(-1).content, `*(${QUOTA_ADVICE} This turn will not be retried automatically.)*`)
    assertMessagesPrivate(refused.productJson)
    await expect(page.getByText(MESSAGES_SMOKE_PRIVATE_ERROR, { exact: false })).toHaveCount(0)

    stage = 'prompt-stop-during-retry-wait'
    fixture.setMode('retry-wait')
    await composer.fill(STOP_TEXT)
    await composer.press('Enter')
    await expect.poll(() => fixture.retryWaitResponses, { timeout: TIMEOUT_MS }).toBe(1)
    const waitStarted = fixture.retryWaitStartedAt
    await expect(composer).toBeDisabled()
    const stop = page.getByRole('button', { name: 'Stop', exact: true })
    await expect(stop).toBeVisible()
    // Observe the completed refusal before clicking; Stop must interrupt the
    // positive wait, not race before the model request has begun.
    await page.waitForTimeout(100)
    const stoppedAt = Date.now()
    assert.ok(waitStarted > 0 && stoppedAt - waitStarted < 2_000, 'Stop is exercised early in the active five-second retry wait')
    await stop.click()
    await expect(composer).toBeEnabled({ timeout: 2_000 })
    assert.ok(Date.now() - stoppedAt < 2_000, 'native Stop releases the conversation before Retry-After5')
    await expect(stop).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible()
    const stopped = state()
    assertMessagesStopped(refused, stopped)
    await page.waitForTimeout(Math.max(0, waitStarted + 5_300 - Date.now()))
    assert.equal(fixture.requests.length, 6, 'the cancelled wait makes no late provider request')
    await expect(page.getByText(MESSAGES_SMOKE_PRIVATE_ERROR, { exact: false })).toHaveCount(0)
    assertMessagesPrivate(requests)
    await page.screenshot({ path: join(evidence, 'stopped-retry.png'), fullPage: true, animations: 'disabled' })

    stage = 'signed-in-relaunch-without-replay'
    const savedBudgetProvider = await patchProviderSmokeCeiling(page, provider.id, 40)
    const previousOrigin = origin
    await close(run)
    run = undefined
    await assert.rejects(fetch(`${previousOrigin}/api/v1/me`, { signal: AbortSignal.timeout(1_000) }), 'the prior backend really exits')
    run = await launch(executable, profile)
    ;({ page, origin } = run)
    observe(page)
    assert.equal((await api(page, '/me')).user.id, identity.user.id)
    assert.deepEqual(await api(page, '/viewer-preferences/model'), preference)
    const restored = state()
    assertProviderSmokeBudget(restored, savedBudgetProvider)
    assert.deepEqual(restored.config, stopped.config)
    assert.deepEqual(restored.session, stopped.session)
    assert.deepEqual(restored.usage, stopped.usage)
    assert.deepEqual(JSON.parse(await readFile(vaultPath, 'utf8')).entries, originalVault.entries)
    assert.equal(fixture.requests.length, 6, 'startup does not replay a completed or cancelled turn')
    await page.goto(`${origin}/s/${sessionId}`)
    await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible()
    const budgetSessionIds = (await api(page, '/sessions')).map(session => session.id).sort()
    const budgetRequestsBefore = fixture.requests.length
    fixture.setMode('text')
    const budgetRefusal = page.waitForResponse(response => response.request().method() === 'POST'
      && new URL(response.url()).pathname === `/api/v1/sessions/${sessionId}/messages`)
    await page.getByRole('button', { name: 'Retry', exact: true }).click()
    const budgetResponse = await budgetRefusal
    assertProviderSmokeBudgetRefusal({ status: budgetResponse.status(), body: await budgetResponse.json() },
      restored, state(), budgetRequestsBefore, fixture.requests.length)
    assert.deepEqual((await api(page, '/sessions')).map(session => session.id).sort(), budgetSessionIds, 'refused Retry creates no extra Session')
    await expect(page.getByRole('alert').filter({ hasText: /Plan limit reached for '5-hour limit'/ })).toBeVisible()
    await patchProviderSmokeCeiling(page, provider.id, 1000)
    assert.equal(fixture.requests.length, budgetRequestsBefore, 'plan repair does not replay the stopped turn')

    stage = 'fresh-conversation-with-restored-device-key'
    fixture.setMode('text')
    await page.getByRole('button', { name: 'New session', exact: true }).click()
    const freshComposer = page.getByRole('textbox', { name: 'Message', exact: true })
    await expect(freshComposer).toBeEnabled()
    await freshComposer.fill('Start fresh after the full native relaunch.')
    await freshComposer.press('Enter')
    await expect(page).toHaveURL(/\/s\/[^/]+$/)
    const freshId = new URL(page.url()).pathname.split('/').at(-1)
    assert.notEqual(freshId, sessionId)
    await expect(page.locator('[data-turn]').filter({ hasText: MESSAGES_SMOKE_TEXT_REPLY })).toBeVisible({ timeout: TIMEOUT_MS })
    await expect(freshComposer).toBeEnabled()
    assert.equal(fixture.requests.length, 7)
    const fresh = readProviderState(profile, provider.id, freshId, identity.tenant.id)
    assert.deepEqual(state().session, stopped.session, 'a new conversation leaves the recovered history untouched')
    assert.equal(fresh.session.messages.length, 2)
    assert.equal(fresh.session.messages.at(-1).content, MESSAGES_SMOKE_TEXT_REPLY)
    assert.equal(fresh.session.messages.at(-1).providerId, provider.id)
    assert.equal(fresh.session.messages.at(-1).modelId, MESSAGES_SMOKE_MODEL)
    assert.equal(fresh.usage.fiveHour.consumed, 60)
    assert.equal(fresh.usage.weekly.consumed, 60)
    assertMessagesPrivate(fresh.productJson)
    assertMessagesPrivate(fixture.requests)
    assertMessagesPrivate(requests)
    assertMessagesPrivate(await readFile(vaultPath, 'utf8'))
    await page.screenshot({ path: join(evidence, 'fresh-conversation.png'), fullPage: true, animations: 'disabled' })
    console.log(`[desktop-messages-smoke] ${family} · encrypted setup · page-two catalog/no effort override · tool continuation retry · cache-aware usage · quota refusal · prompt Stop · signed-in relaunch without replay · restored provider budget refuses Retry without effects · explicit plan repair and fresh conversation · evidence ${evidence}`)
  } catch (error) {
    if (evidence) await run?.page.screenshot({ path: join(evidence, `failure-${stage}.png`), fullPage: true }).catch(() => {})
    throw new Error(`Packaged ${family} Messages acceptance failed at ${stage}: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    try { await close(run) } finally {
      try { await fixture?.close() } finally { await rm(profile, { recursive: true, force: true }) }
    }
  }
}

export async function smokePackagedMessages(options) {
  for (const family of ['claude', 'deepseek']) await smokeFamily(options, family)
}
