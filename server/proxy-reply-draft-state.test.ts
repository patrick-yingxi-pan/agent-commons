import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AGENT_REQUEST_REPLY_DRAFT_MAX_BYTES, AGENT_REQUEST_REPLY_NOTES_MAX_BYTES } from '../contract/agentRequests.ts'
import {
  beginProxyReplyDraft,
  beginProxyArgumentDraft,
  settleProxyArgumentDraft,
  settleProxyReplyDraft,
  createProxyRequest,
  beginProxyRequest,
  settleProxyRequest,
  shareProxyReply,
  cancelProxyRequest,
  denyProxyRequest,
  parseStoredProxyRequest,
  proxyRequestView,
} from './proxyRequestState.ts'
import type { McpBoundToolCall } from '../contract/mcpExecution.ts'

const requester = { tenantId: 'tenant-a', userId: 'person-a', agentId: 'agent-a' }
const owner = { tenantId: 'tenant-b', userId: 'person-b', agentId: 'agent-b' }
const requesterActor = { tenantId: requester.tenantId, userId: requester.userId }
const ownerActor = { tenantId: owner.tenantId, userId: owner.userId }
const outsider = { tenantId: owner.tenantId, userId: 'person-outsider' }
const createdAt = 1_000
const binding = { agentRevision: 4, providerId: 'provider-b', providerRevision: 2,
  providerConnectionRevision: 7, model: 'configured-model' }
const hash = 'c'.repeat(64)
function row() {
  return createProxyRequest({ id: `agent-request-${'a'.repeat(32)}`, requester, owner,
    task: 'Answer this request.', createdAt })
}
function call(): McpBoundToolCall { return { connectionId: `mcp-connection-${'b'.repeat(32)}`, connectionRevision: 1,
  toolName: 'lookup', schemaHash: 'b'.repeat(64), arguments: {} } }
function awaiting() {
  const running = beginProxyRequest(row(), ownerActor, 1, { transport: 'http', call: call() }, createdAt + 1)
  return settleProxyRequest(running, running.execution!.callHash, { status: 'uncertain', summary: '' }, createdAt + 2)
}

test('reply draft contract bounds, ownership, lifecycle, projection, and separate Share', () => {
  assert.equal(AGENT_REQUEST_REPLY_DRAFT_MAX_BYTES, 32 * 1_024)
  assert.equal(AGENT_REQUEST_REPLY_NOTES_MAX_BYTES, 8 * 1_024)
  assert.throws(() => beginProxyReplyDraft(row(), requesterActor, 1, binding, hash, '', createdAt + 1))
  assert.throws(() => beginProxyReplyDraft(row(), outsider, 1, binding, hash, '', createdAt + 1))
  assert.throws(() => beginProxyReplyDraft(row(), ownerActor, 0, binding, hash, '', createdAt + 1))
  assert.throws(() => beginProxyReplyDraft(row(), ownerActor, 1, { ...binding, model: '' }, hash, '', createdAt + 1))
  assert.throws(() => beginProxyReplyDraft(row(), ownerActor, 1, binding, 'bad-hash', '', createdAt + 1))
  assert.throws(() => beginProxyReplyDraft(row(), ownerActor, 1, binding, hash, 'x'.repeat(AGENT_REQUEST_REPLY_NOTES_MAX_BYTES + 1), createdAt + 1))

  const pending = beginProxyReplyDraft(row(), ownerActor, 1, binding, hash, '', createdAt + 1)
  assert.equal(pending.revision, 2)
  assert.equal(pending.replyDraft?.status, 'pending')
  assert.equal(pending.replyDraft?.binding.model, binding.model)
  assert.equal(JSON.stringify(pending).includes('notes'), false, 'owner notes are not persisted')
  assert.throws(() => beginProxyReplyDraft(pending, ownerActor, 2, binding, hash, '', createdAt + 2), 'only one reply attempt')
  assert.throws(() => shareProxyReply(pending, ownerActor, 2, 'No share while pending.', createdAt + 2))

  const done = settleProxyReplyDraft(pending, hash, { status: 'done', text: 'Suggested answer for review.' }, createdAt + 2)
  assert.equal(done.revision, 3)
  assert.equal(done.replyDraft?.status, 'done')
  const ownerView = proxyRequestView(done, ownerActor)!
  const requesterView = proxyRequestView(done, requesterActor)!
  assert.equal(ownerView.replyDraft?.text, 'Suggested answer for review.')
  assert.equal(Object.hasOwn(requesterView, 'replyDraft'), false)
  assert.equal(JSON.stringify(requesterView).includes('Suggested answer'), false)
  assert.throws(() => beginProxyReplyDraft(done, ownerActor, done.revision, binding, 'd'.repeat(64), '', createdAt + 3),
    'the terminal receipt cannot be rerun')

  const shared = shareProxyReply(done, ownerActor, done.revision, 'Edited after adoption and reviewed.', createdAt + 3)
  assert.equal(shared.status, 'replied')
  assert.equal(shared.reply, 'Edited after adoption and reviewed.')
  assert.equal(shared.replySource, 'direct')
  assert.equal(shared.replyDraft?.text, 'Suggested answer for review.', 'draft remains private history, not the shared reply')
  assert.deepEqual(parseStoredProxyRequest(shared), shared)
})

