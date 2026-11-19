import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isTaskPartnerContinuation } from './taskPartnerContinuation.mjs'

test('only an exact first-party partner continuation can leave Electron through the loopback browser door', () => {
  const origin = 'http://127.0.0.1:8787'
  const path = '/api/v1/auth/task-partner-handoffs/grant-' + 'a'.repeat(32)
  assert.equal(isTaskPartnerContinuation(origin + path, origin), true)
  for (const target of [origin + path + '?code=x', origin + path + '#secret', origin + path + '/',
    origin + '/api/v1/me', origin + '/auth/task-partner-handoffs/invalid',
    'http://127.0.0.1:9999' + path, 'http://someone@127.0.0.1:8787' + path, 'https://unrelated.example' + path]) {
    assert.equal(isTaskPartnerContinuation(target, origin), false, target)
  }
})
