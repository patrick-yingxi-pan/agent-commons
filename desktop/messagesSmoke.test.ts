import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { SLICE_KIND } from '../server/persistence/format.ts'
import { ignoreFromPackage } from './packager.config.mjs'
import { assertMessagesPrivate, assertMessagesStopped, assertMessagesToolRound } from './messagesSmoke.mjs'
import { MESSAGES_SMOKE_KEY, MESSAGES_SMOKE_MODEL, MESSAGES_SMOKE_PRIVATE_ERROR } from './messagesSmokeFixture.mjs'
import { readProviderState } from './providerSmokeState.mjs'

const source = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8')
const STOP_TEXT = 'Stop while the packaged Messages retry wait is active.'

function acceptedToolRound() {
  const continuation = {
    model: MESSAGES_SMOKE_MODEL,
    stream: true,
    messages: [{ role: 'user', content: [{
      type: 'tool_result', tool_use_id: 'messages-smoke-usage', content: '{"status":200}',
    }] }],
  }
  return {
    requests: [
      { model: MESSAGES_SMOKE_MODEL, messages: [] },
      { model: MESSAGES_SMOKE_MODEL, stream: true, tools: [{ name: 'api__get_usage' }], messages: [] },
      structuredClone(continuation),
      structuredClone(continuation),
    ],
    state: {
      session: { messages: [{ toolActivities: [{ status: 'done' }] }] },
      usage: { fiveHour: { consumed: 40 }, weekly: { consumed: 40 } },
      productJson: '{"saved":"ordinary product data"}',
    },
  }
}

test('packaged Claude and DeepSeek Messages helpers and fixture never ship', () => {
  for (const path of [
    '/desktop/messagesSmoke.mjs',
    '/desktop/messagesSmokeFixture.mjs',
    '/desktop/providerSmokeState.mjs',
  ]) assert.equal(ignoreFromPackage(path), true, path)
})

test('ordinary packaged verification awaits Messages recovery with the real launcher', () => {
  const smoke = source('./smoke.mjs')
  assert.ok(smoke.includes("import { smokePackagedMessages } from './messagesSmoke.mjs'"))
  assert.ok(smoke.includes('await smokePackagedMessages({ executable, launch: launchPackagedDesktop, close: closePackagedDesktop })'))
})