test('reply drafting is allowed while awaiting reply, but tool/argument work and restore fences block it', () => {
  const waiting = row()
  const running = beginProxyRequest(waiting, ownerActor, 1, { transport: 'http', call: call() }, createdAt + 1)
  assert.throws(() => beginProxyReplyDraft(running, ownerActor, running.revision, binding, hash, '', createdAt + 2))
  const awaitingRow = awaiting()
  const pending = beginProxyReplyDraft(awaitingRow, ownerActor, awaitingRow.revision, binding, hash, 'brief notes', createdAt + 3)
  assert.equal(pending.status, 'awaiting-reply')
  assert.equal(pending.revision, awaitingRow.revision + 1)
  assert.throws(() => beginProxyReplyDraft(parseStoredProxyRequest({ ...waiting, executionBlockedByRestore: true }),
    ownerActor, waiting.revision, binding, hash, '', createdAt + 1))
  assert.throws(() => beginProxyReplyDraft({ ...waiting, argumentDraft: {
    revision: 1, status: 'pending', binding: { ...binding, connectionId: `mcp-connection-${'b'.repeat(32)}`, connectionRevision: 1,
      toolName: 'lookup', schemaHash: 'b'.repeat(64), transport: 'http' }, inputHash: hash, startedAt: createdAt + 1,
  } } as never, ownerActor, 2, binding, hash, '', createdAt + 2))

  const pendingFromWaiting = beginProxyReplyDraft(waiting, ownerActor, waiting.revision, binding, 'd'.repeat(64), '', createdAt + 1)
  assert.throws(() => beginProxyArgumentDraft(pendingFromWaiting, ownerActor, pendingFromWaiting.revision, {
    agentRevision: 1, providerId: 'provider-b', providerRevision: 1, providerConnectionRevision: 1,
    model: 'model-b', connectionId: `mcp-connection-${'b'.repeat(32)}`, connectionRevision: 1,
    toolName: 'lookup', schemaHash: 'b'.repeat(64), transport: 'http',
  }, 'e'.repeat(64), createdAt + 2), 'a pending reply draft excludes argument drafting')
  assert.throws(() => denyProxyRequest(pendingFromWaiting, ownerActor, pendingFromWaiting.revision, createdAt + 2),
    'decline remains blocked until the pending private draft settles or the request is cancelled')
  assert.throws(() => beginProxyRequest(pendingFromWaiting, ownerActor, pendingFromWaiting.revision,
    { transport: 'http', call: call() }, createdAt + 2))
})

test('reply draft cancellation preserves the cancellation and late private result; recovery never replays', () => {
  const pending = beginProxyReplyDraft(row(), ownerActor, 1, binding, hash, '', createdAt + 1)
  const cancelled = cancelProxyRequest(pending, requesterActor, pending.revision, createdAt + 2)
  const late = settleProxyReplyDraft(cancelled, hash, { status: 'done', text: 'Late private answer.' }, createdAt + 3)
  assert.equal(late.status, 'cancelled')
  assert.equal(late.replyDraft?.text, 'Late private answer.')
  assert.equal(proxyRequestView(late, requesterActor)?.replyDraft, undefined)
  assert.equal(proxyRequestView(late, ownerActor)?.replyDraft?.text, 'Late private answer.')
})

