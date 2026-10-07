import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CONVERSATION_SEARCH_PAGE_SIZE,
  MAX_CONVERSATION_SEARCH_QUERY_CHARS,
  parseConversationSearchQuery,
  searchConversationMessages,
} from './conversationSearch.ts'

test('conversation search normalizes literal queries and rejects malformed paging', () => {
  assert.deepEqual(parseConversationSearchQuery('  MiXeD  ', undefined), { query: 'mixed', offset: 0 })
  assert.deepEqual(parseConversationSearchQuery('', '0'), { query: '', offset: 0 })
  for (const offset of ['-1', '+1', '01', '1.0', '1e2', '9007199254740992']) {
    assert.equal(parseConversationSearchQuery('x', offset), null, `reject ${offset}`)
  }
  assert.equal(parseConversationSearchQuery(undefined, undefined), null)
  assert.equal(parseConversationSearchQuery('x'.repeat(MAX_CONVERSATION_SEARCH_QUERY_CHARS + 1), undefined), null)
})

test('conversation search pages chronological literal matches and bounds centered snippets', () => {
  const messages = Array.from({ length: CONVERSATION_SEARCH_PAGE_SIZE + 2 }, (_, index) => ({
    id: `m${index}`,
    role: index % 2 ? 'assistant' : 'user',
    content: `prefix ${index} Needle suffix`,
  }))
  messages.push({ id: 'regex', role: 'user', content: 'needlex' })
  const first = searchConversationMessages(messages, 'needle', 0)
  assert.equal(first.total, CONVERSATION_SEARCH_PAGE_SIZE + 3)
  assert.equal(first.hits.length, CONVERSATION_SEARCH_PAGE_SIZE)
  assert.equal(first.hits[0].messageId, 'm0')
  assert.equal(first.hits[0].role, 'user')
  assert.equal(first.hits[0].snippet.includes('Needle'), true)
  const next = searchConversationMessages(messages, 'needle', 20)
  assert.deepEqual(next.hits.map((hit) => hit.messageId), ['m20', 'm21', 'regex'])
  assert.equal(searchConversationMessages(messages, 'needl.', 0).total, 0, 'query metacharacters are literal')
})

test('conversation search returns no matches for an empty normalized query', () => {
  assert.deepEqual(searchConversationMessages([{ id: 'm', role: 'user', content: 'secret' }], '', 0), {
    query: '', offset: 0, total: 0, hits: [],
  })
})

test('a maximum-length query stays whole in a bounded snippet with a long prefix', () => {
  const query = 'q'.repeat(MAX_CONVERSATION_SEARCH_QUERY_CHARS)
  const content = `${'prefix '.repeat(100)}${query}${' suffix'.repeat(100)}`
  const result = searchConversationMessages([{ id: 'max', role: 'user', content }], query, 0)
  assert.equal(result.total, 1)
  assert.ok(result.hits[0].snippet.includes(query), 'the full query is present in its snippet')
  assert.ok(result.hits[0].snippet.length <= 320)
})

test('lowercase expansion before a match does not shift its original snippet location', () => {
  const content = `${'İ'.repeat(100)}${'a'.repeat(100)}needle${'b'.repeat(500)}`
  const result = searchConversationMessages([{ id: 'unicode', role: 'assistant', content }], 'needle', 0)
  assert.equal(result.total, 1)
  assert.ok(result.hits[0].snippet.includes('needle'))
  assert.ok(result.hits[0].snippet.length <= 320)
})

test('matching uses whole-string lowercase semantics and maps expanded matches to source spans', () => {
  const finalSigma = searchConversationMessages([{ id: 'greek', role: 'user', content: 'ΟΣ' }], 'ος', 0)
  assert.equal(finalSigma.total, 1, 'whole-string lowercasing preserves context-sensitive final sigma')

  const expanded = searchConversationMessages([{ id: 'dotted-i', role: 'assistant', content: 'İ and more text' }], 'i\u0307', 0)
  assert.equal(expanded.total, 1)
  assert.ok(expanded.hits[0].snippet.startsWith('İ'), 'both lowered units map to the original source character')
})