function assertWorkflow(smoke: string) {
  let previous = -1
  for (const stage of [
    'rendered-secure-setup-and-page-two-catalog',
    'tool-continuation-retry-and-cache-usage',
    'terminal-quota-refusal',
    'prompt-stop-during-retry-wait',
    'signed-in-relaunch-without-replay',
    'fresh-conversation-with-restored-device-key',
  ]) {
    const at = smoke.indexOf(`stage = '${stage}'`)
    assert.ok(at > previous, `packaged Messages acceptance retains ${stage} in order`)
    previous = at
  }
  let discoveryStep = -1
  for (const fragment of [
    "getByLabel('Model ID', { exact: true }).fill('')",
    "getByRole('button', { name: 'Load models', exact: true }).click()",
    "toHaveAttribute('data-provider-model-discovery', 'loaded')",
    "getByRole('combobox', { name: 'Available models', exact: true }).selectOption(MESSAGES_SMOKE_MODEL)",
    'assert.equal(fixture.requests.length, 0',
    "assert.deepEqual(await api(page, '/providers'), providersBeforeDiscovery",
    "assert.deepEqual(await api(page, '/viewer-preferences/model'), preferencesBeforeDiscovery",
    'assert.equal(provisionalVault.entries[preparedReference].providerId, undefined',
    "getByRole('button', { name: 'Create', exact: true }).click()",
    'assert.deepEqual(Object.keys(originalVault.entries), [preparedReference]',
    'assert.equal(originalVault.entries[preparedReference].providerId, provider.id',
  ]) {
    const at = smoke.indexOf(fragment)
    assert.ok(at > discoveryStep, `Messages discovery checks ${fragment} in order`)
    discoveryStep = at
  }
  for (const fragment of [
    "selectOption(family === 'claude' ? 'anthropic' : 'deepseek')",
    "toHaveValue('anthropic-messages')",
    'assert.equal(provider.models.length, 2',
    'assert.equal(fixture.catalogCount, 2)',
    'assert.equal(fixture.catalogCount, 4)',
    "getByPlaceholder('Paste API key', { exact: true })).toHaveValue('')",
    'assert.equal(Object.keys(provisionalVault.entries).length, 1',
    "getByText('This model declares no effort levels.'",
    'assertMessagesToolRound(fixture.requests, completed)',
    "assert.equal(fixture.requests.length, 5, 'quota refusal does not trigger transport replay')",
    'assert.equal(refused.session.messages.length, completed.session.messages.length + 2)',
    "assert.equal(refused.session.messages.at(-2).role, 'user')",
    "assert.equal(refused.session.messages.at(-2).content, 'Explain a provider quota refusal safely.')",
    'assertMessagesStopped(refused, stopped)',
    'await expect(page.getByText(MESSAGES_SMOKE_PRIVATE_ERROR, { exact: false })).toHaveCount(0)',
    'const waitStarted = fixture.retryWaitStartedAt',
    "assert.ok(waitStarted > 0 && stoppedAt - waitStarted < 2_000, 'Stop is exercised early in the active five-second retry wait')",
    "assert.ok(Date.now() - stoppedAt < 2_000, 'native Stop releases the conversation before Retry-After5')",
    'assert.deepEqual(restored.session, stopped.session)',
    'assert.deepEqual(restored.usage, stopped.usage)',
    "assert.equal(fixture.requests.length, 6, 'startup does not replay a completed or cancelled turn')",
    'assert.equal(fixture.requests.length, 7)',
    "await close(run)",
    "await fixture?.close()",
  ]) assert.ok(smoke.includes(fragment), `packaged Messages workflow retains ${fragment}`)
  assert.doesNotMatch(smoke, /_electron|use-mock-keychain|mock-keychain|store\.\w+\(/,
    'the workflow uses ordinary packaged launches and public product paths, not injected app authority')
}

test('the packaged Messages workflow covers both provider flavors and durable recovery', () => {
  const smoke = source('./messagesSmoke.mjs')
  assertWorkflow(smoke)
  for (const [from, to] of [
    ["getByRole('button', { name: 'Load models', exact: true }).click()", "getByRole('button', { name: 'Skip discovery', exact: true }).click()"],
    ['assert.deepEqual(Object.keys(originalVault.entries), [preparedReference]', 'assert.deepEqual(Object.keys(originalVault.entries), []'],
    ['assert.equal(provider.models.length, 2', 'assert.equal(provider.models.length, 1'],
    ['assertMessagesToolRound(fixture.requests, completed)', 'void(fixture.requests, completed)'],
    ["assert.equal(refused.session.messages.at(-2).content, 'Explain a provider quota refusal safely.')", "assert.equal(refused.session.messages.at(-2).content, 'Changed quota prompt.')"],
    ['const waitStarted = fixture.retryWaitStartedAt', 'const waitStarted = 0'],
    ['assertMessagesStopped(refused, stopped)', 'void(refused, stopped)'],
    ['assert.deepEqual(restored.session, stopped.session)', 'void(restored.session, stopped.session)'],
    ["assert.equal(fixture.requests.length, 6, 'startup does not replay a completed or cancelled turn')", "assert.equal(fixture.requests.length, 7, 'startup does not replay a completed or cancelled turn')"],
  ]) {
    assert.notEqual(smoke.replace(from, to), smoke, `mutation fixture changes ${from}`)
    assert.throws(() => assertWorkflow(smoke.replace(from, to)), assert.AssertionError)
  }
})

test('Messages continuation assertions require one exact retry, one tool effect and cache-inclusive usage', () => {
  const { requests, state } = acceptedToolRound()
  assertMessagesToolRound(requests, state)

  const explicitProbe = structuredClone(requests)
  explicitProbe[0].stream = false
  assertMessagesToolRound(explicitProbe, state)
  explicitProbe[0].stream = true
  assert.throws(() => assertMessagesToolRound(explicitProbe, state), assert.AssertionError)

  const mismatchedRetry = structuredClone(requests)
  mismatchedRetry[3].messages[0].content[0].content = '{"status":500}'
  assert.throws(() => assertMessagesToolRound(mismatchedRetry, state), assert.AssertionError)

  const repeatedTool = structuredClone(state)
  repeatedTool.session.messages[0].toolActivities.push({ status: 'done' })
  assert.throws(() => assertMessagesToolRound(requests, repeatedTool), assert.AssertionError)

  const cacheTokensOmitted = structuredClone(state)
  cacheTokensOmitted.usage.fiveHour.consumed = 34
  assert.throws(() => assertMessagesToolRound(requests, cacheTokensOmitted), assert.AssertionError)

  const unsupportedOverride = structuredClone(requests)
  unsupportedOverride[1].output_config = { effort: 'high' }
  assert.throws(() => assertMessagesToolRound(unsupportedOverride, state), assert.AssertionError)

  const leakedProviderError = structuredClone(state)
  leakedProviderError.productJson += MESSAGES_SMOKE_PRIVATE_ERROR
  assert.throws(() => assertMessagesToolRound(requests, leakedProviderError), assert.AssertionError)
})

test('Messages Stop history preserves prior state and persists only the authored user row', () => {
  const before = {
    session: { messages: [{ role: 'user', content: 'Earlier prompt' }, { role: 'assistant', content: 'Earlier answer' }] },
    usage: { fiveHour: { consumed: 40 }, weekly: { consumed: 40 } },
    productJson: '{"history":"ordinary"}',
  }
  const after = {
    ...structuredClone(before),
    session: { messages: [...structuredClone(before.session.messages), { role: 'user', content: STOP_TEXT }] },
  }
  assertMessagesStopped(before, after)

  const assistantReceipt = structuredClone(after)
  assistantReceipt.session.messages.push({ role: 'assistant', content: 'Cancelled.' })
  assert.throws(() => assertMessagesStopped(before, assistantReceipt), assert.AssertionError)

  const chargedStop = structuredClone(after)
  chargedStop.usage.weekly.consumed++
  assert.throws(() => assertMessagesStopped(before, chargedStop), assert.AssertionError)

  const wrongPrompt = structuredClone(after)
  wrongPrompt.session.messages.at(-1).content = 'A different row.'
  assert.throws(() => assertMessagesStopped(before, wrongPrompt), assert.AssertionError)
})

test('Messages privacy helper rejects synthetic credentials and private provider diagnostics', () => {
  assertMessagesPrivate({ body: 'ordinary fixture data' })
  for (const secret of [MESSAGES_SMOKE_KEY, MESSAGES_SMOKE_PRIVATE_ERROR]) {
    assert.throws(() => assertMessagesPrivate({ captured: secret }), assert.AssertionError)
  }
})

test('read-only provider SQLite observer returns only the requested identities plus a bounded secret scan', () => {
  assert.equal(SLICE_KIND.providers, 'mapEntries')
  assert.equal(SLICE_KIND.providerConfigs, 'mapEntries')
  assert.equal(SLICE_KIND.sessions, 'array')
  assert.equal(SLICE_KIND.usageMeters, 'mapEntries')
  const profile = mkdtempSync(join(tmpdir(), 'messages-state-lock-'))
  const database = new DatabaseSync(join(profile, 'store.db'))
  database.exec('CREATE TABLE entities (slice TEXT, entity_id TEXT, json TEXT); CREATE TABLE map_entries (slice TEXT, key TEXT, json TEXT); CREATE TABLE kv (key TEXT, json TEXT); CREATE TABLE image_assets (image_json TEXT, original_json TEXT)')
  const provider = { id: 'provider-messages', connectionRevision: 2 }
  const session = { id: 'session-messages', messages: [{ role: 'user', content: 'Keep exact history' }] }
  const config = { protocol: 'anthropic-messages', apiKeyEnv: 'PROVIDER_TEST_REF' }
  const usage = { fiveHour: { consumed: 40 }, weekly: { consumed: 40 } }
  database.prepare('INSERT INTO map_entries VALUES (?, ?, ?)').run('providers', provider.id, JSON.stringify(provider))
  database.prepare('INSERT INTO entities VALUES (?, ?, ?)').run('sessions', session.id, JSON.stringify(session))
  database.prepare('INSERT INTO map_entries VALUES (?, ?, ?)').run('providerConfigs', provider.id, JSON.stringify(config))
  database.prepare('INSERT INTO map_entries VALUES (?, ?, ?)').run('usageMeters', 'tenant-messages', JSON.stringify(usage))
  database.prepare('INSERT INTO kv VALUES (?, ?)').run('singleton', '{"marker":"singleton-scan"}')
  database.prepare('INSERT INTO image_assets VALUES (?, ?)').run('{"marker":"image-scan"}', '{"marker":"original-scan"}')
  database.close()
  try {
    const state = readProviderState(profile, provider.id, session.id, 'tenant-messages')
    assert.deepEqual(state.provider, provider)
    assert.deepEqual(state.config, config)
    assert.deepEqual(state.session, session)
    assert.deepEqual(state.usage, usage)
    for (const marker of ['singleton-scan', 'image-scan', 'original-scan']) assert.ok(state.productJson.includes(marker))
    const missing = readProviderState(profile, 'other-provider', 'other-session', 'other-tenant')
    for (const key of ['provider', 'config', 'session', 'usage']) assert.equal(missing[key], undefined, key)
  } finally {
    rmSync(profile, { recursive: true, force: true })
  }
})
