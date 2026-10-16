import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_REPLY_OUTPUT_TOKENS, isReplyOutputTokens, resolveReplyOutputTokens } from './providerReplyLimits.ts'

test('reply limits are explicit bounded integers, not inferred model capabilities', () => {
  assert.equal(DEFAULT_REPLY_OUTPUT_TOKENS, 8192)
  for (const value of [128, 8192, 65536]) assert.equal(isReplyOutputTokens(value), true)
  for (const value of [undefined, null, '8192', 0, 127, 65537, 1.5, NaN, Infinity]) {
    assert.equal(isReplyOutputTokens(value), false, String(value))
  }
})

test('legacy absence keeps the former protocol limit; an explicit limit is protocol independent', () => {
  assert.equal(resolveReplyOutputTokens({}), 1024)
  assert.equal(resolveReplyOutputTokens({ protocol: 'anthropic-messages' }), 1024)
  assert.equal(resolveReplyOutputTokens({ protocol: 'openai-responses' }), 8192)
  for (const protocol of ['anthropic-messages', 'openai-responses'] as const) {
    assert.equal(resolveReplyOutputTokens({ protocol, replyOutputTokens: 16384 }), 16384)
    assert.throws(() => resolveReplyOutputTokens({ protocol, replyOutputTokens: 0 }), /replyOutputTokens/)
  }
})
