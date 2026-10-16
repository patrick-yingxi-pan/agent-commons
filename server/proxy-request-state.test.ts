import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'
import type { AgentRequestReplyDraftBinding } from '../contract/agentRequests.ts'
import type { McpBoundToolCall } from '../contract/mcpExecution.ts'
import type { McpBoundExecutionOutcome } from './mcpBoundExecution.ts'
import {
  beginProxyRequest,
  beginProxyArgumentDraft,
  beginProxyReplyDraft,
  cancelProxyRequest,
  createProxyRequest,
  denyProxyRequest,
  interruptProxyRequest,
  interruptPendingProxyArgumentDraft,
  parseStoredProxyRequest,
  proxyRequestView,
  settleProxyRequest,
  settleProxyArgumentDraft,
  settleProxyReplyDraft,
  shareProxyReply,
} from './proxyRequestState.ts'

const requester = { tenantId: 'tenant-requester', userId: 'person-requester', agentId: 'agent-requester' }
const owner = { tenantId: 'tenant-owner', userId: 'person-owner', agentId: 'agent-owner' }
const requesterActor = { tenantId: requester.tenantId, userId: requester.userId }
const ownerActor = { tenantId: owner.tenantId, userId: owner.userId }
const outsider = { tenantId: owner.tenantId, userId: 'person-other' }
const id = `agent-request-${'a'.repeat(32)}`
const createdAt = 1_000

function input(overrides: Record<string, unknown> = {}) {
  return {
    id,
    requester: { ...requester },
    owner: { ...owner },
    task: 'Look up the latest invoice status.',
    createdAt,
    ...overrides,
  }
}

function call(overrides: Partial<McpBoundToolCall> = {}): McpBoundToolCall {
  return {
    connectionId: 'mcp-connection-owner',
    connectionRevision: 3,
    toolName: 'invoice_lookup',
    schemaHash: 'b'.repeat(64),
    arguments: { invoice: 'INV-42' },
    ...overrides,
  }
}

function httpApproval() {
  return { transport: 'http' as const, call: call() }
}

function draftBinding(overrides: Record<string, unknown> = {}) {
  return {
    agentRevision: 2,
    providerId: 'provider-anthropic',
    providerRevision: 0,
    providerConnectionRevision: 3,
    model: 'claude-test-model',
    connectionId: 'mcp-connection-owner',
    connectionRevision: 3,
    toolName: 'invoice_lookup',
    schemaHash: 'b'.repeat(64),
    transport: 'http',
    ...overrides,
  } as const
}
const draftHash = 'c'.repeat(64)
const replyDraftBinding: AgentRequestReplyDraftBinding = {
  agentRevision: 2, providerId: 'provider-anthropic', providerRevision: 0,
  providerConnectionRevision: 3, model: 'claude-test-model',
}

function outcome(status: McpBoundExecutionOutcome['status'] = 'done'): McpBoundExecutionOutcome {
  if (status === 'uncertain') return { status, summary: 'The remote result is uncertain.' }
  const result = {
    resultType: 'complete' as const,
    content: [{ type: 'text' as const, text: 'PRIVATE RAW MCP RESULT: invoice is overdue.' }],
    isError: status === 'failed',
  }
  return { status, summary: 'Private execution summary.', result }
}

function started() {
  const row = createProxyRequest(input())
  return beginProxyRequest(row, ownerActor, 1, httpApproval(), createdAt + 1)
}

test('request lifecycle is revisioned, person-scoped, and shares only an explicit owner reply', () => {
  const created = createProxyRequest(input())
  assert.deepEqual(created, {
    version: 1,
    intent: input(),
    revision: 1,
    status: 'waiting',
    updatedAt: createdAt,
  })

  const pending = beginProxyRequest(created, ownerActor, 1, httpApproval(), createdAt + 1)
  assert.equal(pending.status, 'running')
  assert.equal(pending.revision, 2)
  assert.equal(pending.execution?.status, 'pending')
  assert.equal(pending.execution?.startedAt, createdAt + 1)

  const settled = settleProxyRequest(pending, pending.execution!.callHash, outcome(), createdAt + 2)
  assert.equal(settled.status, 'awaiting-reply')
  assert.equal(settled.revision, 3)
  assert.equal(settled.execution?.status, 'done')

  const ownerView = proxyRequestView(settled, ownerActor)!
  const requesterView = proxyRequestView(settled, requesterActor)!
  assert.deepEqual(Object.keys(requesterView).sort(), [
    'createdAt', 'fromAgentId', 'id', 'revision', 'status', 'task', 'toAgentId', 'updatedAt',
  ].sort())
  assert.equal(ownerView.execution?.status, 'done')
  assert.equal(ownerView.execution?.callHash, pending.execution!.callHash)
  assert.equal(JSON.stringify(requesterView).includes('PRIVATE RAW MCP RESULT'), false)
  assert.equal(JSON.stringify(requesterView).includes('summary'), false)
  assert.equal(JSON.stringify(ownerView).includes('PRIVATE RAW MCP RESULT'), true, 'only the exact owner can review the raw result')
  assert.equal(JSON.stringify(ownerView).includes('tenant-owner'), false, 'private identity anchors never cross the view')
  assert.equal(proxyRequestView(settled, outsider), undefined, 'same tenant does not make another person a party')

  const replied = shareProxyReply(settled, ownerActor, 3, 'The invoice is overdue; I confirmed the account is active.', createdAt + 3)
  assert.equal(replied.status, 'replied')
  assert.equal(replied.revision, 4)
  assert.equal(proxyRequestView(replied, requesterActor)?.reply, 'The invoice is overdue; I confirmed the account is active.')
  assert.throws(() => shareProxyReply(replied, ownerActor, 4, 'A second reply', createdAt + 4))
})

