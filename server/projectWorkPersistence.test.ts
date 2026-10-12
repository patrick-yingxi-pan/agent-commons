import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createContributionEffectAttempt, settleContributionEffectAttempt } from './contributionEffectState.ts'
import { isLinkableProjectWorkItem, validProjectWorkPersistence } from './projectWorkPersistence.ts'

const workItem = (overrides: Record<string, unknown> = {}) => ({
  id: 'work-1', projectId: 'project-1', subGoal: 'Publish update', type: 'mcp.mutate', target: 'calendar-1',
  note: '', postedBy: 'Owner', postedAt: 1, status: 'open', ...overrides,
})

const attempt = (overrides: Record<string, unknown> = {}) => createContributionEffectAttempt({
  id: `contribution-effect-${'a'.repeat(24)}`, tenantId: 'tenant-1', projectId: 'project-1', contributionId: 'contribution-1',
  envelopeVersion: 2, lineId: 'line-1', actor: 'Owner', connectionLabel: 'Calendar',
  call: { connectionId: `mcp-connection-${'b'.repeat(32)}`, connectionRevision: 1, toolName: 'create_event',
    schemaHash: 'c'.repeat(64), arguments: { title: 'Update' } }, startedAt: 10, ...overrides,
})

const done = (overrides: Record<string, unknown> = {}) => settleContributionEffectAttempt(attempt(overrides), {
  status: 'done', result: { resultType: 'complete', content: [{ type: 'text', text: 'Created' }], isError: false },
}, 11)

const envelope = (overrides: Record<string, unknown> = {}) => ({
  version: 2, status: 'approved', approvedBy: 'Owner', approvedAt: 2, approvedVersion: 2,
  proposedBy: 'Owner', proposedAt: 1,
  lines: [{ id: 'line-1', type: 'mcp.mutate', target: 'calendar-1', cardinality: 1, harness: 'explicit-call', note: '', used: 1 }],
  ...overrides,
})

const contribution = (overrides: Record<string, unknown> = {}) => ({
  id: 'contribution-1', projectId: 'project-1', title: 'Update calendar', summary: '', subGoal: 'Publish update',
  workItemId: 'work-1', contributor: 'Contributor', status: 'open', openedAt: 1, events: [],
  envelope: envelope(), effectAttempts: [done()], effectsFired: true, ...overrides,
})

const stateIsValid = (contributions: unknown[], items: unknown[]) => validProjectWorkPersistence(contributions, items)

test('new linked work admission guarantees text accepted by strict persistence', () => {
  assert.equal(isLinkableProjectWorkItem(workItem()), true)
  assert.equal(isLinkableProjectWorkItem(workItem({ target: `bad\ud800` })), false, 'unpaired surrogate target cannot create a non-roundtrippable link')
  assert.equal(isLinkableProjectWorkItem(workItem({ subGoal: `bad\udc00` })), false, 'unpaired surrogate sub-goal cannot create a non-roundtrippable link')
  assert.equal(isLinkableProjectWorkItem(workItem({ type: 'mcp.query' })), false)
  assert.equal(isLinkableProjectWorkItem(null), false)
})

test('legacy absence and multiple open linked Contributions remain valid', () => {
  assert.equal(validProjectWorkPersistence(undefined, undefined), true)
  const legacyContribution = { id: 'contribution-legacy', projectId: 'project-1', status: 'open', events: [] }
  assert.equal(stateIsValid([legacyContribution], []), true)
  assert.equal(stateIsValid([
    contribution({ status: 'open', effectAttempts: undefined, envelope: undefined }),
    contribution({ id: 'contribution-2', status: 'open', effectAttempts: undefined, envelope: undefined }),
  ], [workItem()]), true)
  assert.equal(stateIsValid([contribution({ status: 'open', effectAttempts: undefined, envelope: undefined })], [workItem({ status: 'done' })]), true)
  assert.equal(stateIsValid([contribution({ status: 'open', effectAttempts: undefined, envelope: undefined })], [workItem({ status: 'retracted' })]), true)
})

test('a linked open Contribution must retain its event array for safe projection', () => {
  const linked = contribution({ envelope: undefined, effectAttempts: undefined })
  delete (linked as Record<string, unknown>).events
  assert.equal(stateIsValid([linked], [workItem()]), false)
})

test('linked ids are bounded exact-trim ids and joins require one same-project MCP-mutation item', () => {
  for (const workItemId of ['', ' work-1', 'work-1 ', 'work\u0000-1', 'x'.repeat(201)]) {
    assert.equal(stateIsValid([contribution({ workItemId, envelope: undefined, effectAttempts: undefined })], [workItem()]), false, String(workItemId))
  }
  assert.equal(stateIsValid([contribution({ envelope: undefined, effectAttempts: undefined })], []), false, 'missing item')
  assert.equal(stateIsValid([contribution({ envelope: undefined, effectAttempts: undefined })], [workItem(), workItem()]), false, 'duplicate item identity')
  assert.equal(stateIsValid([contribution({ envelope: undefined, effectAttempts: undefined })], [workItem({ projectId: 'project-2' })]), false, 'cross-project link')
  assert.equal(stateIsValid([contribution({ envelope: undefined, effectAttempts: undefined })], [workItem({ type: 'mcp.query' })]), false, 'unsupported effect type')
  assert.equal(stateIsValid([contribution({ envelope: undefined, effectAttempts: undefined, subGoal: 'Different label' })], [workItem()]), false, 'sub-goal must match')
  assert.equal(stateIsValid([contribution({ envelope: undefined, effectAttempts: undefined, workItemResolution: 'ready' })], [workItem()]), false, 'computed projection is never persisted')
})

