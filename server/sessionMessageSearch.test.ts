import { test } from 'node:test'
import assert from 'node:assert/strict'
import { searchSessionMessages } from './sessionMessageSearch.ts'

test('session search uses only current user and assistant content', () => {
  const session = {
    messages: [
      { id: 'user', role: 'user', content: 'needle in a user turn' },
      { id: 'assistant', role: 'assistant', content: 'needle in a reply', toolActivities: [{ name: 'needle-tool' }] },
      { id: 'tool', role: 'tool', content: 'needle in tool output' },
    ],
    compactedMessages: [{ id: 'old', role: 'assistant', content: 'needle in compacted history' }],
  } as any
  assert.deepEqual(searchSessionMessages(session, 'needle', 0).hits.map((hit) => hit.messageId), ['user', 'assistant'])
})

test('session search snippets are bounded and retain the match', () => {
  const content = `${'a'.repeat(400)} Needle ${'b'.repeat(400)}`
  const result = searchSessionMessages({ messages: [{ id: 'long', role: 'assistant', content }] } as any, 'needle', 0)
  assert.ok(result.hits[0].snippet.length <= 320)
  assert.ok(result.hits[0].snippet.toLowerCase().includes('needle'))
})