test('owner may directly share reviewed prose from waiting without an execution receipt', () => {
  const waiting = createProxyRequest(input())
  const direct = shareProxyReply(waiting, ownerActor, waiting.revision, 'I need one clarification before I can help.', createdAt + 1)
  assert.equal(direct.status, 'replied')
  assert.equal(direct.revision, 2)
  assert.equal(direct.execution, undefined, 'a direct reply must not invent an MCP execution receipt')
  assert.equal(direct.reply, 'I need one clarification before I can help.')
  assert.deepEqual(parseStoredProxyRequest(direct), direct, 'the direct terminal state round-trips through the strict persisted parser')
  assert.equal(proxyRequestView(direct, requesterActor)?.reply, direct.reply)
  assert.equal(proxyRequestView(direct, ownerActor)?.execution, undefined)
  assert.equal(proxyRequestView(direct, outsider), undefined)
  assert.throws(() => shareProxyReply(waiting, requesterActor, waiting.revision, 'Requester cannot author owner reply.', createdAt + 1))
  assert.throws(() => shareProxyReply(waiting, outsider, waiting.revision, 'Bystander cannot author owner reply.', createdAt + 1))
  assert.throws(() => shareProxyReply(waiting, ownerActor, waiting.revision + 1, 'Stale owner review.', createdAt + 1))
  assert.throws(() => shareProxyReply(direct, ownerActor, direct.revision, 'A second reply.', createdAt + 2))

  const running = beginProxyRequest(waiting, ownerActor, waiting.revision, httpApproval(), createdAt + 1)
  assert.throws(() => shareProxyReply(running, ownerActor, running.revision, 'Do not share while a call is pending.', createdAt + 2))

  const pendingDraft = beginProxyArgumentDraft(waiting, ownerActor, waiting.revision, draftBinding(), draftHash, createdAt + 1)
  assert.throws(() => shareProxyReply(pendingDraft, ownerActor, pendingDraft.revision, 'Do not share while model advice is pending.', createdAt + 2))
  const settledDraft = settleProxyArgumentDraft(pendingDraft, draftHash, { status: 'failed' }, createdAt + 2)
  const afterDraft = shareProxyReply(settledDraft, ownerActor, settledDraft.revision, 'I can answer directly without running a tool.', createdAt + 3)
  assert.equal(afterDraft.status, 'replied', 'a terminal private argument-draft attempt does not require MCP execution')
  assert.equal(afterDraft.execution, undefined)

  const restoredWaiting = parseStoredProxyRequest({ ...waiting, executionBlockedByRestore: true })
  const restoredDirect = shareProxyReply(restoredWaiting, ownerActor, restoredWaiting.revision,
    'I can still provide a reviewed text reply without reopening execution.', createdAt + 1)
  assert.equal(restoredDirect.status, 'replied', 'restore fences execution, not a pure owner-authored disclosure')
  assert.equal(restoredDirect.execution, undefined)
  assert.equal(restoredDirect.executionBlockedByRestore, true)

  const denied = denyProxyRequest(waiting, ownerActor, waiting.revision, createdAt + 1)
  assert.throws(() => shareProxyReply(denied, ownerActor, denied.revision, 'Not after denial.', createdAt + 2))
  const cancelled = cancelProxyRequest(waiting, requesterActor, waiting.revision, createdAt + 1)
  assert.throws(() => shareProxyReply(cancelled, ownerActor, cancelled.revision, 'Not after cancellation.', createdAt + 2))
  assert.throws(() => parseStoredProxyRequest({ ...waiting, replySource: 'direct' }),
    'reply provenance cannot appear before a reply')
  const runningForMixed = beginProxyRequest(waiting, ownerActor, waiting.revision, httpApproval(), createdAt + 1)
  const settled = settleProxyRequest(runningForMixed, runningForMixed.execution!.callHash, outcome(), createdAt + 2)
  assert.throws(() => parseStoredProxyRequest({ ...settled, status: 'replied', revision: 2,
    reply: 'No mixed execution/direct receipt.', replySource: 'direct' }),
    'direct reply provenance cannot coexist with an execution receipt')
  assert.throws(() => parseStoredProxyRequest({ ...pendingDraft, status: 'replied', revision: pendingDraft.revision + 1,
    reply: 'No sharing while a model draft is pending.', replySource: 'direct' }),
    'direct terminal rows cannot retain pending model work')
})

