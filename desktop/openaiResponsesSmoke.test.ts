import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { SLICE_KIND } from '../server/persistence/format.ts'
import { ignoreFromPackage } from './packager.config.mjs'
import { assertProviderTransport, assertPhaseHistory, readOpenAIState } from './openaiResponsesSmoke.mjs'
import { OPENAI_SMOKE_KEY, OPENAI_SMOKE_REPLACEMENT_KEY, OPENAI_SMOKE_REASONING, OPENAI_SMOKE_PRIVATE_ERROR } from './openaiResponsesSmokeFixture.mjs'

const source = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8')

test('the packaged Responses acceptance and local peer never ship in the product', () => {
  for (const path of ['/desktop/openaiResponsesSmoke.mjs', '/desktop/openaiResponsesSmokeFixture.mjs']) {
    assert.equal(ignoreFromPackage(path), true, path)
  }
})

test('ordinary packaged verification awaits native Responses acceptance using its real launcher', () => {
  const smoke = source('./smoke.mjs')
  assert.ok(smoke.includes("import { smokePackagedOpenAIResponses } from './openaiResponsesSmoke.mjs'"))
  assert.ok(smoke.includes('await smokePackagedOpenAIResponses({ executable, launch: launchPackagedDesktop, close: closePackagedDesktop })'))
})

