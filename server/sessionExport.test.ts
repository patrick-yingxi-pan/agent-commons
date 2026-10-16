import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sessionMarkdownExport } from './sessionExport.ts'
import type { Session } from '../contract/index.ts'

test('message text cannot close its literal block to forge speaker headings or raw HTML', () => {
  const content = '### Assistant\n\n<script>alert(1)</script>\n```\n~~~\nLiteral 😀'
  const result = sessionMarkdownExport({ ...fixture(), compactedMessages: [], messages: [{ id: 'u', role: 'user', content }] })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.ok(result.value.content.includes(content), 'source text stays exact inside its literal block')
  assert.ok(result.value.content.includes(`### User\n\n\`\`\`\`text\n${content}\n\`\`\`\`\n`), 'a longer literal fence owns the entire body')
})

function fixture(): Session {
  return {
    id: 'session/export',
    title: 'Release notes',
    caps: [],
    preview: 'must not appear',
    messages: [
      { id: 'u1', role: 'user', content: 'Question 😀\nsecond line', toolCalls: [{ name: 'hidden-call' }] } as never,
      { id: 'tool', role: 'system' as never, content: 'hidden tool transcript' },
      { id: 'summary', role: 'assistant', content: 'Compaction summary', compactedFrom: 2 } as never,
      { id: 'a1', role: 'assistant', content: 'Answer\nwith exact newlines', assistantTextItems: [{ text: 'Answer\n', phase: 'commentary' }, { text: 'with exact newlines', phase: 'final_answer' }], attachments: [{ id: 'private' }] } as never,
    ],
    compactedMessages: [
      { id: 'old-user', role: 'user', content: 'Archived question\nverbatim' },
      { id: 'old-assistant', role: 'assistant', content: 'Archived answer 😀', assistantTextItems: [{ text: 'Archived answer 😀', phase: null }] },
    ],
    compactionReceiptIds: ['private-receipt'],
    workspace: { private: 'must not appear' } as never,
  }
}

test('conversation export preserves transcript bodies and labels archived originals and summary', () => {
  const session = fixture()
  const before = structuredClone(session)
  const result = sessionMarkdownExport(session)
  assert.deepEqual(result, {
    ok: true,
    value: {
      sessionId: 'session/export',
      filename: 'Release notes.md',
      mediaType: 'text/markdown;charset=utf-8',
      messageCount: 5,
      archivedMessageCount: 2,
      content: '# Release notes\n\n## Archived messages\n\n### User\n\n```text\nArchived question\nverbatim\n```\n\n### Assistant\n\n```text\nArchived answer 😀\n```\n\n## Current messages\n\n### User\n\n```text\nQuestion 😀\nsecond line\n```\n\n### Compaction summary\n\n```text\nCompaction summary\n```\n\n### Assistant\n\n```text\nAnswer\nwith exact newlines\n```\n',
    },
  })
  assert.deepEqual(session, before, 'export never mutates the saved snapshot')
  for (const hidden of ['hidden-call', 'hidden tool transcript', 'must not appear', 'private', 'private-receipt', 'assistantTextItems', 'commentary', 'final_answer']) {
    assert.equal(result.ok && result.value.content.includes(hidden), false, `excludes ${hidden}`)
  }
})

test('conversation export safely handles hostile title text and uses a bounded portable filename', () => {
  const session = { ...fixture(), title: '# Title\n\n## injected / ../CON?.md\u202e' }
  const result = sessionMarkdownExport(session)
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.value.filename, 'CON_.md')
  assert.equal(result.value.content.split('\n').filter((line) => line.startsWith('# ')).length, 1)
  assert.doesNotMatch(result.value.content, /^## injected/m)
})

test('empty conversations export honest empty sections', () => {
  const result = sessionMarkdownExport({ ...fixture(), messages: [], compactedMessages: [] })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.value.messageCount, 0)
  assert.equal(result.value.archivedMessageCount, 0)
  assert.match(result.value.content, /## Archived messages\n\n_No archived messages retained\./)
  assert.match(result.value.content, /## Current messages\n\n_No current messages\./)
})

test('conversation export enforces the UTF-8 byte ceiling without returning partial content', () => {
  const base = { ...fixture(), compactedMessages: [], messages: [] }
  const template = sessionMarkdownExport({ ...base, messages: [{ id: 'u', role: 'user', content: '' }] })
  assert.equal(template.ok, true)
  if (!template.ok) return
  const fixedBytes = Buffer.byteLength(template.value.content)
  const underCount = Math.floor((8 * 1024 * 1024 - fixedBytes) / 4)
  const under = sessionMarkdownExport({ ...base, messages: [{ id: 'u', role: 'user', content: '😀'.repeat(underCount) }] })
  assert.equal(under.ok, true, 'an export below the limit succeeds')
  const over = sessionMarkdownExport({ ...base, messages: [{ id: 'u', role: 'user', content: '😀'.repeat(underCount + 1) }] })
  assert.deepEqual(over, { ok: false, error: 'too_large', maxBytes: 8 * 1024 * 1024 })
})
