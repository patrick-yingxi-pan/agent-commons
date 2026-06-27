/** Model providers (docs/agent-commons.md, D9) — the registered cognition source an
 *  Agent binds, and the provider plan as the **root** of the D8 budget cascade. The
 *  seeded default is the degenerate N=1 case wrapping the single implicit client. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../server/store.ts'
import { DEFAULT_PROVIDER, DEFAULT_PROVIDER_ID } from '../server/data/providers.ts'
import { BudgetError } from '../server/usage.ts'
import { call } from './helpers/http.ts'

test('the default provider is seeded and resolvable; unset/unknown falls back to it', () => {
  assert.ok(store.listProviders().some((p) => p.id === DEFAULT_PROVIDER_ID))
  assert.equal(store.getProvider().id, DEFAULT_PROVIDER_ID)
  assert.equal(store.getProvider('no-such-provider').id, DEFAULT_PROVIDER_ID)
  assert.equal(DEFAULT_PROVIDER.modelFamily, 'claude')
  assert.ok(DEFAULT_PROVIDER.effortLevels.length > 0)
})

test('the default provider declares no model — generation inherits the env default', () => {
  // `undefined` is the signal `generate.ts` uses its env-configured MODEL, keeping the
  // env override the single source for the default provider's model.
  assert.equal(store.providerModel(DEFAULT_PROVIDER_ID), undefined)
  assert.equal(store.providerModel(), undefined)
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

test('a provider config carries the model id (server-only), surfaced via providerModel', () => {
  const p = store.createProvider(
    { label: 'Custom model', modelFamily: 'claude', effortLevels: ['Medium'] },
    { model: 'claude-custom-test' },
  )
  assert.equal(store.providerModel(p.id), 'claude-custom-test')
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
