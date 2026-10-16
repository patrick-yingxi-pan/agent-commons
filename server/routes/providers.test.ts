/** Model providers (docs/agent-commons.md, D9) — the registered cognition source an
 *  Agent binds, and the provider plan as the **root** of the D8 budget cascade. The
 *  seeded default is the degenerate N=1 case wrapping the single implicit client. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../store/index.ts'
import { DEFAULT_PROVIDER, DEFAULT_PROVIDER_ID, ProviderProbeError } from '../data/providers.ts'
import { BudgetError } from '../usage.ts'
import { call } from '../testkit/http.ts'

test('the default provider is seeded and resolvable; unset/unknown falls back to it', () => {
  assert.ok(store.listProviders().some((p) => p.id === DEFAULT_PROVIDER_ID))
  assert.equal(store.getProvider().id, DEFAULT_PROVIDER_ID)
  assert.equal(store.getProvider('no-such-provider').id, DEFAULT_PROVIDER_ID)
  assert.equal(DEFAULT_PROVIDER.modelFamily, 'claude')
  assert.ok(DEFAULT_PROVIDER.effortLevels.length > 0)
})

test('the default provider declares no endpoint or model — generation inherits the env defaults', () => {
  // An all-unset config is the signal `generate.ts` uses its env-configured endpoint +
  // MODEL, keeping the env overrides the single source for the default provider.
  assert.equal(store.providerConfig(DEFAULT_PROVIDER_ID).model, undefined)
  assert.equal(store.providerConfig().model, undefined)
  assert.equal(store.providerConfig().baseURL, undefined)
})

test('createProvider mints a within-account-plan provider, rejects an over-plan one', () => {
  const ok = store.createProvider({
    label: 'Tight tier',
    modelFamily: 'claude',
    effortLevels: ['Low'],
    plan: { windows: [{ label: '5-hour limit', ceiling: 200_000 }] },
  })
  assert.ok(ok.id.startsWith('provider-'))
  assert.ok(store.listProviders().some((p) => p.id === ok.id))
  // The provider plan must attenuate the account plan — the cascade root can't exceed
  // the subscription it sits under.
  assert.throws(
    () =>
      store.createProvider({
        label: 'Greedy tier',
        modelFamily: 'claude',
        effortLevels: ['High'],
        plan: { windows: [{ label: '5-hour limit', ceiling: 99_000_000 }] },
      }),
    BudgetError,
  )
})

test('a provider config carries the model id (server-only), surfaced via providerConfig', () => {
  const p = store.createProvider(
    { label: 'Custom model', modelFamily: 'claude', effortLevels: ['Medium'] },
    { model: 'claude-custom-test' },
  )
  assert.equal(store.providerConfig(p.id).model, 'claude-custom-test')
})

test('endpoint protocol stays in server config and is projected from config with connection ordering', () => {
  const p = store.createProvider(
    { label: 'Responses protocol', modelFamily: 'gpt', effortLevels: ['Low'] },
    {
      protocol: 'openai-responses',
      baseURL: 'https://api.openai.com/v1',
      model: 'gpt-5.1',
      capabilities: { toolUse: true },
    },
  )
  assert.equal(store.providerConfig(p.id).protocol, 'openai-responses')
  const onWire = store.listProviders().find((row) => row.id === p.id)!
  assert.equal(onWire.protocol, 'openai-responses', 'the safe protocol is derived from server config')
  assert.equal(onWire.baseURL, undefined)
  assert.equal(onWire.model, undefined)
  assert.equal(onWire.apiKeyEnv, undefined)

  const replaced = store.replaceProviderConnection(
    p.id,
    { protocol: 'anthropic-messages', baseURL: 'https://api.anthropic.com/v1', model: 'claude-sonnet', capabilities: { toolUse: true } },
    null,
    0,
  )
  assert.equal(replaced?.connectionRevision, 1, 'switching protocols advances connection ordering')
  assert.equal(store.providerConfig(p.id).protocol, 'anthropic-messages')
  assert.equal(store.listProviders().find((row) => row.id === p.id)?.protocol, 'anthropic-messages')
})

test('the mint funnel rejects unknown protocols and incomplete OpenAI Responses configs', () => {
  assert.throws(
    () => store.createProvider(
      { label: 'Unknown protocol', modelFamily: 'custom', effortLevels: [] },
      { protocol: 'openai-chat-completions' as any },
    ),
    ProviderProbeError,
  )
  assert.throws(
    () => store.createProvider(
      { label: 'Incomplete Responses', modelFamily: 'gpt', effortLevels: [] },
      { protocol: 'openai-responses', model: 'gpt-5.1' },
    ),
    ProviderProbeError,
  )
})

test('the mint funnel refuses a config that brings an endpoint without a probed record', () => {
  // The invariant mirrors the D8 over-grant: an *unverified* endpoint is
  // unrepresentable in the registry. The route satisfies it by running
  // `probeProviderEndpoint` and stamping `capabilities` before the mint.
  assert.throws(
    () =>
      store.createProvider(
        { label: 'Unprobed endpoint', modelFamily: 'open', effortLevels: ['Low'] },
        { baseURL: 'http://127.0.0.1:9', model: 'anything' },
      ),
    ProviderProbeError,
  )
  // The same endpoint config carrying its probe record mints fine, and the whole
  // config — endpoint, credential *reference*, capabilities — survives server-side.
  const p = store.createProvider(
    { label: 'Probed endpoint', modelFamily: 'open', effortLevels: ['Low'] },
    { baseURL: 'http://127.0.0.1:9', apiKeyEnv: 'PROVIDER_PROBED_KEY', model: 'anything', capabilities: { toolUse: false } },
  )
  const config = store.providerConfig(p.id)
  assert.equal(config.baseURL, 'http://127.0.0.1:9')
  assert.equal(config.apiKeyEnv, 'PROVIDER_PROBED_KEY')
  assert.deepEqual(config.capabilities, { toolUse: false })
  // And none of the server-only endpoint half leaks onto the contract read type.
  const onWire = store.listProviders().find((x) => x.id === p.id) as Record<string, unknown>
  assert.equal(onWire.baseURL, undefined)
  assert.equal(onWire.apiKeyEnv, undefined)
  assert.equal(onWire.config, undefined)
})

test('the mint funnel refuses a credential reference outside the PROVIDER_ prefix', () => {
  // The exfiltration wall: the reference and the endpoint are both caller-supplied,
  // so an unconstrained reference could point any server secret (ANTHROPIC_API_KEY,
  // cloud credentials, …) at an arbitrary URL. Only PROVIDER_* vars may be referenced.
  assert.throws(
    () =>
      store.createProvider(
        { label: 'Exfil attempt', modelFamily: 'open', effortLevels: ['Low'] },
        { apiKeyEnv: 'ANTHROPIC_API_KEY' },
      ),
    ProviderProbeError,
  )
})

test('createAgent validates the budget against its provider plan, not just the account', () => {
  // A tight provider whose plan is well under the account ceiling.
  const provider = store.createProvider({
    label: 'Capped provider',
    modelFamily: 'claude',
    effortLevels: ['Low'],
    plan: { windows: [{ label: '5-hour limit', ceiling: 300_000 }] },
  })
  // An Agent budget within the *account* plan but over its *provider* plan is rejected:
  // the cascade root is the provider (D9), so agent ⊆ provider must hold.
  assert.throws(
    () =>
      store.createAgent({
        label: 'Over the provider',
        systemPrompt: 'p',
        tools: [],
        instructions: '',
        providerId: provider.id,
        budget: { windows: [{ label: '5-hour limit', ceiling: 500_000 }] },
      }),
    BudgetError,
  )
  // The same budget is fine under a provider that inherits the (larger) account plan.
  const ok = store.createAgent({
    label: 'Under the account plan',
    systemPrompt: 'p',
    tools: [],
    instructions: '',
    budget: { windows: [{ label: '5-hour limit', ceiling: 500_000 }] },
  })
  assert.equal(ok.budget?.windows[0].ceiling, 500_000)
})

test('GET /providers returns the registry; an unknown id 404s with the envelope', async () => {
  const list = await call('GET', '/providers')
  assert.equal(list.status, 200)
  assert.ok(Array.isArray(list.json))
  assert.ok(list.json.some((p: any) => p.id === DEFAULT_PROVIDER_ID))

  const one = await call('GET', `/providers/${DEFAULT_PROVIDER_ID}`)
  assert.equal(one.status, 200)
  assert.equal(one.json.id, DEFAULT_PROVIDER_ID)

  const missing = await call('GET', '/providers/nope')
  assert.equal(missing.status, 404)
  assert.equal(missing.json.error.code, 'not_found')
})
