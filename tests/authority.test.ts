/** Authority attenuation (docs/agent-commons.md, D8 — the primary face). The cascade
 *  over tools / connectors / scopes: provider ⊇ agent, enforced at the createAgent
 *  funnel so an over-grant is unrepresentable at mint. Authority is where the security
 *  lives; the token budget (budget.test.ts) is the quota special-case. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../server/store.ts'
import { overAuthority, clampAuthority } from '../contract/index.ts'
import { mintAuthority, AuthorityError } from '../server/authority.ts'
import { DEFAULT_PROVIDER } from '../server/data/providers.ts'

test('overAuthority: a child within the parent (or absent / unrestricted parent) is clean', () => {
  // Unrestricted parent ('*') admits anything.
  assert.equal(overAuthority({ tools: ['*'] }, { tools: ['read', 'write'] }), null)
  // Absent parent dimension = unrestricted there.
  assert.equal(overAuthority({}, { connectors: ['gmail'] }), null)
  // Concrete subset.
  assert.equal(overAuthority({ tools: ['read', 'write'] }, { tools: ['read'] }), null)
  // Empty child claims nothing — the tightest grant.
  assert.equal(overAuthority({ tools: ['read'] }, { tools: [] }), null)
  // A child that makes no claim on a restricted dimension inherits it (no violation).
  assert.equal(overAuthority({ tools: ['read'] }, { connectors: ['*'] }), null)
})

test('overAuthority: a child exceeding a restricted parent violates, naming the dimension', () => {
  // A value the parent doesn't hold.
  assert.deepEqual(overAuthority({ tools: ['read', 'write'] }, { tools: ['read', 'exec'] }), {
    dimension: 'tools',
    values: ['exec'],
  })
  // Claiming '*' under a restricted parent is an escalation.
  assert.deepEqual(overAuthority({ connectors: ['gmail'] }, { connectors: ['*'] }), {
    dimension: 'connectors',
    values: ['*'],
  })
})

test('mintAuthority returns a valid grant, throws AuthorityError on an over-grant', () => {
  const ok = mintAuthority({ tools: ['read', 'write'] }, { tools: ['read'] })
  assert.deepEqual(ok, { tools: ['read'] })
  assert.throws(() => mintAuthority({ tools: ['read'] }, { tools: ['read', 'write'] }), AuthorityError)
  // An absent (unrestricted) parent never rejects.
  assert.doesNotThrow(() => mintAuthority(undefined, { tools: ['anything'] }))
})

test('the default provider grants everything — the seeded Agent is a valid attenuation', () => {
  assert.equal(overAuthority(DEFAULT_PROVIDER.authority!, { tools: ['read', 'write', 'exec'] }), null)
  assert.equal(overAuthority(DEFAULT_PROVIDER.authority!, { connectors: ['*'], scopes: ['*'] }), null)
})

test('createAgent enforces agent authority ⊆ provider authority at the funnel', () => {
  // A provider restricted to two tools and one connector.
  const provider = store.createProvider({
    label: 'Restricted provider',
    modelFamily: 'claude',
    effortLevels: ['Low'],
    authority: { tools: ['read', 'summarize'], connectors: ['github'] },
  })
  // An Agent claiming a tool the provider never granted is rejected at mint.
  assert.throws(
    () =>
      store.createAgent({
        label: 'Over-tooled',
        systemPrompt: 'p',
        tools: [],
        instructions: '',
        providerId: provider.id,
        authority: { tools: ['read', 'delete'] },
      }),
    AuthorityError,
  )
  // A subset grant mints fine and is stored.
  const ok = store.createAgent({
    label: 'Within authority',
    systemPrompt: 'p',
    tools: [],
    instructions: '',
    providerId: provider.id,
    authority: { tools: ['read'], connectors: ['github'] },
  })
  assert.deepEqual(ok.authority, { tools: ['read'], connectors: ['github'] })
})

test('clampAuthority tightens only explicit dims a narrowed parent no longer admits (D8 runtime)', () => {
  // Explicit child, parent narrowed → dropped values removed.
  assert.deepEqual(clampAuthority({ tools: ['a', 'b', 'c'] }, { tools: ['a', 'c'] }).tools, ['a', 'c'])
  // Child already ⊆ parent → unchanged.
  assert.deepEqual(clampAuthority({ tools: ['a'] }, { tools: ['a', 'b'] }).tools, ['a'])
  // An inherited (unset) dim follows the parent — left alone, never materialized onto the child.
  assert.equal(clampAuthority({ connectors: ['X'] }, { connectors: ['X'], tools: ['a'] }).tools, undefined)
  // A '*' dim is unrestricted → inherits, untouched.
  assert.deepEqual(clampAuthority({ tools: ['*'] }, { tools: ['a'] }).tools, ['*'])
  // An unrestricted parent admits everything → child unchanged.
  assert.deepEqual(clampAuthority({ connectors: ['X', 'Y'] }, {}).connectors, ['X', 'Y'])
})
