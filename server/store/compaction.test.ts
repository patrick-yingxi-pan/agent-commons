/** Store locks for model-backed conversation compaction. The store owns only the
 * immutable preparation and compare-before-commit transaction; model generation
 * is locked at its boundary and through the HTTP route. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from './index.ts'
import { ConflictError } from '../conflict.ts'

const BIG = 'This is a reasonably long conversational message carrying real token weight. '.repeat(120)

function append(sessionId: string, n: number, prefix = 'turn'): void {
  for (let i = 0; i < n; i += 1) {
    const role = i % 2 ? 'assistant' : 'user'
    store.appendMessage(sessionId, { id: store.mintMessageId(role), role, content: `${BIG} ${prefix}-${i}` })
  }
}

function ready(sessionId: string) {
  const plan = store.prepareSessionCompaction(sessionId)
  assert.ok(plan && plan.kind === 'ready', 'the thread has a compaction preparation')
  return plan
}

test('compaction commits the generated brief, archives originals, and drops context usage', () => {
  const session = store.createSession('compaction transaction')
  append(session.id, 12)
  const before = store.usage(session.id).context.pct
  const plan = ready(session.id)
  const content = '## Working memory\n\n- We chose the release plan.\n- Next: verify the signed artifact.'

  const compacted = store.applySessionCompaction(plan, content, {
    agentId: 'agent-default',
    providerId: 'provider-default',
    modelId: 'model-test',
  })!

  assert.equal(compacted.messages.length, 5, 'one brief + four recent turns')
  assert.equal(compacted.messages[0].content, content, 'the model-authored brief is canonical')
  assert.equal(compacted.messages[0].compactedFrom, 8)
  assert.equal(compacted.messages[0].providerId, 'provider-default', 'summary provenance survives')
  assert.equal(compacted.compactedMessages?.length, 8, 'every replaced real turn remains archived')
  assert.ok(store.usage(session.id).context.pct < before, 'active context shrinks after commit')
})

test('re-compaction summarizes the prior brief with new older turns but never archives the synthetic marker', () => {
  const session = store.createSession('re-compaction transaction')
  append(session.id, 12, 'first')
  store.applySessionCompaction(ready(session.id), 'First factual brief')

  append(session.id, 6, 'second')
  const secondPlan = ready(session.id)
  assert.equal(secondPlan.sourceMessages[0].content, 'First factual brief', 'the previous brief carries context into the next summary')
  assert.ok(secondPlan.sourceMessages[0].compactedFrom, 'the source identifies the synthetic prior brief')
  assert.ok(secondPlan.archiveMessages.every((message) => message.compactedFrom == null), 'only real messages will enter the archive')

  const compacted = store.applySessionCompaction(secondPlan, 'Second cumulative factual brief')!
  assert.equal(compacted.messages.filter((message) => message.compactedFrom != null).length, 1)
  assert.ok(!compacted.compactedMessages?.some((message) => message.compactedFrom != null))
  assert.equal(compacted.messages[0].compactedFrom, 14, 'the archived real-message count is cumulative')
})

test('a transcript change during summary generation refuses the commit without moving history', () => {
  const session = store.createSession('compaction race')
  append(session.id, 8)
  const plan = ready(session.id)
  const concurrent = { id: store.mintMessageId('user'), role: 'user' as const, content: 'A newer device added this turn.' }
  store.appendMessage(session.id, concurrent)

  assert.throws(
    () => store.applySessionCompaction(plan, 'Stale summary'),
    (error: unknown) => error instanceof ConflictError && /changed while/i.test(error.message),
  )
  const after = store.getSession(session.id)!
  assert.equal(after.messages.at(-1)?.id, concurrent.id, 'the concurrent turn remains authoritative')
  assert.equal(after.compactedMessages, undefined, 'no original was archived on conflict')
})

test('a short session prepares a no-op and an unknown session remains absent', () => {
  const session = store.createSession('short compaction')
  store.appendMessage(session.id, { id: store.mintMessageId('user'), role: 'user', content: 'hi' })
  const prepared = store.prepareSessionCompaction(session.id)
  assert.equal(prepared?.kind, 'noop')
  assert.ok(!(prepared?.kind === 'noop' ? prepared.session.messages : []).some((message) => message.compactedFrom))
  assert.equal(store.prepareSessionCompaction('nope-not-a-session'), undefined)
})