test('a private reply draft may follow a completed MCP run and still share only on explicit review', () => {
  const run = beginProxyRequest(createProxyRequest(input()), ownerActor, 1, httpApproval(), createdAt + 1)
  const awaiting = settleProxyRequest(run, run.execution!.callHash, outcome(), createdAt + 2)
  const pending = beginProxyReplyDraft(awaiting, ownerActor, awaiting.revision, replyDraftBinding,
    'd'.repeat(64), 'Ask for the invoice number.', createdAt + 3)
  assert.equal(pending.status, 'awaiting-reply')
  assert.equal(pending.replyDraft?.status, 'pending')
  const settled = settleProxyReplyDraft(pending, 'd'.repeat(64), { status: 'done', text: 'Please send the invoice number.' }, createdAt + 4)
  assert.equal(settled.status, 'awaiting-reply')
  assert.deepEqual(parseStoredProxyRequest(settled), settled, 'the exact terminal draft survives strict restart parsing')
  assert.equal(settled.reply, undefined, 'model text remains private after settlement')
  const shared = shareProxyReply(settled, ownerActor, settled.revision,
    'Please send the invoice number.', createdAt + 5)
  assert.equal(shared.status, 'replied')
  assert.equal(shared.revision, 6)
  assert.equal(shared.reply, 'Please send the invoice number.')
  assert.equal(shared.replyDraft?.text, 'Please send the invoice number.')
  assert.equal(shared.execution?.status, 'done', 'sharing retains the historical MCP receipt')
})

test('owner may use either explicitly selected transport, with local execution opt-in carried in its approval', () => {
  const row = createProxyRequest(input())
  const approvedCall = call({ toolName: 'local_search' })
  const running = beginProxyRequest(row, ownerActor, 1, {
    transport: 'stdio', localPrograms: true, call: approvedCall,
  }, createdAt + 1)
  assert.deepEqual(running.execution?.approval, {
    transport: 'stdio', localPrograms: true, call: approvedCall,
  })
  assert.throws(() => beginProxyRequest(row, ownerActor, 1, {
    transport: 'stdio', localPrograms: false, call: approvedCall,
  } as never, createdAt + 1))
})

test('one owner-only argument draft is a private receipt, waits before Run, and never supplies consent', () => {
  const waiting = createProxyRequest(input())
  assert.throws(() => beginProxyArgumentDraft(waiting, requesterActor, 1, draftBinding(), draftHash, createdAt + 1))
  assert.throws(() => beginProxyArgumentDraft(waiting, outsider, 1, draftBinding(), draftHash, createdAt + 1))
  assert.throws(() => beginProxyArgumentDraft(waiting, ownerActor, 0, draftBinding(), draftHash, createdAt + 1))

  const pending = beginProxyArgumentDraft(waiting, ownerActor, 1, draftBinding(), draftHash, createdAt + 1)
  assert.equal(pending.status, 'waiting')
  assert.equal(pending.revision, 2)
  assert.equal(pending.argumentDraft?.status, 'pending')
  assert.throws(() => beginProxyRequest(pending, ownerActor, pending.revision, httpApproval(), createdAt + 2),
    'a model draft receipt cannot authorize or race an MCP call')
  assert.throws(() => beginProxyArgumentDraft(pending, ownerActor, pending.revision, draftBinding(), draftHash, createdAt + 2),
    'only one draft attempt may exist')

  const args = { invoice: 'INV-42', include_history: true }
  const settled = settleProxyArgumentDraft(pending, draftHash, { status: 'done', arguments: args }, createdAt + 2)
  assert.equal(settled.status, 'waiting')
  assert.equal(settled.revision, 3)
  assert.equal(settled.updatedAt, createdAt + 2)
  assert.deepEqual(settled.argumentDraft?.arguments, args)
  const ownerView = proxyRequestView(settled, ownerActor)!
  const requesterView = proxyRequestView(settled, requesterActor)!
  assert.deepEqual(ownerView.argumentDraft?.arguments, args)
  assert.equal(Object.hasOwn(requesterView, 'argumentDraft'), false)
  assert.equal(JSON.stringify(requesterView).includes('INV-42'), false)

  const run = beginProxyRequest(settled, ownerActor, settled.revision, {
    transport: 'http', call: call({ arguments: args }),
  }, createdAt + 3)
  assert.equal(run.status, 'running')
  assert.equal(run.revision, 4)
  assert.deepEqual(run.execution?.approval.call.arguments, args,
    'the separate explicit Run freezes the exact arguments the owner chose')
  assert.deepEqual(run.argumentDraft?.arguments, args, 'the private draft receipt remains historical')
  const awaiting = settleProxyRequest(run, run.execution!.callHash, outcome(), createdAt + 4)
  assert.throws(() => parseStoredProxyRequest({ ...awaiting, argumentDraft: { ...awaiting.argumentDraft, finishedAt: createdAt + 4 } }),
    'an MCP call cannot have begun before the prior model attempt finished')
  assert.equal(awaiting.revision, 5, 'the terminal draft revision contributes to later request phase revisions')
  const replied = shareProxyReply(awaiting, ownerActor, awaiting.revision, 'Reviewed separately.', createdAt + 5)
  assert.equal(replied.revision, 6)
  assert.deepEqual(replied.argumentDraft?.arguments, args)
})

