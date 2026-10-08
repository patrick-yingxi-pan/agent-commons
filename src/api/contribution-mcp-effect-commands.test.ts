import assert from 'node:assert/strict'
import test from 'node:test'
import type { Contribution } from '../../contract/contributions.ts'
import { refreshAccount } from './account.ts'
import { API_BASE } from './client.ts'
import { readContributionMcpEffectReceipt, submitContributionMcpEffectOnce } from './contributionMcpEffectCommands.ts'
import { contributionEffectExecutionId } from './contributionEffectExecutionIdentity.ts'
import { paths } from './keys.ts'
import { contributionMcpEffectAttempt, beginContributionMcpEffect, checkContributionMcpEffectReceipt } from '../controller/contributionMcpEffectMutations.ts'

const tenantId = 'mcp-ui-tenant'
const userId = 'mcp-ui-user'
const projectId = 'mcp-ui-project'
const contributionId = 'mcp-ui-contribution'
const lineId = 'mcp-ui-line'
const key = 'mcp-ui-idempotency-key'
const intent = { tenantId, sourceUserId: userId, projectId, contributionId, lineId, expectedVersion: 7 }
const ok = (value: unknown): Response => new Response(JSON.stringify(value), {
  status: 200,
  headers: { 'content-type': 'application/json', 'x-resolved-tenant': tenantId },
})

async function contributionWithReceipt(): Promise<Contribution> {
  const id = await contributionEffectExecutionId(tenantId, projectId, contributionId, key)
  return {
    id: contributionId,
    projectId,
    title: 'MCP UI test',
    summary: '',
    contributor: 'Ada',
    events: [],
    effects: [{
      id, envelopeVersion: 7, lineId, actor: 'Ada', connectionLabel: 'CRM', toolName: 'update_record',
      arguments: { record: 'R-17' }, startedAt: 10,
      status: 'done', finishedAt: 11, summary: 'Updated one record', result: { content: [{ type: 'text', text: 'saved' }] },
    }],
  } as unknown as Contribution
}

test('confirmed MCP submit uses one exact revision-bound POST and validates its saved receipt', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch; refreshAccount(null) })
  refreshAccount({ userId, tenantId })
  const calls: Array<{ url: string; method?: string; body?: string; key: string | null; source: string | null }> = []
  const contribution = await contributionWithReceipt()
  globalThis.fetch = async (input, init) => {
    calls.push({
      url: String(input), method: init?.method, body: init?.body as string | undefined,
      key: new Headers(init?.headers).get('Idempotency-Key'),
      source: new Headers(init?.headers).get('X-Account-Transition-Source'),
    })
    return ok(contribution)
  }

  const result = await submitContributionMcpEffectOnce(intent, key)
  assert.equal(result.receipt.id, contribution.effects?.[0]?.id)
  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.url, `${API_BASE}${paths.contributionEffects(projectId, contributionId)}`)
  assert.equal(calls[0]?.method, 'POST')
  assert.equal(calls[0]?.body, JSON.stringify({ lineId, expectedVersion: 7 }))
  assert.equal(calls[0]?.key, key)
  assert.equal(calls[0]?.source, `session:${userId}`)
})

test('receipt recovery is a collection GET and never replays a missing-acknowledgement POST', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch; refreshAccount(null) })
  refreshAccount({ userId, tenantId })
  const calls: Array<{ method?: string; url: string; source: string | null }> = []
  const contribution = await contributionWithReceipt()
  globalThis.fetch = async (input, init) => {
    calls.push({ method: init?.method, url: String(input), source: new Headers(init?.headers).get('X-Account-Transition-Source') })
    return ok([contribution])
  }

  const found = await readContributionMcpEffectReceipt(intent, key)
  assert.equal(found?.receipt.id, contribution.effects?.[0]?.id)
  assert.deepEqual(calls, [{
    method: 'GET', url: `${API_BASE}${paths.contributions(projectId)}`, source: `session:${userId}`,
  }])
})

