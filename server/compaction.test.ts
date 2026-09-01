import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Message } from '../contract/index.ts'
import { CompactionGenerationError, compactionSource, summarizeConversation } from './compaction.ts'

test('hierarchical compaction presents every source byte and aggregates every model call', async () => {
  const messages: Message[] = [
    { id: 'source-a', role: 'user', content: `Decision A ${'a'.repeat(4_600)}` },
    { id: 'source-b', role: 'assistant', content: `Open work B ${'b'.repeat(4_600)}`, providerId: 'provider-b' },
  ]
  const observedParts: string[] = []
  let calls = 0
  const result = await summarizeConversation(messages, async (prompt) => {
    calls += 1
    const source = prompt.match(/<untrusted_conversation_source[^>]*>\n([\s\S]*?)\n<\/untrusted_conversation_source>/)?.[1]
    if (source !== undefined) observedParts.push(source)
    return {
      text: source === undefined ? '## Final\n\n- Decision A\n- Open work B' : `partial-${calls}`,
      usage: { inputTokens: calls, outputTokens: calls * 2 },
    }
  }, { chunkChars: 4_000, maxCalls: 8 })

  assert.equal(observedParts.join(''), compactionSource(messages), 'chunk boundaries neither omit nor duplicate source bytes')
  assert.equal(calls, observedParts.length + 1, 'partials are reduced through one final merge call')
  assert.deepEqual(result.usage, {
    inputTokens: Array.from({ length: calls }, (_, index) => index + 1).reduce((sum, value) => sum + value, 0),
    outputTokens: Array.from({ length: calls }, (_, index) => (index + 1) * 2).reduce((sum, value) => sum + value, 0),
  })
  assert.match(result.text, /Decision A/)
  assert.match(result.text, /Open work B/)
})

test('empty output and a non-converging reduction fail without returning a partial brief', async () => {
  await assert.rejects(
    summarizeConversation(
      [{ id: 'empty-source', role: 'user', content: 'Keep this decision.' }],
      async () => ({ text: '   ', usage: { inputTokens: 1, outputTokens: 0 } }),
    ),
    (error: unknown) => error instanceof CompactionGenerationError && /empty conversation summary/i.test(error.message),
  )

  let calls = 0
  await assert.rejects(
    summarizeConversation(
      [{ id: 'large-source', role: 'user', content: 'x'.repeat(8_200) }],
      async () => {
        calls += 1
        return { text: 'y'.repeat(8_200), usage: { inputTokens: 1, outputTokens: 1 } }
      },
      { chunkChars: 4_000, maxCalls: 4 },
    ),
    (error: unknown) => error instanceof CompactionGenerationError && /more than 4 bounded summary passes/i.test(error.message),
  )
  assert.equal(calls, 4, 'the liveness/spend ceiling is exact')
})
