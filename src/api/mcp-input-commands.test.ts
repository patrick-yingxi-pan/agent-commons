import assert from 'node:assert/strict'
import test from 'node:test'
import { refreshAccount } from './account.ts'
import { keys, paths } from './keys.ts'
import { readMcpInput, readMcpInputReceipt, refreshMcpInputReview, submitMcpInputOnce } from './mcpInputCommands.ts'
import { onSessionPush } from './sessionRefresh.ts'
import type { McpInputCommand } from '../../contract/mcpInput.ts'

test('private review key families match the cache delimiter contract and paths encode opaque identities', () => {
  const sessionId = 'session:slash/with space'
  const key = keys.mcpInput(sessionId, 'activity', 'decision', 'tenant', 'user')
  for (const prefix of [keys.mcpInputPrefix(), keys.mcpInputPrefix(sessionId)]) {
    assert.ok(key === prefix || key.startsWith(`${prefix}:`))
  }
  assert.equal(key.startsWith(`${keys.mcpInputPrefix('session')}:`), false)
  assert.match(paths.mcpInput('session/slash', 'activity/slash'), /session%2Fslash.*activity%2Fslash/)
  assert.match(paths.mcpInputReceipt('s', 'a', 'response/slash', 'decision/slash'), /response%2Fslash\?decisionId=decision%2Fslash$/)
})

test('private reads carry person preconditions and reject a different decision, activity, or response', async (t) => {
  const originalFetch = globalThis.fetch
  refreshAccount({ userId: 'person', tenantId: 'tenant' })
  t.after(() => { globalThis.fetch = originalFetch; refreshAccount(null) })
  const scope = { sessionId: 's', activityId: 'a', decisionId: 'd', sourceUserId: 'person' }
  let value: unknown = { activity: { id: 'a', decisionId: 'other' }, review: null }
  globalThis.fetch = async (_input, init) => {
    assert.equal(init?.method, 'GET')
    assert.equal(new Headers(init?.headers).get('X-Account-Transition-Source'), 'session:person')
    assert.ok(init?.signal)
    return new Response(JSON.stringify(value), { headers: { 'x-resolved-tenant': 'tenant' } })
  }
  await assert.rejects(readMcpInput(scope), /exact tool decision/)
  value = { activity: { id: 'a', decisionId: 'd' }, review: { decisionId: 'other' } }
  await assert.rejects(readMcpInput(scope), /exact tool decision/)
  const command: McpInputCommand = { decisionId: 'd', round: 1, responseId: 'response', action: 'stop' }
  value = { ...command, activity: { id: 'wrong', decisionId: 'd' } }
  await assert.rejects(readMcpInputReceipt(scope, command), /exact reviewed response/)
})

test('acknowledgement, receipt recovery and fresh review heal open transcripts without EventSource', async (t) => {
  const originalFetch = globalThis.fetch
  refreshAccount({ userId: 'person', tenantId: 'tenant' })
  t.after(() => { globalThis.fetch = originalFetch; refreshAccount(null) })
  const scope = { sessionId: 's', activityId: 'a', decisionId: 'd', sourceUserId: 'person' }
  const command: McpInputCommand = { decisionId: 'd', round: 1, responseId: 'response', action: 'stop' }
  const receipt = { ...command, activity: { id: 'a', decisionId: 'd', status: 'uncertain' } }
  const sessions: string[] = []
  const unsubscribe = onSessionPush(id => sessions.push(id))
  t.after(unsubscribe)
  globalThis.fetch = async () => new Response(JSON.stringify(receipt), { headers: { 'x-resolved-tenant': 'tenant' } })
  await submitMcpInputOnce(scope, command)
  await readMcpInputReceipt(scope, command)
  refreshMcpInputReview(scope.sessionId)
  assert.deepEqual(sessions, ['s', 's', 's'])
  unsubscribe()
  refreshMcpInputReview(scope.sessionId)
  assert.deepEqual(sessions, ['s', 's', 's'], 'unmounted panes no longer reconcile')
})
