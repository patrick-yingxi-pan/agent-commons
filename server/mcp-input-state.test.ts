import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import type { ToolActivity } from '../contract/entities.ts'
import { mcpInputBindingHash, mcpInputCommandHash, mcpInputFlowKey, parseMcpInputFlows, validateMcpInputFlows } from './mcpInputState.ts'

const decisionId = 'tool-activity-decision-0123456789abcdef01234567'
const form = {
  resultType: 'input_required',
  inputRequests: {
    profile: {
      method: 'elicitation/create',
      params: { mode: 'form', message: 'Choose a value', requestedSchema: { type: 'object', properties: { name: { type: 'string' } } } },
    },
  },
}
const activity = (status: string): ToolActivity => ({
  id: 'activity-1', tool: 'mcp__example__write', connector: 'Example', connectorId: 'mcp-connection-example',
  kind: 'action', status: status as ToolActivity['status'], decisionId,
  mcp: { connectionRevision: 2, toolName: 'write', schemaHash: 'a'.repeat(64) },
  input: { document: 'draft' }, summary: 'Reviewed action',
})
const session = (toolActivity: ToolActivity) => ({
  id: 'session-1', tenantId: 'tenant-1', messages: [{ id: 'message-1', toolActivities: [toolActivity] }],
})
const flow = (toolActivity: ToolActivity, overrides: Record<string, unknown> = {}) => ({
  sessionId: 'session-1', activityId: toolActivity.id, decisionId, tenantId: 'tenant-1', ownerUserId: 'user-1',
  bindingHash: mcpInputBindingHash(toolActivity), createdAt: 1_000, expiresAt: 3_601_000,
  round: 1, pending: form, receipts: [], ...overrides,
})

test('private flow parser is legacy tolerant, exact, detached, and retains only receipt hashes', () => {
  assert.deepEqual(parseMcpInputFlows(undefined), [])
  const source = flow(activity('awaiting-input'))
  const parsed = parseMcpInputFlows([source])
  assert.equal(parsed[0]?.pending.inputRequests.profile?.params.message, 'Choose a value')
  const receipt = { responseId: randomUUID(), payloadHash: 'b'.repeat(64), round: 1, action: 'respond' }
  const reserved = parseMcpInputFlows([flow(activity('running'), { pending: undefined, receipts: [receipt] })])
  assert.deepEqual(reserved[0]?.receipts, [receipt])
  assert.equal(Object.hasOwn(reserved[0]!.receipts[0]!, 'responses'), false)
  ;(source.pending as any).inputRequests.profile.params.message = 'mutated'
  assert.equal(parsed[0]?.pending.inputRequests.profile?.params.message, 'Choose a value')
  assert.equal(mcpInputFlowKey('s', 'd'), '["s","d"]')
})

test('flow parser rejects extra fields, duplicate identities, malformed receipts, impossible round state, and oversized slices', () => {
  const base = flow(activity('awaiting-input'))
  assert.throws(() => parseMcpInputFlows([{ ...base, answer: { name: 'private' } }]))
  assert.throws(() => parseMcpInputFlows([base, base]))
  assert.equal(parseMcpInputFlows([flow(activity('running'), { round: 0, pending: undefined })])[0]?.round, 0)
  assert.throws(() => parseMcpInputFlows([flow(activity('awaiting-input'), { receipts: [{ responseId: randomUUID(), payloadHash: 'a'.repeat(64), round: 2, action: 'respond' }] })]))
  assert.throws(() => parseMcpInputFlows([flow(activity('awaiting-input'), { receipts: [{ responseId: 'not-uuid', payloadHash: 'a'.repeat(64), round: 1, action: 'respond' }] })]))
  assert.throws(() => parseMcpInputFlows(Array(100_001).fill(base)))
})

test('canonical command and binding hashes are key-order stable and bind original arguments', () => {
  assert.equal(mcpInputCommandHash({ b: 2, a: 1 }), mcpInputCommandHash({ a: 1, b: 2 }))
  const original = activity('awaiting-input')
  assert.notEqual(mcpInputBindingHash(original), mcpInputBindingHash({ ...original, input: { document: 'other' } }))
  assert.notEqual(mcpInputBindingHash(original), mcpInputBindingHash({ ...original, mcp: { ...original.mcp!, connectionRevision: 3 } }))
})