test('draft failure and uncertainty are terminal attempts; cancellation keeps a late result private', () => {
  const pending = beginProxyArgumentDraft(createProxyRequest(input()), ownerActor, 1, draftBinding(), draftHash, createdAt + 1)
  const cancelled = cancelProxyRequest(pending, requesterActor, pending.revision, createdAt + 2)
  assert.throws(() => parseStoredProxyRequest({ ...cancelled, cancelledAt: createdAt, updatedAt: createdAt + 1 }),
    'a draft cannot be started after its request was cancelled')
  assert.equal(cancelled.status, 'cancelled')
  assert.equal(cancelled.revision, 3)
  assert.equal(cancelled.argumentDraft?.status, 'pending')
  const late = settleProxyArgumentDraft(cancelled, draftHash, {
    status: 'done', arguments: { private: 'late model draft' },
  }, createdAt + 3)
  assert.equal(late.status, 'cancelled')
  assert.equal(late.revision, 4)
  assert.equal(late.argumentDraft?.status, 'done')
  assert.equal(proxyRequestView(late, requesterActor)?.argumentDraft, undefined)
  assert.equal(proxyRequestView(late, ownerActor)?.argumentDraft?.status, 'done')
  assert.throws(() => beginProxyRequest(late, ownerActor, late.revision, httpApproval(), createdAt + 4))

  const failedPending = beginProxyArgumentDraft(createProxyRequest(input({ id: `agent-request-${'d'.repeat(32)}` })), ownerActor, 1,
    draftBinding(), 'd'.repeat(64), createdAt + 1)
  const failed = settleProxyArgumentDraft(failedPending, 'd'.repeat(64), { status: 'failed' }, createdAt + 2)
  assert.equal(failed.argumentDraft?.status, 'failed')
  assert.equal(failed.argumentDraft && 'arguments' in failed.argumentDraft, false)
  assert.throws(() => beginProxyArgumentDraft(failed, ownerActor, failed.revision, draftBinding(), 'e'.repeat(64), createdAt + 3))
})

test('pending draft recovery becomes uncertainty without replay and malformed receipts fail strict parsing', () => {
  const pending = beginProxyArgumentDraft(createProxyRequest(input()), ownerActor, 1, draftBinding(), draftHash, createdAt + 1)
  const recovered = interruptProxyRequest(parseStoredProxyRequest(JSON.parse(JSON.stringify(pending))), createdAt + 2)
  assert.equal(recovered.argumentDraft?.status, 'uncertain')
  assert.equal(recovered.revision, 3)
  assert.throws(() => beginProxyArgumentDraft(recovered, ownerActor, recovered.revision, draftBinding(), 'f'.repeat(64), createdAt + 3))
  assert.equal(interruptPendingProxyArgumentDraft(recovered, createdAt + 4).revision, recovered.revision)

  const done = settleProxyArgumentDraft(pending, draftHash, { status: 'done', arguments: { value: 1 } }, createdAt + 2)
  const reject = (patch: Record<string, unknown>) => assert.throws(() => parseStoredProxyRequest({ ...done, argumentDraft: patch }))
  reject({ ...done.argumentDraft, unexpected: true })
  reject({ ...done.argumentDraft, inputHash: 'not-a-hash' })
  reject({ ...done.argumentDraft, binding: { ...done.argumentDraft!.binding, providerRevision: -1 } })
  reject({ ...done.argumentDraft, arguments: 'not-object' })
  reject({ ...done.argumentDraft, status: 'pending', revision: 1, finishedAt: undefined, arguments: undefined })
  assert.throws(() => settleProxyArgumentDraft(pending, '0'.repeat(64), { status: 'uncertain' }, createdAt + 2))
  assert.throws(() => settleProxyArgumentDraft(pending, draftHash, { status: 'uncertain' }, createdAt))
})

test('only the exact owner may begin or deny, either exact party may cancel, and stale revisions do nothing', () => {
  const row = createProxyRequest(input())
  assert.throws(() => beginProxyRequest(row, requesterActor, 1, httpApproval(), createdAt + 1))
  assert.throws(() => beginProxyRequest(row, outsider, 1, httpApproval(), createdAt + 1))
  assert.throws(() => beginProxyRequest(row, ownerActor, 0, httpApproval(), createdAt + 1))
  assert.throws(() => beginProxyRequest(row, ownerActor, 1, httpApproval(), createdAt - 1))

  assert.throws(() => denyProxyRequest(row, requesterActor, 1, createdAt + 1))
  const denied = denyProxyRequest(row, ownerActor, 1, createdAt + 1)
  assert.equal(denied.status, 'denied')
  assert.equal(denied.revision, 2)
  assert.throws(() => denyProxyRequest(denied, ownerActor, 2, createdAt + 2))

  assert.throws(() => cancelProxyRequest(row, outsider, 1, createdAt + 1))
  assert.throws(() => cancelProxyRequest(row, ownerActor, 0, createdAt + 1))
  const cancelled = cancelProxyRequest(row, requesterActor, 1, createdAt + 1)
  assert.equal(cancelled.status, 'cancelled')
  assert.equal(cancelled.cancelledBy, 'requester')
})

test('cancellation during an in-flight call stays cancelled after late settlement and cannot replay or share', () => {
  const pending = started()
  const cancelled = cancelProxyRequest(pending, requesterActor, 2, createdAt + 2)
  assert.equal(cancelled.status, 'cancelled')
  assert.equal(cancelled.cancelledAt, createdAt + 2)
  assert.equal(cancelled.execution?.status, 'pending', 'cancellation does not rewrite an already-submitted call')

  const late = settleProxyRequest(cancelled, pending.execution!.callHash, outcome(), createdAt + 3)
  assert.equal(late.status, 'cancelled')
  assert.equal(late.revision, 4)
  assert.equal(late.execution?.status, 'done', 'late truth is retained privately')
  assert.throws(() => beginProxyRequest(late, ownerActor, late.revision, httpApproval(), createdAt + 4))
  assert.throws(() => shareProxyReply(late, ownerActor, late.revision, 'Too late', createdAt + 4))

  const restored = parseStoredProxyRequest(JSON.parse(JSON.stringify(late)))
  assert.equal(restored.status, 'cancelled')
  assert.equal(restored.execution?.status, 'done')
  assert.throws(() => beginProxyRequest(restored, ownerActor, restored.revision, httpApproval(), createdAt + 5),
    'restored calls are receipt state, never replay authority')
  assert.equal(interruptProxyRequest(restored, createdAt + 6).revision, restored.revision, 'terminal interruption is idempotent')
})

