import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { SLICE_KIND } from '../server/persistence/format.ts'
import { ignoreFromPackage } from './packager.config.mjs'
import { assertProviderTransport, readOpenAIState } from './openaiResponsesSmoke.mjs'
import { OPENAI_SMOKE_KEY, OPENAI_SMOKE_REPLACEMENT_KEY, OPENAI_SMOKE_REASONING } from './openaiResponsesSmokeFixture.mjs'

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
  for (const stage of ['rendered-secure-setup', 'agent-dispatch-tool-round', 'rejected-key-replacement', 'full-relaunch-and-restored-key']) {
    const at = smoke.indexOf(`stage = '${stage}'`)
    assert.ok(at > previous, `real packaged ${stage} remains in order`)
    previous = at
  }
  for (const fragment of [
    "getByRole('combobox', { name: /^Provider preset/ }).selectOption('openai')",
    "getByRole('combobox', { name: 'Agent', exact: true }).selectOption(agent.id)",
    "getByRole('button', { name: 'Dispatch', exact: true }).click()",
    'assert.deepEqual(continuation.input.find(item => item.id === OPENAI_SMOKE_REASONING.id), OPENAI_SMOKE_REASONING',
    'assert.equal(JSON.parse(output.output).status, 200',
    'assert.equal((await refused).status(), 400',
    'assert.deepEqual(rejected.config, before.config',
    'assert.deepEqual(after.session, before.session',
    'assert.deepEqual(after.usage, before.usage',
    'assert.equal(fixture.requests.length, 5',
    'assert.equal(retained.usage.fiveHour.consumed, 90)',
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
    ['assert.equal(fixture.requests.length, 5', 'assert.equal(fixture.requests.length, 4'],
  ]) {
    assert.notEqual(smoke.replace(from, to), smoke)
    assert.throws(() => assertWorkflow(smoke.replace(from, to)), assert.AssertionError)
  }
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
  const clean = [{ input: [] }, { input: [] }, { input: [OPENAI_SMOKE_REASONING] }, { input: [] }, { input: [] }]
  assertProviderTransport(clean)
  for (const key of [OPENAI_SMOKE_KEY, OPENAI_SMOKE_REPLACEMENT_KEY]) {
    for (let at = 0; at < clean.length; at++) {
      const leaked = structuredClone(clean)
      Object.assign(leaked[at], { api_key: key })
      assert.throws(() => assertProviderTransport(leaked), assert.AssertionError)
    }
  }
  for (const at of [0, 1, 3, 4]) {
    const replayed = structuredClone(clean)
    replayed[at].input.push(OPENAI_SMOKE_REASONING)
    assert.throws(() => assertProviderTransport(replayed), assert.AssertionError)
  }
  for (const input of [[], [OPENAI_SMOKE_REASONING, OPENAI_SMOKE_REASONING]]) {
    const wrong = structuredClone(clean)
    wrong[2].input = input
    assert.throws(() => assertProviderTransport(wrong), assert.AssertionError)
  }
})
