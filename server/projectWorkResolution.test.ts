import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { EffectEnvelope } from '../contract/contributions.ts'
import type { OpenSubGoal } from '../contract/directory.ts'
import { createContributionEffectAttempt, settleContributionEffectAttempt } from './contributionEffectState.ts'
import { computeProjectWorkResolution } from './projectWorkResolution.ts'

const item: OpenSubGoal = {
  id: 'work-1', projectId: 'project-1', subGoal: 'Publish update', type: 'mcp.mutate', target: 'calendar-1',
  note: '', postedBy: 'Owner', postedAt: 1, status: 'open',
}

const line = (overrides: Record<string, unknown> = {}) => ({
  id: 'line-1', type: 'mcp.mutate' as const, target: 'calendar-1', cardinality: 1,
  harness: 'mcp' as const, note: '', used: 0, ...overrides,
})

const envelope = (overrides: Partial<EffectEnvelope> = {}): EffectEnvelope => ({
  version: 2, status: 'approved', lines: [line()], proposedBy: 'Owner', proposedAt: 1,
  approvedBy: 'Owner', approvedAt: 2, approvedVersion: 2, ...overrides,
})

const contribution = (overrides: Record<string, unknown> = {}) => ({
  id: 'contribution-1', projectId: 'project-1', workItemId: 'work-1', envelope: envelope(), effectAttempts: [], ...overrides,
})

const intent = (overrides: Record<string, unknown> = {}) => createContributionEffectAttempt({
  id: `contribution-effect-${'a'.repeat(24)}`, tenantId: 'tenant-1', projectId: 'project-1',
  contributionId: 'contribution-1', envelopeVersion: 2, lineId: 'line-1', actor: 'Owner',
  connectionLabel: 'Calendar', call: {
    connectionId: `mcp-connection-${'b'.repeat(32)}`, connectionRevision: 1, toolName: 'create_event',
    schemaHash: 'c'.repeat(64), arguments: { title: 'Update' },
  }, startedAt: 10, ...overrides,
})

const successResult = { resultType: 'complete' as const, content: [{ type: 'text' as const, text: 'Created' }], isError: false }
const doneAttempt = (overrides: Record<string, unknown> = {}) => {
  const pending = intent(overrides)
  return settleContributionEffectAttempt(pending, { status: 'done', result: successResult }, 11)
}

test('resolves only a current successful MCP mutation linked to the exact open work item', () => {
  assert.deepEqual(computeProjectWorkResolution(item, contribution({ effectAttempts: [doneAttempt()] })), {
    status: 'ready', effectId: `contribution-effect-${'a'.repeat(24)}`,
  })
})

test('missing or mismatched contribution linkage needs a result; closed or unsupported work cannot resolve', () => {
  assert.deepEqual(computeProjectWorkResolution(item, undefined), { status: 'needs-result' })
  assert.deepEqual(computeProjectWorkResolution(item, contribution({ workItemId: undefined })), { status: 'needs-result' })
  assert.deepEqual(computeProjectWorkResolution(item, contribution({ workItemId: 'other-work' })), { status: 'needs-result' })
  assert.deepEqual(computeProjectWorkResolution(undefined, contribution({ effectAttempts: [doneAttempt()] })), { status: 'closed' })
  assert.deepEqual(computeProjectWorkResolution({ ...item, status: 'done' }, contribution({ effectAttempts: [doneAttempt()] })), { status: 'closed' })
  assert.deepEqual(computeProjectWorkResolution({ ...item, status: 'retracted' }, contribution({ effectAttempts: [doneAttempt()] })), { status: 'closed' })
  assert.deepEqual(computeProjectWorkResolution({ ...item, type: 'connector.write' }, contribution({ effectAttempts: [doneAttempt()] })), { status: 'closed' })
  assert.deepEqual(computeProjectWorkResolution({ ...item, target: 'other-target' }, contribution({ effectAttempts: [doneAttempt()] })), { status: 'needs-result' })
  assert.deepEqual(computeProjectWorkResolution({ ...item, projectId: 'other-project' }, contribution({ effectAttempts: [doneAttempt()] })), { status: 'needs-result' })
})

test('requires the currently approved envelope version and exact line, type and target', () => {
  const success = doneAttempt()
  assert.deepEqual(computeProjectWorkResolution(item, contribution({ envelope: envelope({ status: 'proposed' }), effectAttempts: [success] })), { status: 'needs-result' })
  assert.deepEqual(computeProjectWorkResolution(item, contribution({ envelope: envelope({ approvedVersion: 1 }), effectAttempts: [success] })), { status: 'needs-result' })
  assert.deepEqual(computeProjectWorkResolution(item, contribution({ envelope: envelope({ version: 3 }), effectAttempts: [success] })), { status: 'needs-result' })
  assert.deepEqual(computeProjectWorkResolution(item, contribution({ envelope: envelope({ lines: [line({ id: 'line-2' })] }), effectAttempts: [success] })), { status: 'needs-result' })
  assert.deepEqual(computeProjectWorkResolution(item, contribution({ envelope: envelope({ lines: [line({ type: 'mcp.query' })] }), effectAttempts: [success] })), { status: 'needs-result' })
  assert.deepEqual(computeProjectWorkResolution(item, contribution({ envelope: envelope({ lines: [line({ target: 'other-target' })] }), effectAttempts: [success] })), { status: 'needs-result' })
})

test('pending, uncertain, and returned tool-error attempts make resolution uncertain even beside another success', () => {
  const pending = intent()
  const uncertain = settleContributionEffectAttempt(pending, { status: 'uncertain' }, 11)
  const erroredPending = intent({ id: `contribution-effect-${'d'.repeat(24)}` })
  const toolError = settleContributionEffectAttempt(erroredPending, {
    status: 'failed', result: { ...successResult, isError: true },
  }, 11)
  const success = doneAttempt({ id: `contribution-effect-${'e'.repeat(24)}` })
  for (const attempt of [pending, uncertain, toolError]) {
    assert.deepEqual(computeProjectWorkResolution(item, contribution({ effectAttempts: [success, attempt] })), { status: 'uncertain' })
  }
})

test('known pre-submit failures can retry, but stale success after amendment cannot resolve', () => {
  const failed = settleContributionEffectAttempt(intent(), { status: 'failed' }, 11)
  assert.deepEqual(computeProjectWorkResolution(item, contribution({ effectAttempts: [failed] })), { status: 'needs-result' })
  const success = doneAttempt()
  assert.deepEqual(computeProjectWorkResolution(item, contribution({
    envelope: envelope({ version: 3, approvedVersion: 3, lines: [line({ id: 'line-2' })] }),
    effectAttempts: [success],
  })), { status: 'needs-result' })
})