test('either exact party can cancel every nonterminal state, while terminal states reject cancellation', () => {
  const waiting = createProxyRequest(input())
  const running = started()
  const awaitingReply = settleProxyRequest(running, running.execution!.callHash, outcome(), createdAt + 2)
  const cases = [
    { row: waiting, label: 'waiting' },
    { row: running, label: 'running' },
    { row: awaitingReply, label: 'awaiting-reply' },
  ] as const
  for (const { row, label } of cases) {
    for (const [actor, cancelledBy] of [[requesterActor, 'requester'], [ownerActor, 'owner']] as const) {
      const cancelled = cancelProxyRequest(row, actor, row.revision, row.updatedAt + 1)
      assert.equal(cancelled.status, 'cancelled', `${label} can be cancelled by the ${cancelledBy}`)
      assert.equal(cancelled.cancelledBy, cancelledBy)
      assert.equal(cancelled.revision, row.revision + 1)
    }
  }
  const denied = denyProxyRequest(waiting, ownerActor, waiting.revision, waiting.updatedAt + 1)
  assert.throws(() => cancelProxyRequest(denied, ownerActor, denied.revision, denied.updatedAt + 1))
  const replied = shareProxyReply(awaitingReply, ownerActor, awaitingReply.revision, 'Reviewed response.', awaitingReply.updatedAt + 1)
  assert.throws(() => cancelProxyRequest(replied, requesterActor, replied.revision, replied.updatedAt + 1))
})

test('interrupted pending execution becomes uncertain and is not reset by a second interruption', () => {
  const pending = started()
  const interrupted = interruptProxyRequest(pending, createdAt + 2)
  assert.equal(interrupted.status, 'awaiting-reply')
  assert.equal(interrupted.execution?.status, 'uncertain')
  assert.equal(interrupted.revision, 3)
  assert.equal(interruptProxyRequest(interrupted, createdAt + 3).revision, interrupted.revision)
  assert.throws(() => beginProxyRequest(interrupted, ownerActor, interrupted.revision, httpApproval(), createdAt + 4))
  const cancelled = cancelProxyRequest(pending, requesterActor, 2, createdAt + 2)
  const recovered = interruptProxyRequest(cancelled, createdAt + 3)
  assert.equal(recovered.status, 'cancelled')
  assert.equal(recovered.execution?.status, 'uncertain')
  assert.equal(recovered.revision, 4)
  assert.equal(proxyRequestView(recovered, requesterActor)?.reply, undefined)
  assert.throws(() => shareProxyReply(recovered, ownerActor, 4, 'Do not reopen sharing', createdAt + 4))
})

test('strict parser detaches valid rows and rejects malformed rows, accessors, prototypes, and extra fields', () => {
  const source = started()
  const parsed = parseStoredProxyRequest(JSON.parse(JSON.stringify(source)))
  assert.deepEqual(parsed, source)
  assert.notEqual(parsed, source)
  assert.notEqual(parsed.intent, source.intent)
  assert.notEqual(parsed.execution, source.execution)

  const reject = (value: unknown) => assert.throws(() => parseStoredProxyRequest(value))
  reject(null)
  reject([])
  reject({ ...source, unexpected: true })
  reject({ ...source, revision: 0 })
  reject({ ...source, status: 'fulfilled' })
  reject({ ...source, id: 'caller-chosen-id' })
  reject({ ...source, intent: { ...source.intent, unknown: true } })
  reject({ ...source, execution: { ...(source.execution as object), rawCredential: 'secret' } })

  let read = false
  const accessor = { ...source }
  Object.defineProperty(accessor, 'updatedAt', { enumerable: true, get() { read = true; return source.updatedAt } })
  reject(accessor)
  assert.equal(read, false, 'the parser must inspect descriptors without invoking attacker getters')

  const inherited = Object.assign(Object.create({ inherited: true }), source)
  reject(inherited)
})

