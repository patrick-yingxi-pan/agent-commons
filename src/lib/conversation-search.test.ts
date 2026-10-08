import { test } from 'node:test'
import assert from 'node:assert/strict'
import { conversationFocusState, conversationSearchMatches } from './conversationSearch.ts'

test('only the current query and page can expose actionable conversation hits', () => {
  const answer = { query: 'needle', offset: 20, total: 21, hits: [] }
  assert.equal(conversationSearchMatches(answer, ' Needle ', 20), true)
  assert.equal(conversationSearchMatches(answer, 'new query', 20), false)
  assert.equal(conversationSearchMatches(answer, 'needle', 0), false)
  assert.equal(conversationSearchMatches(undefined, 'needle', 20), false)
})

test('turn navigation distinguishes loaded, unloaded, interrupted and missing messages', () => {
  const messages = [{ id: 'found' }]
  const idle = { loading: false, error: null, olderCursor: null }
  assert.equal(conversationFocusState(undefined, messages, idle), 'none')
  assert.equal(conversationFocusState('found', messages, idle), 'ready')
  assert.equal(conversationFocusState('old', messages, { ...idle, olderCursor: 'opaque' }), 'loading')
  assert.equal(conversationFocusState('old', messages, { ...idle, loading: true }), 'loading')
  assert.equal(conversationFocusState('old', messages, { ...idle, error: 'read failed' }), 'error')
  assert.equal(conversationFocusState('old', messages, idle), 'missing')
  assert.equal(conversationFocusState('old', messages), 'missing')
  assert.equal(conversationFocusState('found', messages, { ...idle, error: 'unrelated earlier read' }), 'ready')
})

test('an initial pane read stays pending, reports its failure, then reserves missing for authoritative absence', () => {
  const messages = [{ id: 'other' }]
  const idle = { loading: false, error: null, olderCursor: null }
  assert.equal(conversationFocusState('target', messages, idle, { reconciled: false }), 'loading')
  assert.equal(conversationFocusState('target', messages, idle, { reconciled: false, error: 'offline' }), 'initial-error')
  assert.equal(conversationFocusState('target', messages, idle, { reconciled: true }), 'missing')
})