test('lost acknowledgement can recover by GET only, and receipt reads cannot downgrade a known pending state', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch; refreshAccount(null) })
  refreshAccount({ userId, tenantId })
  const calls: Array<{ method?: string; key: string | null }> = []
  let postKey = ''
  let exposeReceipt = false
  globalThis.fetch = async (_input, init) => {
    const method = init?.method
    const idempotencyKey = new Headers(init?.headers).get('Idempotency-Key')
    calls.push({ method, key: idempotencyKey })
    if (method === 'POST') {
      postKey = idempotencyKey ?? ''
      throw new Error('simulated lost response after server acceptance')
    }
    return ok(exposeReceipt ? [await contributionWithReceiptFor(postKey)] : [])
  }

  beginContributionMcpEffect(intent)
  for (let turn = 0; turn < 50 && contributionMcpEffectAttempt(projectId, contributionId)?.state !== 'uncertain'; turn += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  assert.equal(contributionMcpEffectAttempt(projectId, contributionId)?.state, 'uncertain')
  assert.equal(postKey.length > 0, true)
  assert.equal(calls.filter((call) => call.method === 'POST').length, 1)
  assert.deepEqual(calls.filter((call) => call.method === 'GET').map((call) => call.method), ['GET'])

  exposeReceipt = true
  await checkContributionMcpEffectReceipt(projectId, contributionId)
  assert.equal(contributionMcpEffectAttempt(projectId, contributionId)?.state, 'receipt')
  assert.equal(calls.filter((call) => call.method === 'POST').length, 1)
  assert.deepEqual(calls.filter((call) => call.method === 'GET').map((call) => call.method), ['GET', 'GET'])
})

test('a known pending receipt stays pending when a later read is temporarily absent', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch; refreshAccount(null) })
  refreshAccount({ userId, tenantId })
  let postKey = ''
  const calls: string[] = []
  globalThis.fetch = async (_input, init) => {
    const method = init?.method ?? 'GET'
    calls.push(method)
    if (method === 'POST') {
      postKey = new Headers(init?.headers).get('Idempotency-Key') ?? ''
      const id = await contributionEffectExecutionId(tenantId, projectId, contributionId, postKey)
      return ok({
        id: contributionId, projectId, title: 'MCP UI test', summary: '', contributor: 'Ada', events: [],
        effects: [{ id, envelopeVersion: 7, lineId, actor: 'Ada', connectionLabel: 'CRM', toolName: 'update_record', arguments: { record: 'R-17' }, startedAt: 10, status: 'pending' }],
      })
    }
    return ok([])
  }

  beginContributionMcpEffect(intent)
  for (let turn = 0; turn < 50 && contributionMcpEffectAttempt(projectId, contributionId)?.state !== 'pending'; turn += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  assert.equal(contributionMcpEffectAttempt(projectId, contributionId)?.receipt?.status, 'pending')
  await checkContributionMcpEffectReceipt(projectId, contributionId)
  assert.equal(contributionMcpEffectAttempt(projectId, contributionId)?.state, 'pending')
  assert.equal(contributionMcpEffectAttempt(projectId, contributionId)?.receipt?.status, 'pending')
  assert.deepEqual(calls, ['POST', 'GET'])
})

async function contributionWithReceiptFor(idempotencyKey: string): Promise<Contribution> {
  const id = await contributionEffectExecutionId(tenantId, projectId, contributionId, idempotencyKey)
  return {
    id: contributionId,
    projectId,
    title: 'MCP UI test',
    summary: '',
    contributor: 'Ada',
    events: [],
    effects: [{
      id, envelopeVersion: 7, lineId, actor: 'Ada', connectionLabel: 'CRM', toolName: 'update_record',
      arguments: { record: 'R-17' }, startedAt: 10,
      status: 'done', finishedAt: 11, summary: 'Updated one record', result: { content: [{ type: 'text', text: 'saved' }] },
    }],
  } as unknown as Contribution
}