test('strict parser requires every field for each lifecycle state and rejects incoherent state combinations', () => {
  const waiting = createProxyRequest(input())
  const running = started()
  const awaiting = settleProxyRequest(running, running.execution!.callHash, outcome(), createdAt + 2)
  const replied = shareProxyReply(awaiting, ownerActor, awaiting.revision, 'Reviewed response.', createdAt + 3)
  const denied = denyProxyRequest(waiting, ownerActor, waiting.revision, createdAt + 1)
  const cancelledPending = cancelProxyRequest(running, requesterActor, running.revision, createdAt + 2)
  const cancelledTerminal = cancelProxyRequest(awaiting, ownerActor, awaiting.revision, createdAt + 3)
  const cases = [
    { name: 'waiting', row: waiting, required: ['version', 'intent', 'revision', 'status', 'updatedAt'] },
    { name: 'running', row: running, required: ['version', 'intent', 'revision', 'status', 'updatedAt', 'execution'] },
    { name: 'awaiting-reply', row: awaiting, required: ['version', 'intent', 'revision', 'status', 'updatedAt', 'execution'] },
    { name: 'replied', row: replied, required: ['version', 'intent', 'revision', 'status', 'updatedAt', 'execution', 'reply'] },
    { name: 'denied', row: denied, required: ['version', 'intent', 'revision', 'status', 'updatedAt'] },
    { name: 'cancelled-pending', row: cancelledPending, required: ['version', 'intent', 'revision', 'status', 'updatedAt', 'execution', 'cancelledAt', 'cancelledBy'] },
    { name: 'cancelled-terminal', row: cancelledTerminal, required: ['version', 'intent', 'revision', 'status', 'updatedAt', 'execution', 'cancelledAt', 'cancelledBy'] },
  ] as const
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

  for (const { name, row, required } of cases) {
    assert.deepEqual(parseStoredProxyRequest(clone(row)), row, `${name} round-trips`)
    for (const key of required) {
      const malformed = clone(row) as unknown as Record<string, unknown>
      delete malformed[key]
      assert.throws(() => parseStoredProxyRequest(malformed), `${name} requires ${key}`)
    }
    const wrongRevision = clone(row)
    wrongRevision.revision += 1
    assert.throws(() => parseStoredProxyRequest(wrongRevision), `${name} revision must match its lifecycle`)
  }

  const executionCases = [
    { name: 'running pending', row: running, remove: ['approval', 'callHash', 'startedAt', 'status'], add: ['finishedAt', 'summary', 'result'] },
    { name: 'awaiting terminal', row: awaiting, remove: ['approval', 'callHash', 'startedAt', 'status', 'finishedAt', 'summary', 'result'], add: [] },
    { name: 'replied terminal', row: replied, remove: ['approval', 'callHash', 'startedAt', 'status', 'finishedAt', 'summary', 'result'], add: [] },
    { name: 'cancelled pending', row: cancelledPending, remove: ['approval', 'callHash', 'startedAt', 'status'], add: ['finishedAt', 'summary', 'result'] },
    { name: 'cancelled terminal', row: cancelledTerminal, remove: ['approval', 'callHash', 'startedAt', 'status', 'finishedAt', 'summary', 'result'], add: [] },
  ] as const
  for (const item of executionCases) {
    for (const field of item.remove) {
      const malformed = clone(item.row)
      delete (malformed.execution as unknown as Record<string, unknown>)[field]
      assert.throws(() => parseStoredProxyRequest(malformed), `${item.name} requires execution.${field}`)
    }
    for (const field of item.add) {
      const malformed = clone(item.row)
      ;(malformed.execution as unknown as Record<string, unknown>)[field] = field === 'finishedAt' ? createdAt + 2 : field === 'result'
        ? { resultType: 'complete', content: [], isError: false }
        : 'unexpected'
      assert.throws(() => parseStoredProxyRequest(malformed), `${item.name} forbids execution.${field}`)
    }
  }

  for (const { name, row } of cases.filter(item => item.name !== 'replied')) {
    const malformed = clone(row) as unknown as Record<string, unknown>
    malformed.reply = 'not allowed here'
    assert.throws(() => parseStoredProxyRequest(malformed), `${name} cannot carry a reply`)
  }
  for (const { name, row } of cases.filter(item => item.name !== 'cancelled-pending' && item.name !== 'cancelled-terminal')) {
    const malformed = clone(row) as unknown as Record<string, unknown>
    malformed.cancelledAt = createdAt + 1
    malformed.cancelledBy = 'requester'
    assert.throws(() => parseStoredProxyRequest(malformed), `${name} cannot carry cancellation metadata`)
  }
  for (const { name, row } of [
    { name: 'waiting', row: waiting }, { name: 'awaiting-reply', row: awaiting },
    { name: 'replied', row: replied }, { name: 'denied', row: denied },
  ]) {
    const malformed = clone(row) as unknown as Record<string, unknown>
    malformed.execution = { ...(row.execution ?? {}), status: 'pending' }
    assert.throws(() => parseStoredProxyRequest(malformed), `${name} status cannot be paired with pending execution`)
  }
})

