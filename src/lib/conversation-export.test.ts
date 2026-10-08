import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decodeConversationExport } from './conversationExport.ts'
import { MAX_CONVERSATION_EXPORT_BYTES } from '../../contract/conversationExport.ts'

const file = { sessionId: 's1', filename: 'Conversation.md', mediaType: 'text/markdown;charset=utf-8', content: '# Title\n\nExact 😀\n', messageCount: 2, archivedMessageCount: 1 }

test('conversation download admits only an exact bounded portable transcript descriptor', () => {
  assert.deepEqual(decodeConversationExport(file, 's1'), { filename: file.filename, mediaType: file.mediaType, content: file.content })
  for (const changed of [null, [], { ...file, sessionId: 's2' }, { ...file, mediaType: 'text/html' },
    { ...file, content: 1 }, { ...file, messageCount: -1 }, { ...file, messageCount: 1.5 },
    { ...file, archivedMessageCount: 3 }, { ...file, archivedMessageCount: -1 },
    ...['../x.md', 'x.html', 'x\u202e.md', 'CON.md', 'x'.repeat(300) + '.md'].map(filename => ({ ...file, filename }))]) {
    assert.throws(() => decodeConversationExport(changed, 's1'))
  }
})

test('conversation download bounds UTF-8 bytes, not just string length, without truncating', () => {
  const content = '😀'.repeat(MAX_CONVERSATION_EXPORT_BYTES / 4)
  assert.equal(decodeConversationExport({ ...file, content }, 's1').content, content)
  assert.throws(() => decodeConversationExport({ ...file, content: content + 'a' }, 's1'))
  assert.throws(() => decodeConversationExport({ ...file, content: 'a'.repeat(MAX_CONVERSATION_EXPORT_BYTES + 1) }, 's1'))
})
