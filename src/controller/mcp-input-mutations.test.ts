import assert from 'node:assert/strict'
import test from 'node:test'
import type { McpInputCommand, McpInputReceipt, McpInputReview } from '../../contract/mcpInput.ts'
import type { ToolActivity } from '../../contract/entities.ts'
import { refreshAccount } from '../api/account.ts'
import { paths } from '../api/keys.ts'
import { beginMcpInput, checkMcpInput, reviewLatestMcpInput } from './mcpInputMutations.ts'
import { mcpInputHeld, updateMcpInputDraft } from './mcpInputState.ts'

const scope = { sessionId: 'session', activityId: 'activity', decisionId: 'decision', sourceUserId: 'person' }
const review: McpInputReview = { decisionId: 'decision', round: 1, expiresAt: Date.now() + 3_600_000,
  connectionLabel: 'Fixture', toolName: 'test', canContinue: true, inputRequests: {
    form: { method: 'elicitation/create', params: { message: 'Review', requestedSchema: {
      type: 'object', properties: { note: { type: 'string' } }, required: ['note'],
    } } },
  } }
const draft = () => ({ form: { action: 'accept' as const, fields: { note: 'private answer' } } })
const activity = (status: ToolActivity['status'] = 'done'): ToolActivity => ({ id: 'activity', decisionId: 'decision', status,
  kind: 'action', connector: 'Fixture', tool: 'test', summary: 'Status' })
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'content-type': 'application/json', 'x-resolved-tenant': 'tenant' },
})
const receipt = (command: McpInputCommand, status: ToolActivity['status'] = 'done'): McpInputReceipt => ({
  responseId: command.responseId, decisionId: command.decisionId, round: command.round, action: command.action, activity: activity(status),
})
const until = async (predicate: () => boolean) => {
  for (let turn = 0; turn < 100 && !predicate(); turn += 1) await new Promise<void>((resolve) => setTimeout(resolve, 0))
  assert.ok(predicate(), 'expected asynchronous controller state')
}
function setup(t: Parameters<Parameters<typeof test>[1]>[0]) {
  const originalFetch = globalThis.fetch
  refreshAccount({ userId: 'person', tenantId: 'tenant' })
  t.after(() => { globalThis.fetch = originalFetch; refreshAccount(null) })
}

test('one frozen action coalesces double activation and retains exact private draft across pane reads', async (t) => {
  setup(t)
  let resolve!: (response: Response) => void
  const pending = new Promise<Response>((done) => { resolve = done })
  const calls: McpInputCommand[] = []
  globalThis.fetch = async (_input, init) => { calls.push(JSON.parse(String(init?.body))); return pending }
  const source = draft()
  beginMcpInput(scope, review, 'respond', source)
  source.form.fields.note = 'changed after click'
  beginMcpInput(scope, review, 'stop', draft())
  updateMcpInputDraft(scope, review, draft())
  assert.equal(calls.length, 1)
  assert.equal(mcpInputHeld(scope)?.draft.form?.fields.note, 'private answer')
  assert.equal(calls[0]?.action, 'respond')
  assert.match(calls[0]!.responseId, /^[a-f0-9-]{36}$/)
  resolve(reply(receipt(calls[0]!)))
  await until(() => mcpInputHeld(scope)?.attempt?.state === 'receipt')
  assert.equal(mcpInputHeld(scope)?.review?.round, 1)
})

test('lost POST and every Check status use exact GET only; fresh review explicitly resets answers without sending', async (t) => {
  setup(t)
  const calls: { method: string; url: string }[] = []
  let command!: McpInputCommand
  globalThis.fetch = async (input, init) => {
    const method = init?.method ?? 'GET'
    calls.push({ method, url: String(input) })
    if (method === 'POST') { command = JSON.parse(String(init?.body)); throw new Error('Lost response') }
    if (String(input).includes('/receipts/')) return reply({ error: { code: 'not_found', message: 'Unknown' } }, 404)
    return reply({ activity: activity('awaiting-input'), review })
  }
  beginMcpInput(scope, review, 'respond', draft())
  await until(() => mcpInputHeld(scope)?.attempt?.state === 'uncertain')
  await checkMcpInput(scope)
  assert.deepEqual(calls.map((call) => call.method), ['POST', 'GET', 'GET'])
  assert.ok(calls[1]!.url.endsWith(paths.mcpInputReceipt(scope.sessionId, scope.activityId, command.responseId, scope.decisionId)))
  await reviewLatestMcpInput(scope)
  assert.equal(mcpInputHeld(scope)?.attempt, undefined)
  assert.deepEqual(mcpInputHeld(scope)?.draft.form?.fields, {})
  assert.equal(calls.filter((call) => call.method === 'POST').length, 1)
})

test('a mismatched acknowledgement remains held; running fresh truth cannot release receipt recovery', async (t) => {
  setup(t)
  let command!: McpInputCommand
  let postCount = 0
  globalThis.fetch = async (input, init) => {
    if (init?.method === 'POST') { postCount += 1; command = JSON.parse(String(init.body)); return reply({ ...receipt(command), responseId: 'wrong' }) }
    return String(input).includes('/receipts/')
      ? reply({ ...receipt(command), round: 99 })
      : reply({ activity: activity('running'), review: null })
  }
  beginMcpInput(scope, review, 'respond', draft())
  await until(() => mcpInputHeld(scope)?.attempt?.state === 'uncertain')
  await reviewLatestMcpInput(scope)
  assert.equal(mcpInputHeld(scope)?.attempt?.state, 'uncertain')
  assert.match(mcpInputHeld(scope)?.attempt?.error ?? '', /still running/)
  assert.equal(postCount, 1)
})

test('account switch clears private answers and prevents late acknowledgement or recovery from returning', async (t) => {
  setup(t)
  let resolve!: (response: Response) => void
  const pending = new Promise<Response>((done) => { resolve = done })
  let command!: McpInputCommand
  let calls = 0
  globalThis.fetch = async (_input, init) => { calls += 1; command = JSON.parse(String(init?.body)); return pending }
  beginMcpInput(scope, review, 'respond', draft())
  refreshAccount({ userId: 'other', tenantId: 'other-tenant' })
  assert.equal(mcpInputHeld(scope), null)
  resolve(reply(receipt(command)))
  await new Promise<void>((done) => setTimeout(done, 0))
  assert.equal(mcpInputHeld(scope), null)
  assert.equal(calls, 1)
})

test('local Stop carries no answers and remains available after expiry; Continue fails closed', async (t) => {
  setup(t)
  const commands: McpInputCommand[] = []
  globalThis.fetch = async (_input, init) => {
    const command = JSON.parse(String(init?.body)) as McpInputCommand
    commands.push(command); return reply(receipt(command, 'uncertain'))
  }
  const expired = { ...review, expiresAt: 1, canContinue: false }
  beginMcpInput(scope, expired, 'respond', draft())
  assert.equal(commands.length, 0)
  beginMcpInput(scope, expired, 'stop', draft())
  await until(() => mcpInputHeld(scope)?.attempt?.state === 'receipt')
  assert.equal(commands[0]?.action, 'stop')
  assert.equal(Object.hasOwn(commands[0]!, 'responses'), false)
})