test('execution hash binds every request identity, task, creation time, and reviewed call field', () => {
  const original = started()
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
  const changes: Array<[string, (row: typeof original) => void]> = [
    ['request id', row => { row.intent.id = `agent-request-${'c'.repeat(32)}` }],
    ['requester tenant', row => { row.intent.requester.tenantId += '-changed' }],
    ['requester person', row => { row.intent.requester.userId += '-changed' }],
    ['requester Agent', row => { row.intent.requester.agentId += '-changed' }],
    ['owner tenant', row => { row.intent.owner.tenantId += '-changed' }],
    ['owner person', row => { row.intent.owner.userId += '-changed' }],
    ['owner Agent', row => { row.intent.owner.agentId += '-changed' }],
    ['task', row => { row.intent.task += ' Changed.' }],
    ['createdAt', row => { row.intent.createdAt += 1 }],
    ['transport', row => { row.execution!.approval = { transport: 'stdio', localPrograms: true, call: row.execution!.approval.call } }],
    ['connection id', row => { row.execution!.approval.call.connectionId += '-changed' }],
    ['connection revision', row => { row.execution!.approval.call.connectionRevision += 1 }],
    ['tool name', row => { row.execution!.approval.call.toolName += '_changed' }],
    ['schema hash', row => { row.execution!.approval.call.schemaHash = 'd'.repeat(64) }],
    ['arguments', row => { row.execution!.approval.call.arguments.invoice = 'INV-99' }],
  ]
  for (const [name, mutate] of changes) {
    const malformed = clone(original)
    mutate(malformed)
    assert.throws(() => parseStoredProxyRequest(malformed), `${name} change invalidates the call hash`)
  }

  const multi = beginProxyRequest(createProxyRequest(input()), ownerActor, 1, {
    transport: 'http', call: call({ arguments: { z: 'last', a: 'first' } }),
  }, createdAt + 1)
  const reordered = clone(multi)
  reordered.execution!.approval.call.arguments = { a: 'first', z: 'last' }
  assert.deepEqual(parseStoredProxyRequest(reordered), multi, 'canonical JSON key ordering preserves the same exact call hash')
})

test('execution is one attempt: wrong hashes, stale/double settlement, and every non-waiting begin are refused', () => {
  const waiting = createProxyRequest(input())
  const running = started()
  const hash = running.execution!.callHash
  assert.throws(() => settleProxyRequest(running, '0'.repeat(64), outcome(), createdAt + 2))
  assert.throws(() => settleProxyRequest(running, hash, outcome(), createdAt))
  const awaiting = settleProxyRequest(running, hash, outcome(), createdAt + 2)
  assert.throws(() => settleProxyRequest(awaiting, hash, outcome(), createdAt + 3))
  const replied = shareProxyReply(awaiting, ownerActor, awaiting.revision, 'Reviewed response.', createdAt + 3)
  const denied = denyProxyRequest(waiting, ownerActor, waiting.revision, createdAt + 1)
  const cancelled = cancelProxyRequest(waiting, requesterActor, waiting.revision, createdAt + 1)
  for (const row of [running, awaiting, replied, denied, cancelled]) {
    assert.throws(() => beginProxyRequest(row, ownerActor, row.revision, httpApproval(), row.updatedAt + 1), `${row.status} cannot begin another call`)
  }
})

test('invalid, oversized, unknown-field, or accessor-backed outcomes become uncertainty without leaking or truncating', () => {
  const oversize = {
    status: 'done', summary: 'Untrusted summary.',
    result: { resultType: 'complete', content: [{ type: 'text', text: `DO NOT LEAK ${'x'.repeat(262_145)}` }], isError: false },
  }
  let getterRead = false
  const accessor = { summary: 'ignored', result: outcome().result }
  Object.defineProperty(accessor, 'status', { enumerable: true, get() { getterRead = true; return 'done' } })
  const invalidOutcomes: unknown[] = [
    { status: 'done', summary: 'ignored', result: { resultType: 'complete', content: [{ type: 'text', text: 42 }], isError: false } },
    oversize,
    { ...outcome(), unknown: true },
    accessor,
    { status: 'done', summary: 'ignored', result: { resultType: 'complete', content: [], isError: true } },
  ]
  for (const raw of invalidOutcomes) {
    const pending = started()
    const settled = settleProxyRequest(pending, pending.execution!.callHash, raw as McpBoundExecutionOutcome, createdAt + 2)
    assert.equal(settled.execution?.status, 'uncertain')
    assert.equal(Object.hasOwn(settled.execution!, 'result'), false)
    assert.equal(JSON.stringify(proxyRequestView(settled, requesterActor)).includes('DO NOT LEAK'), false)
    assert.equal(JSON.stringify(proxyRequestView(settled, requesterActor)).includes('ignored'), false)
  }
  assert.equal(getterRead, false, 'outcome parsing does not invoke accessors')

  const pending = started()
  const failedWithoutResult = settleProxyRequest(pending, pending.execution!.callHash,
    { status: 'failed', summary: 'discarded raw summary' }, createdAt + 2)
  assert.equal(failedWithoutResult.execution?.status, 'failed')
  assert.equal(Object.hasOwn(failedWithoutResult.execution!, 'result'), false)

  const failedWithErrorResult = settleProxyRequest(pending, pending.execution!.callHash, outcome('failed'), createdAt + 2)
  assert.equal(failedWithErrorResult.execution?.status, 'failed')
  assert.equal(failedWithErrorResult.execution?.result?.isError, true)
})

test('task and reviewed reply honor exact UTF-8 byte limits', () => {
  const exactTask = '🧾'.repeat(2_048)
  const row = createProxyRequest(input({ task: exactTask }))
  assert.equal(Buffer.byteLength(row.intent.task, 'utf8'), 8_192)
  assert.throws(() => createProxyRequest(input({ task: `${exactTask}🧾` })))

  const pending = started()
  const awaiting = settleProxyRequest(pending, pending.execution!.callHash, outcome(), createdAt + 2)
  const exactReply = '💬'.repeat(16_384)
  const replied = shareProxyReply(awaiting, ownerActor, awaiting.revision, exactReply, createdAt + 3)
  assert.equal(Buffer.byteLength(replied.reply!, 'utf8'), 65_536)
  assert.throws(() => shareProxyReply(awaiting, ownerActor, awaiting.revision, `${exactReply}💬`, createdAt + 3))
})

