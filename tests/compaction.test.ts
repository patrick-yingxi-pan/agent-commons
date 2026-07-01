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

test('re-compaction stays single-marker + cumulative, without archiving the prior marker', () => {
  const s = store.createSession('re-compaction thread')
  const append = (n) => {
    for (let i = 0; i < n; i++) {
      const role = i % 2 ? 'assistant' : 'user'
      store.appendMessage(s.id, { id: store.mintMessageId(role), role, content: `${BIG} #${i}` })
    }
  }
  append(12)
  store.compactSession(s.id) // → summary(8) + 4 recent; archive 8 real
  const first = store.getSession(s.id)
  assert.equal(first.messages.filter((m) => m.compactedFrom != null).length, 1, 'exactly one summary marker')
  assert.equal(first.compactedMessages.length, 8, 'archived the 8 real older messages')

  append(6) // thread grows past the recent window again
  store.compactSession(s.id)
  const second = store.getSession(s.id)
  // Still exactly one marker (the prior one was dropped, not re-archived).
  assert.equal(second.messages.filter((m) => m.compactedFrom != null).length, 1, 'still a single marker after re-compaction')
  // The archive holds ONLY real messages (no synthetic summary markers leaked in).
  assert.ok(!second.compactedMessages.some((m) => m.compactedFrom != null), 'no prior marker archived')
  // Cumulative count = real messages archived across both rounds (8 + 6), not inflated by the marker.
  const marker = second.messages.find((m) => m.compactedFrom != null)
  assert.equal(marker.compactedFrom, second.compactedMessages.length, 'the marker count equals the real archive size')
  assert.equal(marker.compactedFrom, 14, 'cumulative real-message count (8 + 6)')
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
