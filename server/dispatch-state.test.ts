import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dispatchSessionId } from './dispatchIdentity.ts'
import { validDispatchState } from './dispatchState.ts'

const tenantId = 'dispatch-state-owner'
const runId = `d-new-${'a'.repeat(24)}`
const sessionId = dispatchSessionId(runId)
const binding = { agentId: 'agent-selected', providerId: 'provider-selected', modelId: 'model-selected' }

function realRun(state = 'running', overrides: Record<string, unknown> = {}) {
  const status = state === 'running' ? 'running' : state === 'replied' ? 'done' : 'failed'
  return {
    id: runId,
    tenantId,
    title: 'Review the release plan',
    detail: 'Check the migration and rollback path.',
    status,
    startedAt: 1_800_000_000_000,
    execution: {
      ...binding,
      kind: 'conversation',
      sessionId,
      state,
      ...(state === 'replied' ? { messageId: 'assistant-result' } : {}),
    },
    ...overrides,
  }
}

function ownerSession(overrides: Record<string, unknown> = {}) {
  return {
    id: sessionId,
    tenantId,
    agentId: binding.agentId,
    providerId: binding.providerId,
    modelId: binding.modelId,
    messages: [
      { id: 'dispatch-user', role: 'user', content: 'Review the release plan\n\nCheck the migration and rollback path.' },
      { id: 'assistant-result', role: 'assistant', content: 'The release is ready.' },
    ],
    ...overrides,
  }
}

test('admits real Dispatch rows only with their exact same-owner conversation binding; legacy rows remain readable', () => {
  assert.equal(validDispatchState([realRun()], [ownerSession()]), true)
  for (const [state, status, messageId] of [
    ['running', 'running', undefined],
    ['replied', 'done', 'assistant-result'],
    ['failed', 'failed', undefined],
    ['interrupted', 'failed', undefined],
    ['cancelled', 'failed', undefined],
  ] as const) {
    const run = realRun(state)
    assert.equal(run.status, status)
    assert.equal(run.execution.messageId, messageId)
    assert.equal(validDispatchState([run], [ownerSession()]), true, `${state} is a valid persisted state`)
  }

  const legacy = { id: 'd1', title: 'Historic fixture run', status: 'running', startedAt: 1, detail: 'Legacy simulation' }
  assert.equal(validDispatchState([legacy], []), true, 'pre-real-Dispatch history keeps its historical shape')
  assert.equal(validDispatchState(undefined, []), true, 'a snapshot without the additive Dispatch slice remains compatible')
})

test('rejects malformed, retired, orphaned, foreign, and colliding real Dispatch identities', () => {
  const valid = realRun()
  const session = ownerSession()
  assert.equal(validDispatchState([{ ...valid, id: 'd-new-not-an-opaque-identity' }], [session]), false)
  assert.equal(validDispatchState([{ ...valid, execution: { ...valid.execution, sessionId: 'sess-wrong' } }], [session]), false)
  assert.equal(validDispatchState([valid], []), false, 'a real run cannot outlive its private Session')
  assert.equal(validDispatchState([valid], [ownerSession({ tenantId: 'another-tenant' })]), false)
  assert.equal(validDispatchState([valid], [session], [sessionId]), false, 'a retired Dispatch Session cannot be restored')
  assert.equal(validDispatchState([valid, structuredClone(valid)], [session]), false, 'real run ids are unique')
  assert.equal(validDispatchState([valid], [session, structuredClone(session)]), false, 'exactly one matching Session must own a run')
})

test('legacy and real Dispatch rows cannot claim the same feed identity', () => {
  const legacyCollision = { id: runId, title: 'Legacy row reusing the real identity', status: 'done', startedAt: 1, detail: 'legacy' }
  assert.equal(validDispatchState([realRun(), legacyCollision], [ownerSession()]), false,
    'legacy and real rows may not claim the same feed identity')
})

test('rejects invalid real Dispatch lifecycle and execution shapes', () => {
  const valid = realRun()
  const session = ownerSession()
  for (const candidate of [
    { ...valid, execution: { ...valid.execution, state: 'queued' } },
    { ...valid, status: 'done' },
    { ...realRun('replied'), execution: { ...realRun('replied').execution, messageId: undefined } },
    { ...valid, execution: { ...valid.execution, messageId: 'unexpected-while-running' } },
    { ...valid, execution: { ...valid.execution, extra: 'not admitted' } },
  ]) {
    assert.equal(validDispatchState([candidate], [session]), false, 'invalid state shapes are refused')
  }
})

test('real Dispatch preserves its frozen execution binding across later Session handoff or model changes', () => {
  const valid = realRun()
  for (const changedSession of [
    ownerSession({ agentId: 'later-agent' }),
    ownerSession({ providerId: 'later-provider' }),
    ownerSession({ modelId: 'later-model' }),
    ownerSession({ agentId: 'later-agent', providerId: 'later-provider', modelId: 'later-model' }),
  ]) {
    assert.equal(validDispatchState([valid], [changedSession]), true,
      'mutable current Session configuration does not rewrite historical execution provenance')
  }
  assert.equal(validDispatchState([valid], [ownerSession({ tenantId: 'another-tenant' })]), false,
    'the owner/session identity wall remains strict')
})

test('Project-work provenance is strict private history, not a live configuration join', () => {
  const valid = realRun()
  const source = { projectId: 'removed-project', itemId: 'old-item', commissionId: 'removed-commission', expectedRevision: 7 }
  const withSource = (projectWork: unknown) => ({ ...valid, execution: { ...valid.execution, projectWork } })
  assert.equal(validDispatchState([withSource(source)], [ownerSession()]), true)
  for (const sourceValue of [undefined, null, {}, { ...source, expectedRevision: -1 }, { ...source, title: 'caller prose' }]) {
    assert.equal(validDispatchState([withSource(sourceValue)], [ownerSession()]), false)
  }
  assert.equal(validDispatchState([withSource(source)], [ownerSession({ tenantId: 'foreign' })]), false)
})

test('replied Dispatch message reference survives legitimate transcript compaction', () => {
  const replied = realRun('replied')
  assert.equal(validDispatchState([replied], [ownerSession({ messages: [] })]), true,
    'the exact bound Session may compact away the original message while the run keeps its historical messageId')
  assert.equal(validDispatchState([replied], [ownerSession({
    messages: [{ id: 'new-summary', role: 'assistant', content: 'Compacted conversation summary.' }],
  })]), true, 'the current transcript need not contain the original assistant row')
  assert.equal(validDispatchState([replied], [ownerSession({ tenantId: 'another-tenant', messages: [] })]), false,
    'compaction does not relax same-owner Session identity')
})

test('MCP draft preview is bounded historical metadata attached only to Project work', () => {
  const valid = realRun()
  const projectWork = { projectId: 'project', itemId: 'work', commissionId: 'commission', expectedRevision: 0 }
  const preview = { connectionLabel: 'Owned MCP', toolName: 'write_record', bindingHash: 'a'.repeat(64), transport: 'stdio' }
  const run = { ...valid, execution: { ...valid.execution, projectWork, mcpProposal: preview } }
  assert.equal(validDispatchState([run], [ownerSession()]), true)
  for (const mcpProposal of [undefined, null, {}, { ...preview, bindingHash: 'short' },
    { ...preview, connectionId: 'private-id' }, { ...preview, transport: 'http' }]) {
    assert.equal(validDispatchState([{ ...run, execution: { ...run.execution, mcpProposal } }], [ownerSession()]), false)
  }
  assert.equal(validDispatchState([{ ...valid, execution: { ...valid.execution, mcpProposal: preview } }], [ownerSession()]), false)
})