test('flow joins the exact live or compacted external MCP action and requires private pending form', () => {
  const pendingActivity = activity('awaiting-input')
  const pendingFlow = parseMcpInputFlows([flow(pendingActivity)])
  assert.equal(validateMcpInputFlows(pendingFlow, [session(pendingActivity)]), true)
  assert.equal(validateMcpInputFlows([], [session(pendingActivity)]), false)
  const initialActivity = activity('running')
  assert.equal(validateMcpInputFlows(parseMcpInputFlows([flow(initialActivity, { round: 0, pending: undefined })]), [session(initialActivity)]), true)
  assert.equal(validateMcpInputFlows(parseMcpInputFlows([flow(initialActivity, { pending: undefined })]), [session(initialActivity)]), false)

  const completedActivity = activity('done')
  const completedFlow = parseMcpInputFlows([flow(completedActivity, { round: 1, pending: undefined })])
  const archived = { id: 'session-1', tenantId: 'tenant-1', messages: [], compactedMessages: [{ id: 'old', toolActivities: [completedActivity] }] }
  assert.equal(validateMcpInputFlows(completedFlow, [archived]), true)
  assert.equal(validateMcpInputFlows(completedFlow, [session({ ...completedActivity, input: { document: 'changed' } })]), false)
  assert.equal(validateMcpInputFlows(completedFlow, [{ ...session(completedActivity), tenantId: 'tenant-else' }]), false)
})

test('flow joins index each session activity once instead of rescanning per flow', () => {
  const count = 32
  let activityReads = 0
  const activities = Array.from({ length: count }, (_, index) => {
    const current = { ...activity('done'), id: `activity-${index}`, decisionId: `tool-activity-decision-${index.toString(16).padStart(24, '0')}` }
    return current
  })
  const messages = activities.map((current, index) => {
    const message: Record<string, unknown> = { id: `message-${index}` }
    Object.defineProperty(message, 'toolActivities', { get() { activityReads += 1; return [current] } })
    return message
  })
  const indexedSession = { id: 'session-many', tenantId: 'tenant-1', messages }
  const flows = activities.map(current => ({
    ...flow(current, { sessionId: 'session-many', round: 1, pending: undefined }),
    decisionId: current.decisionId,
  }))

  assert.equal(validateMcpInputFlows(flows, [indexedSession]), true)
  assert.ok(activityReads <= count + 1, `expected one linear activity-list read per message, observed ${activityReads} reads`)
})

test('round receipts align with pending, reserved-running, terminal, and stop states', () => {
  const receipt = (round: number, action: 'respond' | 'stop' = 'respond') => ({
    responseId: randomUUID(), payloadHash: `${round}`.repeat(64), round, action,
  })
  const awaiting2 = activity('awaiting-input')
  const pending2 = parseMcpInputFlows([flow(awaiting2, { round: 2, receipts: [receipt(1)] })])
  assert.equal(validateMcpInputFlows(pending2, [session(awaiting2)]), true)

  const reserved2 = activity('running')
  const running2 = parseMcpInputFlows([flow(reserved2, { round: 2, pending: undefined, receipts: [receipt(1), receipt(2)] })])
  assert.equal(validateMcpInputFlows(running2, [session(reserved2)]), true)
  assert.throws(() => parseMcpInputFlows([flow(awaiting2, { round: 2, receipts: [receipt(1), receipt(2)] })]))
  assert.throws(() => parseMcpInputFlows([flow(reserved2, { round: 2, pending: undefined, receipts: [receipt(2)] })]))

  const uncertain = activity('uncertain')
  const stopped = parseMcpInputFlows([flow(uncertain, { round: 2, pending: undefined, receipts: [receipt(1), receipt(2, 'stop')] })])
  assert.equal(validateMcpInputFlows(stopped, [session(uncertain)]), true)
  assert.equal(validateMcpInputFlows(stopped, [session(activity('done'))]), false)
  const completed = activity('done')
  assert.equal(validateMcpInputFlows(parseMcpInputFlows([flow(completed, { round: 2, pending: undefined, receipts: [receipt(1)] })]), [session(completed)]), true)
  assert.equal(validateMcpInputFlows(parseMcpInputFlows([flow(completed, { round: 2, pending: undefined, receipts: [receipt(1), receipt(2)] })]), [session(completed)]), true)
  assert.equal(validateMcpInputFlows(running2, [session(reserved2), session(reserved2)]), false)
  assert.equal(validateMcpInputFlows(parseMcpInputFlows([flow(activity('declined'), { round: 1, pending: undefined, receipts: [receipt(1)] })]), [session(activity('declined'))]), false)
})