test('same-organization different people remain separate parties; one person cannot appear under two tenant anchors', () => {
  const sharedTenant = 'organization-example'
  const sameOrg = createProxyRequest(input({
    requester: { ...requester, tenantId: sharedTenant },
    owner: { ...owner, tenantId: sharedTenant },
  }))
  assert.ok(proxyRequestView(sameOrg, { tenantId: sharedTenant, userId: requester.userId }))
  assert.ok(proxyRequestView(sameOrg, { tenantId: sharedTenant, userId: owner.userId }))
  assert.equal(proxyRequestView(sameOrg, { tenantId: sharedTenant, userId: 'another-member' }), undefined)
  assert.throws(() => createProxyRequest(input({ owner: { ...owner, userId: requester.userId } })))
})

test('pure state kernel has no runtime, store, authentication, or route dependency', () => {
  const source = readFileSync(new URL('./proxyRequestState.ts', import.meta.url), 'utf8')
  function check(text: string): void {
    const parsed = ts.createSourceFile('proxyRequestState.ts', text, ts.ScriptTarget.Latest, true)
    const imports = parsed.statements.filter(ts.isImportDeclaration)
    assert.ok(imports.length > 0, 'the boundary lock must observe imports')
    const valueImports = imports.filter(node => !node.importClause?.isTypeOnly).map(node => {
      assert.ok(ts.isStringLiteral(node.moduleSpecifier))
      return node.moduleSpecifier.text
    }).sort()
    assert.deepEqual(valueImports, ['../contract/agentRequests.ts', './mcpBoundCall.ts', './mcpJson.ts', './mcpToolResult.ts', './proxyArgumentDraftState.ts', './proxyReplyDraftState.ts', 'node:crypto'].sort(),
      'only portable contract limits, deterministic crypto and inert MCP/draft receipt parsing helpers may be loaded at runtime')
    function visit(node: ts.Node): void {
      assert.equal(ts.isImportEqualsDeclaration(node), false, 'no import-equals runtime escape')
      if (ts.isExportDeclaration(node) && node.moduleSpecifier) assert.equal(node.isTypeOnly, true, 'no runtime re-exports')
      if (ts.isCallExpression(node)) {
        assert.notEqual(node.expression.kind, ts.SyntaxKind.ImportKeyword, 'no dynamic imports')
        if (ts.isIdentifier(node.expression)) assert.notEqual(node.expression.text, 'require', 'no require runtime escape')
      }
      ts.forEachChild(node, visit)
    }
    visit(parsed)
  }
  check(source)
  for (const extra of [
    'import {\nreadFileSync\n} from "node:fs"',
    'import "./mcpBoundExecution.ts"',
    'export {\ncreateBoundMcpExecution\n} from "./mcpBoundExecution.ts"',
    'void import\n("./mcpBoundExecution.ts")',
    'import filesystem = require("node:fs")',
    'require("node:fs")',
  ]) {
    assert.throws(() => check(`${source}\n${extra}`), `the lock must reject ${extra}`)
  }
})

test('creation, approval, execution, reply text, and outcome enforce bounds and detach nested payloads', () => {
  const badInput = (overrides: Record<string, unknown>) => assert.throws(() => createProxyRequest(input(overrides)))
  badInput({ task: ' \n ' })
  badInput({ task: 'x'.repeat(8193) })
  badInput({ id: 'agent-request-ABC' + 'a'.repeat(29) })
  badInput({ requester: { ...requester, userId: owner.userId } })
  badInput({ owner: { ...owner, agentId: requester.agentId } })

  const originalCall = call()
  const approval = { transport: 'http' as const, call: originalCall }
  const pending = beginProxyRequest(createProxyRequest(input()), ownerActor, 1, approval, createdAt + 1)
  originalCall.arguments.invoice = 'MUTATED AFTER APPROVAL'
  approval.call.toolName = 'MUTATED AFTER APPROVAL'
  assert.equal(pending.execution?.approval.call.arguments.invoice, 'INV-42')
  assert.equal(pending.execution?.approval.call.toolName, 'invoice_lookup')

  const settled = settleProxyRequest(pending, pending.execution!.callHash, outcome(), createdAt + 2)
  const view = proxyRequestView(settled, ownerActor)!
  view.execution!.approval.call.arguments.invoice = 'MUTATED THROUGH VIEW'
  assert.equal(settled.execution?.approval.call.arguments.invoice, 'INV-42')

  const maxReply = 'r'.repeat(65_536)
  assert.throws(() => shareProxyReply(settled, ownerActor, 3, ' \t ', createdAt + 3))
  assert.throws(() => shareProxyReply(settled, ownerActor, 3, 'r'.repeat(65_537), createdAt + 3))
  assert.throws(() => shareProxyReply(settled, ownerActor, 3, `bad\uD800`, createdAt + 3))
  assert.equal(shareProxyReply(settled, ownerActor, 3, maxReply, createdAt + 3).reply, maxReply)

  const failed = settleProxyRequest(pending, pending.execution!.callHash, outcome('failed'), createdAt + 2)
  assert.equal(failed.execution?.status, 'failed')
  const uncertain = settleProxyRequest(pending, pending.execution!.callHash, outcome('uncertain'), createdAt + 2)
  assert.equal(uncertain.execution?.status, 'uncertain')
})
