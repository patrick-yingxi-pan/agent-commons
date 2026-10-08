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

test('initial-read Retry reuses the fenced pane recipe and stale failures cannot publish', () => {
  const source = readFileSync(new URL('./usePaneConversation.ts', import.meta.url), 'utf8')
  assert.match(source, /setReadRetry\(\(attempt\) => attempt \+ 1\)/)
  assert.match(source, /\}, \[sessionId, readRetry\]\)/, 'Retry re-enters the ordinary mount read recipe')
  assert.match(source, /if \(!conversations\.isPaneReadCurrent\(sessionId, receipt\)\) return[\s\S]*?conversations\.setPaneReadError\(sessionId, receipt, message\)/)
  assert.match(source, /retryInitialRead,/, 'the pane exposes an explicit retry command')
})

test('initial read failures are shared across panes but only the latest unreconciled receipt can publish', () => {
  const store = createConversationStore({ sendMessage: async () => {}, cancelTurn: async () => {} }, () => EMPTY_LIVE)
  const first = store.beginPaneRead('s')
  const latest = store.beginPaneRead('s')
  assert.equal(store.setPaneReadError('s', first, 'stale failure'), false)
  assert.equal(store.get('s').initialReadError, null)
  assert.equal(store.setPaneReadError('s', latest, 'offline'), true)
  assert.equal(store.get('s').initialReadError, 'offline')
  assert.equal(store.reconcile('s', latest, EMPTY_LIVE), true)
  assert.equal(store.get('s').initialReadError, null, 'successful shared reconciliation clears the error')
  const afterReconcile = store.beginPaneRead('s')
  assert.equal(store.setPaneReadError('s', afterReconcile, 'late failure'), false)
  assert.equal(store.get('s').initialReadError, null, 'a later failed refresh cannot poison reconciled history')
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