function assertWorkflow(smoke: string) {
  let previous = -1
  for (const stage of ['rendered-secure-setup', 'agent-dispatch-tool-round', 'rejected-key-replacement', 'full-relaunch-and-restored-key', 'agent-page-new-conversation', 'rendered-quota-refusal', 'rendered-stop-during-retry-wait', 'final-relaunch-no-replay']) {
    const at = smoke.indexOf(`stage = '${stage}'`)
    assert.ok(at > previous, `real packaged ${stage} remains in order`)
    previous = at
  }
  for (const fragment of [
    "getByRole('combobox', { name: /^Provider preset/ }).selectOption('openai')",
    "getByRole('combobox', { name: 'Agent', exact: true }).selectOption(agent.id)",
    "getByRole('button', { name: 'Dispatch', exact: true }).click()",
    'assert.deepEqual(continuation.input.find(item => item.id === OPENAI_SMOKE_REASONING.id), OPENAI_SMOKE_REASONING',
    'fixture.setMode(\'retry-tools\')',
    'assert.deepEqual(failedContinuation, continuation,',
    'assert.equal(fixture.requests.length, 4, \'one probe, the tool call, and two identical continuation attempts\')',
    'assert.equal(fixture.requests.length, 5, \'failed output does not cause another capability attempt\')',
    'assert.equal(JSON.parse(failedOutput.output).status, 200)',
    'assert.equal(JSON.parse(output.output).status, 200',
    'assert.equal((await refused).status(), 400',
    'assert.deepEqual(rejected.config, before.config',
    'assert.deepEqual(after.session, before.session',
    'assert.deepEqual(after.usage, before.usage',
    'assertPhaseHistory(before.session.messages.at(-1))',
    'assertPhaseHistory(after.session.messages.at(-1), fixture.requests[5])',
    'assert.equal(fixture.requests.length, 6',
    'assert.equal(retained.usage.fiveHour.consumed, 90)',
    "await page.goto(`${origin}/agents/${agent.id}`)",
    "getByRole('button', { name: 'New conversation', exact: true }).click()",
    "getByRole('combobox', { name: 'Conversation Agent', exact: true })).toHaveValue(agent.id)",
    'assert.equal(fixture.requests.length, 6,',
    "assert.equal(sessionCreationRequests.length, creationsBefore, 'no session-creation request occurs before Send')",
    'opening New conversation from the Agent page creates only an unsaved draft',
    "const newSession = await api(page, `/sessions/${newSessionId}`)",
    'assert.equal(newSession.agentId, agent.id)',
    'the conversation inherits its provider from the selected Agent',
    'the conversation inherits the provider default model',
    'assert.equal(agent.providerId, provider.id)',
    'assert.equal(provider.defaultModelId, OPENAI_SMOKE_MODEL)',
    'the new reply uses the inherited provider model',
    'assert.deepEqual(originalAfter.session, retained.session',
    'assert.equal(newConversation.usage.fiveHour.consumed, 120)',
    'assert.equal(newConversation.usage.weekly.consumed, 120)',
    'assert.deepEqual(durableNew.session, newConversation.session',
    "assert.equal(fixture.requests.length, 7, 'startup does not replay either saved conversation')",
    'The model provider requires a billing or quota change (HTTP 429). Check credits, spending limits and account usage limits with the provider.',
    'assert.deepEqual(quotaAfter.usage, quotaBefore.usage,',
    'assert.deepEqual(quotaAfter.session.messages.slice(0, quotaBefore.session.messages.length), quotaBefore.session.messages,',
    'assert.equal(quotaAfter.session.messages.length, quotaBefore.session.messages.length + 2,',
    "assert.equal(quotaAfter.session.messages.at(-2)?.content, 'Check that a provider quota refusal is shown safely.')",
    '`*(${quotaAdvice} This turn will not be retried automatically.)*`',
    'await expect(page.getByText(OPENAI_SMOKE_PRIVATE_ERROR, { exact: false })).toHaveCount(0)',
    'assert.equal(fixture.requests.length, 8, \'quota refusal makes exactly one provider call\')',
    'assert.equal(fixture.requests.length, 9, \'positive Retry-After produces only the first provider request\')',
    "await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible({ timeout: TIMEOUT_MS })",
    'await expect.poll(() => fixture.retryWaitResponses, { timeout: TIMEOUT_MS }).toBe(1)',
    'await page.waitForTimeout(250)',
    'assert.equal(fixture.requests.length, 9, \'Stop aborts the active retry wait without replay\')',
    'assert.deepEqual(stopped.usage, quotaAfter.usage,',
    'assert.deepEqual(stopped.session.messages.slice(0, quotaAfter.session.messages.length), quotaAfter.session.messages,',
    'assert.equal(stopped.session.messages.length, quotaAfter.session.messages.length + 1,',
    "assert.equal(stopped.session.messages.at(-1)?.content, 'Stop while the provider retry delay is active.')",
    "'the pre-stream Stop has no partial assistant text or separate cancel receipt'",
    'assert.deepEqual(finalNew.session, stopped.session,',
    'assert.deepEqual(finalOriginal.usage, stopped.usage,',
    "assert.equal(fixture.requests.length, 9, 'final startup does not dispatch saved work')",
    'assertProviderTransport(fixture.requests)',
    "assert.equal(fixture.requests.length, 9, 'final startup does not dispatch saved work')\n    assertProviderTransport(fixture.requests)",
    'assertNoSecrets(retained.productJson)',
    'await close(run)',
    'await launch(executable, profile)',
  ]) assert.ok(smoke.includes(fragment), `packaged workflow retains ${fragment}`)
  assert.doesNotMatch(smoke, /_electron|use-mock-keychain|mock-keychain|store\.\w+\(/,
    'the workflow uses public routes and the ordinary process, not injected app authority')
}

test('Responses acceptance retains rendered setup, real tool continuation, refused rotation and a fresh post-relaunch turn', () => {
  const smoke = source('./openaiResponsesSmoke.mjs')
  assertWorkflow(smoke)
  for (const [from, to] of [
    ['assert.equal((await refused).status(), 400', 'assert.equal((await refused).status(), 200'],
    ['assert.deepEqual(after.session, before.session', 'void(after.session, before.session'],
    ['assertPhaseHistory(after.session.messages.at(-1), fixture.requests[5])', 'void(after.session.messages.at(-1), fixture.requests[5])'],
    ['assert.equal(fixture.requests.length, 4, \'one probe, the tool call, and two identical continuation attempts\')', 'assert.equal(fixture.requests.length, 3, \'one probe, the tool call, and two identical continuation attempts\')'],
    ['assert.deepEqual(failedContinuation, continuation,', 'void(failedContinuation, continuation,'],
    ['assert.deepEqual(quotaAfter.usage, quotaBefore.usage,', 'void(quotaAfter.usage, quotaBefore.usage,'],
    ['assert.deepEqual(quotaAfter.session.messages.slice(0, quotaBefore.session.messages.length), quotaBefore.session.messages,', 'void(quotaAfter.session.messages.slice(0, quotaBefore.session.messages.length), quotaBefore.session.messages,'],
    ['assert.equal(quotaAfter.session.messages.length, quotaBefore.session.messages.length + 2,', 'assert.equal(quotaAfter.session.messages.length, quotaBefore.session.messages.length + 1,'],
    ['assert.equal(fixture.requests.length, 9, \'Stop aborts the active retry wait without replay\')', 'assert.equal(fixture.requests.length, 10, \'Stop aborts the active retry wait without replay\')'],
    ["await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible({ timeout: TIMEOUT_MS })", "await expect(page.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0)"],
    ['assert.deepEqual(finalNew.session, stopped.session,', 'void(finalNew.session, stopped.session,'],
    ['assert.deepEqual(stopped.session.messages.slice(0, quotaAfter.session.messages.length), quotaAfter.session.messages,', 'void(stopped.session.messages.slice(0, quotaAfter.session.messages.length), quotaAfter.session.messages,'],
    ['assert.equal(stopped.session.messages.length, quotaAfter.session.messages.length + 1,', 'assert.equal(stopped.session.messages.length, quotaAfter.session.messages.length,'],
    ["assert.equal(fixture.requests.length, 9, 'final startup does not dispatch saved work')\n    assertProviderTransport(fixture.requests)", "assert.equal(fixture.requests.length, 9, 'final startup does not dispatch saved work')\n    void(fixture.requests)"],
    ['assert.equal(sessionCreationRequests.length, creationsBefore,', 'assert.equal(sessionCreationRequests.length, creationsBefore + 1,'],
    ['assert.equal(newSession.agentId, agent.id)', 'assert.equal(newSession.agentId, \'agent-default\')'],
    ['assert.equal(newConversation.usage.fiveHour.consumed, 120)', 'assert.equal(newConversation.usage.fiveHour.consumed, 90)'],
  ]) {
    assert.notEqual(smoke.replace(from, to), smoke)
    assert.throws(() => assertWorkflow(smoke.replace(from, to)), assert.AssertionError)
  }
})

test('packaged phase assertions reject flattening, lost phases and host receipt phase inheritance', () => {
  const assistantTextItems = [{ text: 'I will check usage. ', phase: 'commentary' }, { text: 'The packaged OpenAI tool round completed.', phase: 'final_answer' }]
  const message = { content: assistantTextItems.map(item => item.text).join(''), assistantTextItems }
  const request = { input: [...assistantTextItems.map(item => ({ role: 'assistant', content: item.text, phase: item.phase })),
    { role: 'assistant', content: 'External/tool receipt data\n[{"status":"done"}]' }, { role: 'user', content: 'Continue.' }] }
  assertPhaseHistory(message, request)
  assert.throws(() => assertPhaseHistory({ ...message, assistantTextItems: [{ text: message.content, phase: 'final_answer' }] }, request), assert.AssertionError)
  assert.throws(() => assertPhaseHistory(message, { input: request.input.map(({ phase, ...item }) => item) }), assert.AssertionError)
  const phasedReceipt = structuredClone(request)
  phasedReceipt.input[2].phase = 'final_answer'
  assert.throws(() => assertPhaseHistory(message, phasedReceipt), assert.AssertionError)
})

test('the read-only packaged SQLite observer resolves exact provider, session and tenant identities', () => {
  assert.equal(SLICE_KIND.providers, 'mapEntries')
  assert.equal(SLICE_KIND.providerConfigs, 'mapEntries')
  assert.equal(SLICE_KIND.sessions, 'array')
  assert.equal(SLICE_KIND.usageMeters, 'mapEntries')
  const profile = mkdtempSync(join(tmpdir(), 'openai-state-lock-'))
  const database = new DatabaseSync(join(profile, 'store.db'))
  database.exec('CREATE TABLE entities (slice TEXT, entity_id TEXT, json TEXT); CREATE TABLE map_entries (slice TEXT, key TEXT, json TEXT); CREATE TABLE kv (key TEXT, json TEXT); CREATE TABLE image_assets (image_json TEXT, original_json TEXT)')
  const provider = { id: 'provider-openai', connectionRevision: 3 }
  const session = { id: 'session-openai', messages: [{ role: 'assistant', content: 'Exact response' }] }
  const config = { protocol: 'openai-responses', apiKeyEnv: 'PROVIDER_FAKE_REF' }
  const usage = { fiveHour: { consumed: 60 }, weekly: { consumed: 60 } }
  database.prepare('INSERT INTO map_entries VALUES (?, ?, ?)').run('providers', provider.id, JSON.stringify(provider))
  database.prepare('INSERT INTO entities VALUES (?, ?, ?)').run('sessions', session.id, JSON.stringify(session))
  database.prepare('INSERT INTO map_entries VALUES (?, ?, ?)').run('providerConfigs', provider.id, JSON.stringify(config))
  database.prepare('INSERT INTO map_entries VALUES (?, ?, ?)').run('usageMeters', 'tenant-openai', JSON.stringify(usage))
  database.prepare('INSERT INTO kv VALUES (?, ?)').run('recents', '["singleton-scan-marker"]')
  database.prepare('INSERT INTO image_assets VALUES (?, ?)').run('{"marker":"image-scan-marker"}', '{"marker":"original-scan-marker"}')
  database.close()
  try {
    const state = readOpenAIState(profile, provider.id, session.id, 'tenant-openai')
    assert.deepEqual(state.provider, provider)
    assert.deepEqual(state.config, config)
    assert.deepEqual(state.session, session)
    assert.deepEqual(state.usage, usage)
    for (const marker of ['singleton-scan-marker', 'image-scan-marker', 'original-scan-marker']) {
      assert.ok(state.productJson.includes(marker), `secret scan includes ${marker}`)
    }
    const missing = readOpenAIState(profile, 'other-provider', 'other-session', 'other-tenant')
    for (const key of ['provider', 'config', 'session', 'usage']) assert.equal(missing[key], undefined, key)
  } finally { rmSync(profile, { recursive: true, force: true }) }
})

test('provider transport forbids body credentials and reasoning outside its exact continuation', () => {
  const clean = [{ input: [] }, { input: [] }, { input: [OPENAI_SMOKE_REASONING] }, { input: [OPENAI_SMOKE_REASONING] }, { input: [] }, { input: [] }, { input: [] }, { input: [] }, { input: [] }]
  assertProviderTransport(clean)
  for (const key of [OPENAI_SMOKE_KEY, OPENAI_SMOKE_REPLACEMENT_KEY]) {
    for (let at = 0; at < clean.length; at++) {
      const leaked = structuredClone(clean)
      Object.assign(leaked[at], { api_key: key })
      assert.throws(() => assertProviderTransport(leaked), assert.AssertionError)
    }
  }
  for (const at of [0, 1, 4, 5, 6, 7, 8]) {
    const replayed = structuredClone(clean)
    replayed[at].input.push(OPENAI_SMOKE_REASONING)
    assert.throws(() => assertProviderTransport(replayed), assert.AssertionError)
  }
  for (const at of [2, 3]) {
    for (const input of [[], [OPENAI_SMOKE_REASONING, OPENAI_SMOKE_REASONING]]) {
      const wrong = structuredClone(clean)
      wrong[at].input = input
      assert.throws(() => assertProviderTransport(wrong), assert.AssertionError)
    }
  }
  for (let at = 0; at < clean.length; at++) {
    const leaked = structuredClone(clean)
    Object.assign(leaked[at], { error: OPENAI_SMOKE_PRIVATE_ERROR })
    assert.throws(() => assertProviderTransport(leaked), assert.AssertionError)
  }
})
