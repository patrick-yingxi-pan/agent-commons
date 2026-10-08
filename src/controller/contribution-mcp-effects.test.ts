import assert from 'node:assert/strict'
import test from 'node:test'
import type { Contribution } from '../../contract/contributions.ts'
import { refreshAccount } from '../api/account.ts'
import { API_BASE } from '../api/client.ts'
import { contributionEffectExecutionId } from '../api/contributionEffectExecutionIdentity.ts'
import { paths } from '../api/keys.ts'
import {
  beginContributionMcpEffect,
  checkContributionMcpEffectReceipt,
  contributionMcpEffectAttempt,
  dismissContributionMcpEffectAttempt,
} from './contributionMcpEffectMutations.ts'

const tenantId = 'controller-mcp-tenant'
const userId = 'controller-mcp-user'
const projectId = 'controller-mcp-project'
const contributionId = 'controller-mcp-contribution'
const lineId = 'controller-mcp-line'
const intent = { tenantId, sourceUserId: userId, projectId, contributionId, lineId, expectedVersion: 4 }

function response(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json', 'x-resolved-tenant': tenantId },
  })
}

async function savedContribution(idempotencyKey: string, status: 'pending' | 'done' | 'uncertain' = 'done'): Promise<Contribution> {
  const id = await contributionEffectExecutionId(tenantId, projectId, contributionId, idempotencyKey)
  return {
    id: contributionId,
    projectId,
    title: 'Controller MCP test',
    summary: '',
    contributor: 'Ada',
    events: [],
    effects: [{
      id, envelopeVersion: 4, lineId, actor: 'Ada', connectionLabel: 'CRM', toolName: 'update_record',
      arguments: { record: 'R-17' }, startedAt: 10, status,
      ...(status === 'pending' ? {} : { finishedAt: 11, summary: 'Saved receipt' }),
    }],
  } as unknown as Contribution
}

function resetAccount(): void {
  refreshAccount({ userId, tenantId })
}

test('a held controller attempt admits at most one POST and Dismiss itself never sends', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch; refreshAccount(null) })
  resetAccount()
  const calls: Array<{ method: string; url: string }> = []
  let finishPost!: (result: Response) => void
  const postHeld = new Promise<Response>((resolve) => { finishPost = resolve })
  let idempotencyKey = ''
  globalThis.fetch = async (input, init) => {
    const method = init?.method ?? 'GET'
    calls.push({ method, url: String(input) })
    if (method === 'POST') idempotencyKey = new Headers(init?.headers).get('Idempotency-Key') ?? ''
    return method === 'POST' ? postHeld : response([])
  }

  beginContributionMcpEffect(intent)
  beginContributionMcpEffect(intent)
  assert.equal(contributionMcpEffectAttempt(projectId, contributionId)?.state, 'submitting')
  for (let turn = 0; turn < 50 && calls.length === 0; turn += 1) await new Promise<void>((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(calls, [{ method: 'POST', url: `${API_BASE}${paths.contributionEffects(projectId, contributionId)}` }])

  finishPost(response(await savedContribution(idempotencyKey)))
  for (let turn = 0; turn < 50 && contributionMcpEffectAttempt(projectId, contributionId)?.state !== 'receipt'; turn += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  assert.equal(contributionMcpEffectAttempt(projectId, contributionId)?.state, 'receipt')
  assert.equal(calls.filter((call) => call.method === 'POST').length, 1)
  dismissContributionMcpEffectAttempt(projectId, contributionId)
  assert.equal(calls.filter((call) => call.method === 'POST').length, 1)
})

test('a failed acknowledgement and explicit checks use GET only; Dismiss does not replay', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch; refreshAccount(null) })
  resetAccount()
  const calls: string[] = []
  let idempotencyKey = ''
  let publishReceipt = false
  globalThis.fetch = async (_input, init) => {
    const method = init?.method ?? 'GET'
    calls.push(method)
    if (method === 'POST') {
      idempotencyKey = new Headers(init?.headers).get('Idempotency-Key') ?? ''
      throw new Error('response lost after submit')
    }
    return response(publishReceipt ? [await savedContribution(idempotencyKey)] : [])
  }

  beginContributionMcpEffect(intent)
  for (let turn = 0; turn < 50 && contributionMcpEffectAttempt(projectId, contributionId)?.state !== 'uncertain'; turn += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  assert.equal(contributionMcpEffectAttempt(projectId, contributionId)?.state, 'uncertain')
  assert.deepEqual(calls, ['POST', 'GET'])

  publishReceipt = true
  await checkContributionMcpEffectReceipt(projectId, contributionId)
  assert.equal(contributionMcpEffectAttempt(projectId, contributionId)?.receipt?.status, 'done')
  assert.deepEqual(calls, ['POST', 'GET', 'GET'])

  dismissContributionMcpEffectAttempt(projectId, contributionId)
  assert.equal(contributionMcpEffectAttempt(projectId, contributionId), null)
  assert.deepEqual(calls, ['POST', 'GET', 'GET'])
})

test('a known pending receipt survives failed and absent reads without another POST', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch; refreshAccount(null) })
  resetAccount()
  const calls: string[] = []
  let idempotencyKey = ''
  let read = 0
  globalThis.fetch = async (_input, init) => {
    const method = init?.method ?? 'GET'
    calls.push(method)
    if (method === 'POST') {
      idempotencyKey = new Headers(init?.headers).get('Idempotency-Key') ?? ''
      return response(await savedContribution(idempotencyKey, 'pending'))
    }
    read += 1
    if (read === 1) throw new Error('temporary read failure')
    return response([])
  }

  beginContributionMcpEffect(intent)
  for (let turn = 0; turn < 50 && contributionMcpEffectAttempt(projectId, contributionId)?.state !== 'pending'; turn += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  assert.equal(contributionMcpEffectAttempt(projectId, contributionId)?.receipt?.status, 'pending')
  await checkContributionMcpEffectReceipt(projectId, contributionId)
  assert.equal(contributionMcpEffectAttempt(projectId, contributionId)?.state, 'pending')
  assert.equal(contributionMcpEffectAttempt(projectId, contributionId)?.receipt?.status, 'pending')
  await checkContributionMcpEffectReceipt(projectId, contributionId)
  assert.equal(contributionMcpEffectAttempt(projectId, contributionId)?.state, 'pending')
  assert.equal(contributionMcpEffectAttempt(projectId, contributionId)?.receipt?.status, 'pending')
  assert.deepEqual(calls, ['POST', 'GET', 'GET'])
})

test('late POST completion after account switch cannot restore old-account attempt state', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch; refreshAccount(null) })
  resetAccount()
  let startPost!: () => void
  const postStarted = new Promise<void>((resolve) => { startPost = resolve })
  let finishPost!: (result: Response) => void
  const postHeld = new Promise<Response>((resolve) => { finishPost = resolve })
  let idempotencyKey = ''
  const calls: string[] = []
  globalThis.fetch = async (_input, init) => {
    const method = init?.method ?? 'GET'
    calls.push(method)
    if (method === 'POST') {
      idempotencyKey = new Headers(init?.headers).get('Idempotency-Key') ?? ''
      startPost()
      return postHeld
    }
    return response([])
  }

  beginContributionMcpEffect(intent)
  await postStarted
  refreshAccount({ userId: 'other-user', tenantId: 'other-tenant' })
  assert.equal(contributionMcpEffectAttempt(projectId, contributionId), null)
  finishPost(response(await savedContribution(idempotencyKey)))
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  assert.equal(contributionMcpEffectAttempt(projectId, contributionId), null)
  assert.deepEqual(calls, ['POST'])
})
