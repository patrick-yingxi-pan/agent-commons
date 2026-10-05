import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { canSeedConversationFromCache, createConversationStore } from './conversationCore.ts'
import { EMPTY_LIVE } from '../data/liveSession.ts'

test('a conversation pane seeds only exact account-scoped API truth, never bundled demo transcripts', () => {
  const source = readFileSync(new URL('./usePaneConversation.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /import.*SESSIONS|data\/sessions/)
  assert.match(source, /peek<Session>\(keys.session\(sessionId\)\)/)
  assert.match(source, /seed\?\.id === sessionId/)
  assert.match(source, /if \(canSeedConversationFromCache\(entry\)\)/)
})

test('pane remount cannot reseed an authoritative empty conversation or erase held operations', () => {
  const store = createConversationStore({ sendMessage: async () => {}, cancelTurn: async () => {} }, () => EMPTY_LIVE)
  const blank = store.get('empty')
  assert.equal(canSeedConversationFromCache(blank), true, 'a first untouched paint may use exact cached truth')
  for (const [label, patch] of [
    ['reconciled empty session', { reconciled: true }],
    ['pending context', { contextMutation: { busy: true, error: null, retryable: false } }],
    ['failed context', { contextMutation: { busy: false, error: 'unconfirmed', retryable: true } }],
    ['unsent draft', { composerText: 'keep me' }],
    ['pending turn', { busy: true }],
    ['typing turn', { typing: true }],
    ['selected context', { focus: { kind: 'file', id: 'saved-file' } }],
    ['failed send', { sendFailure: 'keep the refusal' }],
    ['send retry', { retryableSend: { text: 'retry', idempotencyKey: 'same-intent' } }],
    ['held escalation', { pendingEscalation: { messageId: 'proposal', escalation: {} } }],
  ]) assert.equal(canSeedConversationFromCache({ ...blank, ...patch }), false, label)
})
