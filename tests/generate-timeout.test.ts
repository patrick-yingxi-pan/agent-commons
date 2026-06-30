/** Model-path reliability (design P5) — a hung model endpoint must not wedge the turn.
 *  generateReply combines the caller's abort with a per-call MODEL_TIMEOUT_MS deadline;
 *  on timeout the stream aborts and the turn degrades to the local fallback (no hang,
 *  no thrown error to the route). This points the SDK at a server that accepts the
 *  request but never responds, with a short timeout, and asserts the graceful fallback. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { generateReply } from '../server/generate.ts'

test('generateReply falls back when the model endpoint hangs past MODEL_TIMEOUT_MS', async () => {
  // Accepts the connection but never sends a response.
  const hung = createServer(() => {})
  await new Promise<void>((resolve) => hung.listen(0, '127.0.0.1', () => resolve()))
  const addr = hung.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0

  const prev = { base: process.env.ANTHROPIC_BASE_URL, timeout: process.env.MODEL_TIMEOUT_MS }
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`
  process.env.MODEL_TIMEOUT_MS = '150'

  const agent = { id: 'a', label: 'A', systemPrompt: 's', instructions: '', tools: [] }
  try {
    const result = await generateReply(
      { id: 's1', title: 'T' },
      agent as never,
      'hello',
      { onStart: () => {}, onDelta: () => {} },
    )
    assert.match(result.message.content, /couldn’t reach the model endpoint/, 'served the local fallback')
    assert.equal(result.usage.inputTokens, 0, 'no tokens were billed for a timed-out call')
    assert.equal(result.usage.outputTokens, 0)
  } finally {
    hung.closeAllConnections?.()
    hung.close()
    if (prev.base === undefined) delete process.env.ANTHROPIC_BASE_URL
    else process.env.ANTHROPIC_BASE_URL = prev.base
    if (prev.timeout === undefined) delete process.env.MODEL_TIMEOUT_MS
    else process.env.MODEL_TIMEOUT_MS = prev.timeout
  }
})
