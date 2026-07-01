/** Context-window compaction (P5 / BROKER-EXP-3). Server-owned: `store.compactSession`
 *  moves all but the last KEEP_RECENT messages into the `compactedMessages` archive and
 *  leaves a small summary marker in `messages`, so the token count — and the usage gauge's
 *  context % (GET /v1/usage) — drops back. Non-destructive (the archive keeps the detail)
 *  and idempotent-ish (a no-op on a short thread). The route wiring reuses the shared
 *  `denyForeignSession` tenant guard proven in tests/capability-remote.test.ts. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../server/store.ts'

const BIG = 'This is a reasonably long conversational message carrying real token weight. '.repeat(120)

test('compactSession archives older messages behind a summary + drops the context %', () => {
  const s = store.createSession('compaction thread')
  for (let i = 0; i < 12; i++) {
    const role = i % 2 ? 'assistant' : 'user'
    store.appendMessage(s.id, { id: store.mintMessageId(role), role, content: `${BIG} #${i}` })
  }
  const before = store.usage(s.id).context.pct
  assert.ok((store.getSession(s.id).messages ?? []).length >= 12, 'the thread has many messages')

  const compacted = store.compactSession(s.id)
  assert.ok(compacted, 'compaction ran')
  const after = store.getSession(s.id)

  // messages collapse to the summary marker + the last KEEP_RECENT (4) recent.
  assert.equal(after.messages.length, 5, 'summary + 4 recent')
  const summary = after.messages[0]
  assert.ok((summary.compactedFrom ?? 0) >= 1, 'the summary marks how many messages it replaced')
  // Non-destructive: the older messages are archived, count matches the marker.
  assert.equal((after.compactedMessages ?? []).length, summary.compactedFrom, 'archived count matches the marker')
  // The freed-space payoff: the context % dropped.
  assert.ok(store.usage(s.id).context.pct < before, `context % dropped (${before} → ${store.usage(s.id).context.pct})`)
})

test('compactSession is a no-op on a short session (nothing worth compacting)', () => {
  const s = store.createSession('short thread')
  store.appendMessage(s.id, { id: store.mintMessageId('user'), role: 'user', content: 'hi' })
  const r = store.compactSession(s.id)
  assert.ok(r, 'returns the session')
  assert.ok(!(r.messages ?? []).some((m) => m.compactedFrom), 'no summary added')
  assert.ok(!r.compactedMessages, 'nothing archived')
})

test('compactSession on an unknown session returns undefined', () => {
  assert.equal(store.compactSession('nope-not-a-session'), undefined)
})
