import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MAX_CONVERSATION_EXPORT_BYTES } from './conversationExport.ts'
import type { ConversationExport } from './conversationExport.ts'

test('conversation Markdown export contract is a bounded UTF-8 transcript descriptor', () => {
  assert.equal(MAX_CONVERSATION_EXPORT_BYTES, 8 * 1024 * 1024)
  const descriptor: ConversationExport = {
    sessionId: 'session-1',
    filename: 'Conversation.md',
    mediaType: 'text/markdown;charset=utf-8',
    content: '# Conversation\n',
    messageCount: 0,
    archivedMessageCount: 0,
  }
  assert.deepEqual(Object.keys(descriptor).sort(), [
    'archivedMessageCount', 'content', 'filename', 'mediaType', 'messageCount', 'sessionId',
  ])
})