test('reply-draft parser rejects malformed lifecycle, mixed drafts, and excess text', () => {
  const pending = beginProxyReplyDraft(row(), ownerActor, 1, binding, hash, '', createdAt + 1)
  const done = settleProxyReplyDraft(pending, hash, { status: 'done', text: 'Draft.' }, createdAt + 2)
  const reject = (patch: Record<string, unknown>) => assert.throws(() => parseStoredProxyRequest({ ...done, replyDraft: patch }))
  reject({ ...done.replyDraft, unexpected: true })
  reject({ ...done.replyDraft, inputHash: 'not-hash' })
  reject({ ...done.replyDraft, binding: { ...binding, providerConnectionRevision: -1 } })
  reject({ ...done.replyDraft, text: 'x'.repeat(AGENT_REQUEST_REPLY_DRAFT_MAX_BYTES + 1) })
  reject({ ...done.replyDraft, text: 'bad\u0000text' })
  reject({ ...done.replyDraft, status: 'pending', revision: 1, finishedAt: undefined, text: undefined })
  assert.throws(() => settleProxyReplyDraft(pending, 'd'.repeat(64), { status: 'uncertain' }, createdAt + 2))
  assert.throws(() => settleProxyReplyDraft(pending, hash, { status: 'done', text: 'x'.repeat(AGENT_REQUEST_REPLY_DRAFT_MAX_BYTES + 1) }, createdAt + 2))
  const maximumEscapedText = '\\"'.repeat(AGENT_REQUEST_REPLY_DRAFT_MAX_BYTES / 2)
  assert.equal(Buffer.byteLength(maximumEscapedText, 'utf8'), AGENT_REQUEST_REPLY_DRAFT_MAX_BYTES)
  assert.equal(settleProxyReplyDraft(pending, hash, { status: 'done', text: maximumEscapedText }, createdAt + 2).replyDraft?.text,
    maximumEscapedText, 'maximum-length quote/backslash prose remains lossless after detached JSON accounting')
})

test('reply-draft revision accounting composes with historical argument drafts and later tool execution', () => {
  const waiting = row()
  const argument = beginProxyArgumentDraft(waiting, ownerActor, 1, {
    ...binding, connectionId: `mcp-connection-${'b'.repeat(32)}`, connectionRevision: 1,
    toolName: 'lookup', schemaHash: 'b'.repeat(64), transport: 'http' as const,
  }, 'd'.repeat(64), createdAt + 1)
  const argumentDone = settleProxyArgumentDraft(argument, 'd'.repeat(64), { status: 'failed' }, createdAt + 2)
  const reply = beginProxyReplyDraft(argumentDone, ownerActor, argumentDone.revision, binding, 'e'.repeat(64), '', createdAt + 3)
  const replyDone = settleProxyReplyDraft(reply, 'e'.repeat(64), { status: 'done', text: 'A possible reply.' }, createdAt + 4)
  assert.equal(replyDone.revision, 5)
  const running = beginProxyRequest(replyDone, ownerActor, replyDone.revision,
    { transport: 'http', call: call() }, createdAt + 5)
  assert.equal(running.revision, 6)
  const finished = settleProxyRequest(running, running.execution!.callHash,
    { status: 'uncertain', summary: '' }, createdAt + 6)
  assert.equal(finished.revision, 7)
  const shared = shareProxyReply(finished, ownerActor, finished.revision, 'Final reviewed response.', createdAt + 7)
  assert.equal(shared.revision, 8)
  assert.equal(shared.replyDraft?.text, 'A possible reply.')
  assert.equal(shared.argumentDraft?.status, 'failed')
  assert.deepEqual(parseStoredProxyRequest(shared), shared)
  assert.throws(() => parseStoredProxyRequest({ ...shared, revision: shared.revision - 1 }),
    'phase revisions include both independent terminal draft receipts')
})
