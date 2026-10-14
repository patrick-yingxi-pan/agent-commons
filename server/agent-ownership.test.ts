import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AgentOwnershipRegistry, MAX_AGENT_OWNERSHIP_ROWS, parseAgentOwnership, validateAgentOwnershipJoins } from './agentOwnership.ts'
import { agentCreationId } from './agentCreationIdentity.ts'

const owner = { agentId: 'agent-example', tenantId: 'tenant-one', ownerUserId: 'person-one' }
const source = () => ({
  agents: [[owner.agentId, { id: owner.agentId, tenantId: owner.tenantId }]],
  accountUsers: [[owner.ownerUserId, { id: owner.ownerUserId }]],
  accountTenants: [[owner.tenantId, { id: owner.tenantId }]],
  retiredAgentCreationIds: [],
})

test('private ownership admission is closed, bounded, detached and getter-free; legacy absence invents nobody', () => {
  assert.deepEqual(parseAgentOwnership(undefined), [])
  assert.deepEqual(parseAgentOwnership([]), [])
  assert.deepEqual(parseAgentOwnership([owner]), [owner])
  const copy = parseAgentOwnership([owner])
  copy[0].tenantId = 'changed'
  assert.equal(owner.tenantId, 'tenant-one')
  for (const invalid of [null, {}, [null], [owner, owner], [{ ...owner, retired: false }],
    [{ ...owner, unknown: 'secret' }], [{ ...owner, ownerUserId: '' }], [{ ...owner, tenantId: 'a'.repeat(201) }],
    [{ ...owner, agentId: '\ninvalid' }], Array(MAX_AGENT_OWNERSHIP_ROWS + 1).fill(owner),
    [Object.assign(Object.create({ inherited: true }), owner)],
  ]) assert.throws(() => parseAgentOwnership(invalid))
  for (const key of ['agentId', 'tenantId', 'ownerUserId']) {
    const incomplete = { ...owner }
    delete incomplete[key]
    assert.throws(() => parseAgentOwnership([incomplete]))
  }
  let touched = false
  const accessor = { ...owner }
  Object.defineProperty(accessor, 'ownerUserId', { enumerable: true, get() { touched = true; return 'person-one' } })
  assert.throws(() => parseAgentOwnership([accessor]))
  assert.equal(touched, false)
})

test('binding is immutable, retired identities cannot be reused, and failed replacement preserves current truth', () => {
  const registry = new AgentOwnershipRegistry()
  assert.equal(registry.get(owner.agentId), undefined)
  registry.prepare(owner)
  assert.equal(registry.get(owner.agentId), undefined, 'preflight is not mutation')
  registry.bind(owner)
  assert.throws(() => registry.bind({ ...owner, ownerUserId: 'person-two' }))
  assert.throws(() => registry.bind(owner), 'replay belongs to the represented Agent, never rebinding')
  registry.get(owner.agentId).ownerUserId = 'changed'
  registry.snapshot()[0].tenantId = 'changed'
  assert.deepEqual(registry.get(owner.agentId), owner)
  assert.throws(() => registry.rehydrate([owner, owner]))
  assert.deepEqual(registry.get(owner.agentId), owner)
  registry.retire(owner.agentId)
  registry.retire(owner.agentId)
  assert.deepEqual(registry.snapshot(), [{ ...owner, retired: true }])
  assert.throws(() => registry.bind(owner))
  const restored = new AgentOwnershipRegistry()
  restored.rehydrate(registry.snapshot())
  assert.deepEqual(restored.snapshot(), registry.snapshot())
  assert.throws(() => restored.bind(owner))
  restored.rehydrate(undefined)
  assert.deepEqual(restored.snapshot(), [], 'legacy reload replaces, never inherits runtime bindings')
})

test('saved ownership joins exact Agent/person/tenant identities, not current membership or guessed seed ownership', () => {
  const valid = source()
  assert.equal(validateAgentOwnershipJoins([owner], valid), true)
  assert.equal(validateAgentOwnershipJoins([], {}), true)
  for (const mutate of [
    value => { value.agents = [] },
    value => { value.agents[0][1].tenantId = 'other-tenant' },
    value => { delete value.agents[0][1].tenantId },
    value => { value.accountUsers = [] },
    value => { value.accountTenants = [] },
    value => { value.retiredAgentCreationIds = [owner.agentId] },
  ]) {
    const bad = structuredClone(valid)
    mutate(bad)
    assert.equal(validateAgentOwnershipJoins([owner], bad), false)
  }
  for (const key of ['agents', 'accountUsers', 'accountTenants']) {
    const duplicate = structuredClone(valid)
    duplicate[key].push(duplicate[key][0])
    assert.throws(() => validateAgentOwnershipJoins([owner], duplicate), `${key} duplicate cannot be collapsed`)
    const mismatched = structuredClone(valid)
    mismatched[key][0][0] = 'wrong-map-key'
    assert.throws(() => validateAgentOwnershipJoins([owner], mismatched), `${key} key must match row identity`)
  }
  const deactivated = structuredClone(valid)
  deactivated.accountUsers[0][1].deactivated = true
  assert.equal(validateAgentOwnershipJoins([owner], deactivated), true, 'historical identity is not current permission')
})

test('retirement requires absence of the exact live Agent and retains keyed deletion joins', () => {
  const valid = source()
  const retired = { ...owner, retired: true }
  assert.equal(validateAgentOwnershipJoins([retired], valid), false)
  valid.agents = []
  assert.equal(validateAgentOwnershipJoins([retired], valid), true)
  const keyed = { ...retired, agentId: agentCreationId(owner.tenantId, 'retirement') }
  assert.equal(validateAgentOwnershipJoins([keyed], valid), false)
  valid.retiredAgentCreationIds = [keyed.agentId]
  assert.equal(validateAgentOwnershipJoins([keyed], valid), true)
})