test('resolution is closed-shape and backed by exact landed user action and current successful result', () => {
  const result = done()
  const linked = contribution({
    status: 'landed', landedAt: 20, landedBy: 'Owner', landedByTenant: 'tenant-owner',
    events: [{ id: 'land-event', kind: 'landed', at: 20, actor: 'Owner', principal: { kind: 'user', id: 'user-owner' } }],
    effectAttempts: [result],
  })
  const resolvedItem = workItem({ status: 'done', resolvedAt: 20, contributionResolution: {
    contributionId: 'contribution-1', effectId: result.id, by: 'Owner',
  } })
  assert.equal(stateIsValid([linked], [resolvedItem]), true)
  assert.equal(stateIsValid([linked], [workItem()]), false, 'landed link needs the matching work-item resolution')
  assert.equal(stateIsValid([linked], [workItem({ status: 'done', resolvedAt: 20, contributionResolution: {
    contributionId: 'contribution-1', effectId: 'different-effect', by: 'Owner',
  } })]), false, 'wrong effect receipt')
  assert.equal(stateIsValid([linked], [workItem({ status: 'done', resolvedAt: 21, contributionResolution: {
    contributionId: 'contribution-1', effectId: result.id, by: 'Owner',
  } })]), false, 'resolvedAt must equal landedAt')
  assert.equal(stateIsValid([linked], [workItem({ status: 'done', resolvedAt: 20, resolvedBy: 'Agent', contributionResolution: {
    contributionId: 'contribution-1', effectId: result.id, by: 'Owner',
  } })]), false, 'human resolution cannot claim Commission credit')
  assert.equal(stateIsValid([contribution({ ...linked, events: [{ id: 'land-event', kind: 'landed', at: 20, actor: 'Owner', principal: { kind: 'agent', id: 'agent-1' } }] })], [resolvedItem]), false, 'requires a user landed event')
  assert.equal(stateIsValid([contribution({ ...linked, landedByTenant: undefined })], [resolvedItem]), false, 'requires raw landing tenant')
})

test('direct persistence admission fails closed without throwing on malformed linked nested state', () => {
  const result = done()
  const linked = contribution({
    status: 'landed', landedAt: 20, landedBy: 'Owner', landedByTenant: 'tenant-owner',
    events: [{ id: 'land-event', kind: 'landed', at: 20, actor: 'Owner', principal: { kind: 'user', id: 'user-owner' } }],
    effectAttempts: [result],
  })
  const resolvedItem = workItem({ status: 'done', resolvedAt: 20, contributionResolution: {
    contributionId: 'contribution-1', effectId: result.id, by: 'Owner',
  } })
  const malformed = [
    { ...linked, envelope: { ...linked.envelope, lines: null } },
    { ...linked, envelope: { ...linked.envelope, lines: {} } },
    { ...linked, effects: [] },
    { ...linked, effectAttempts: [null] },
    { ...linked, events: [...linked.events, { id: 'approval', kind: 'envelope-approved', envelopeVersion: '2' }] },
  ]
  for (const candidate of malformed) {
    assert.doesNotThrow(() => validProjectWorkPersistence([candidate], [resolvedItem]))
    assert.equal(validProjectWorkPersistence([candidate], [resolvedItem]), false)
  }
})

test('multiple linked open rows are allowed, but the one landed row must uniquely win the resolution', () => {
  const openOther = contribution({ id: 'contribution-2', status: 'open', envelope: undefined, effectAttempts: undefined })
  const result = done()
  const landed = contribution({ status: 'landed', landedAt: 20, landedBy: 'Owner', landedByTenant: 'tenant-owner',
    events: [{ id: 'land-event', kind: 'landed', at: 20, actor: 'Owner', principal: { kind: 'user', id: 'user-owner' } }], effectAttempts: [result] })
  const resolvedItem = workItem({ status: 'done', resolvedAt: 20, contributionResolution: {
    contributionId: 'contribution-1', effectId: result.id, by: 'Owner',
  } })
  assert.equal(stateIsValid([openOther, landed], [resolvedItem]), true)
  assert.equal(stateIsValid([landed, contribution({ ...openOther, status: 'landed', landedAt: 20, landedBy: 'Owner', landedByTenant: 'tenant-owner',
    events: [{ id: 'land-event-2', kind: 'landed', at: 20, actor: 'Owner', principal: { kind: 'user', id: 'user-owner' } }], effectAttempts: [done({ id: `contribution-effect-${'d'.repeat(24)}`, contributionId: 'contribution-2' })] })], [resolvedItem]), false)
})
