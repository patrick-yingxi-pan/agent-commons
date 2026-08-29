import test from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../store/index.ts'
import { callRaw } from '../testkit/http.ts'

test('an unconfigured endpoint refuses before persisting the user turn', async () => {
  const prior = {
    inline: process.env.MODEL_INLINE,
    baseURL: process.env.ANTHROPIC_BASE_URL,
    apiKey: process.env.ANTHROPIC_API_KEY,
    timeout: process.env.MODEL_TIMEOUT_MS,
  }
  process.env.MODEL_INLINE = '0'
  process.env.MODEL_TIMEOUT_MS = '25'
  delete process.env.ANTHROPIC_BASE_URL
  delete process.env.ANTHROPIC_API_KEY

  const session = store.createSession('unconfigured model wall')
  const before = store.getSession(session.id)?.messages.length
  try {
    const response = await callRaw('POST', `/sessions/${session.id}/messages`, { text: 'This must not persist.' })
    assert.equal(response.status, 409)
    const error = JSON.parse(response.body).error
    assert.equal(error.code, 'capability_unavailable')
    assert.match(error.message, /not configured/)
    assert.equal(store.getSession(session.id)?.messages.length, before, 'the refused prompt never became record')
  } finally {
    if (prior.inline === undefined) delete process.env.MODEL_INLINE
    else process.env.MODEL_INLINE = prior.inline
    if (prior.baseURL === undefined) delete process.env.ANTHROPIC_BASE_URL
    else process.env.ANTHROPIC_BASE_URL = prior.baseURL
    if (prior.apiKey === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = prior.apiKey
    if (prior.timeout === undefined) delete process.env.MODEL_TIMEOUT_MS
    else process.env.MODEL_TIMEOUT_MS = prior.timeout
  }
})
