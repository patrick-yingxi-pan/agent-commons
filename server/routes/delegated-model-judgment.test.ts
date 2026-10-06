/** Explicit owner-funded Delegation judgment crosses only the real local
 * Anthropic Messages boundary; this suite never contacts a paid provider. */
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { store } from '../store/index.ts'
import { call, callFresh } from '../testkit/http.ts'
import { delegatedJudgmentId } from '../delegatedJudgmentIdentity.ts'

const OWNER = 'tenant-delegated-model-judgment-owner'
const CONTRIBUTOR = 'tenant-delegated-model-judgment-contributor'
const READER = 'tenant-delegated-model-judgment-reader'
const API_KEY_NAME = 'PROVIDER_DELEGATED_MODEL_JUDGMENT_FIXTURE_KEY'
let sequence = 0
const originalEnv = new Map<string, string | undefined>()
for (const name of ['DEPLOYMENT_PROFILE', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_API_KEY', API_KEY_NAME]) {
  originalEnv.set(name, process.env[name])
}
after(() => {
  for (const [name, value] of originalEnv) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

async function endpoint(
  reply: { decision: 'approve' | 'decline' | 'escalate'; summary: string },
  options: { pause?: boolean; networkFailure?: boolean; responseText?: string; usage?: unknown } = {},
) {
  const requests: Array<{ body: any; headers: Record<string, string | string[] | undefined>; release?: () => void }> = []
  let notified!: () => void
  let pauseReady!: () => void
  const requested = new Promise<void>((resolve) => { notified = resolve })
  const paused = new Promise<void>((resolve) => { pauseReady = resolve })
  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    const record: { body: any; headers: Record<string, string | string[] | undefined>; release?: () => void } = {
      body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      headers: req.headers,
    }
    requests.push(record)
    notified()
    if (options.pause) await new Promise<void>((resolve) => { record.release = resolve; pauseReady() })
    if (options.networkFailure) {
      res.destroy()
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      id: `msg-delegated-judgment-${requests.length}`,
      type: 'message',
      role: 'assistant',
      model: 'delegated-judgment-fixture',
      content: [{ type: 'text', text: options.responseText ?? JSON.stringify(reply) }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: options.usage ?? { input_tokens: 71, output_tokens: 19 },
    }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const baseURL = `http://127.0.0.1:${address.port}`
  const close = async () => {
    for (const request of requests) request.release?.()
    server.closeAllConnections?.()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  return { baseURL, requests, requested, paused, close }
}

async function scenario(label: string, options: {
  mode?: 'draft' | 'decide'
  actKind?: 'land' | 'approve-envelope'
  endpoint?: string
  expiresAt?: number
  providerPlan?: { windows: Array<{ label: string; ceiling: number }> }
} = {}) {
  const projectId = `p-delegated-model-judgment-${++sequence}`
  store.applyRelationOp({ kind: 'create-project', projectId, projectName: label, projectDescription: '' }, OWNER)
  store.applyRelationOp({ kind: 'share-project', projectId, projectName: label, shared: true }, OWNER)
  const opened = await call('POST', `/projects/${projectId}/contributions`, { title: label }, { 'x-tenant-id': CONTRIBUTOR })
  assert.equal(opened.status, 200)
  const contributionId = opened.json.id as string
  const changeset = await call('POST', `/projects/${projectId}/contributions/${contributionId}/changeset`, {
    entries: [{ kind: 'note', target: `target-${sequence}`, before: 'old', after: `frozen text ${sequence}` }],
  }, { 'x-tenant-id': CONTRIBUTOR })
  assert.equal(changeset.status, 200)

  const provider = store.createProvider({
    label: `${label} endpoint`, modelFamily: 'claude', effortLevels: ['Low'],
    models: [{ id: 'delegated-judgment-fixture', label: 'Delegated judgment fixture' }],
    ...(options.providerPlan ? { plan: options.providerPlan } : {}),
  }, options.endpoint ? {
    baseURL: options.endpoint, apiKeyEnv: API_KEY_NAME, model: 'delegated-judgment-fixture',
    capabilities: { toolUse: true },
  } : {}, OWNER)
  const agent = store.createAgent({
    label: `${label} reviewer`, providerId: provider.id, systemPrompt: 'Apply only the written policy.', tools: [],
    instructions: 'Return one exact JSON delegated judgment.',
  } as any, OWNER)
  const publicAgent = store.listAgents(OWNER).find((item) => item.id === agent.id)!
  const publicProvider = store.listProviders(OWNER).find((item) => item.id === provider.id)!
  const grant = await callFresh('POST', `/projects/${projectId}/delegations`, {
    agentId: agent.id,
    actKind: options.actKind ?? 'land',
    policy: 'Approve only when the frozen change is internally consistent.',
    escalation: ['effectful'],
    mode: options.mode ?? 'draft',
    ...(options.expiresAt === undefined ? {} : { expiresAt: options.expiresAt }),
  }, { 'x-tenant-id': OWNER, 'idempotency-key': `grant-${sequence}` })
  assert.equal(grant.status, 200)
  return {
    projectId,
    contributionId,
    delegationId: grant.json.id as string,
    delegation: grant.json,
    agentId: agent.id,
    providerId: provider.id,
    binding: {
      agentId: agent.id,
      agentRevision: publicAgent.revision ?? 0,
      providerId: provider.id,
      providerRevision: publicProvider.definitionRevision ?? 0,
      connectionRevision: publicProvider.connectionRevision ?? 0,
    },
  }
}

function path(projectId: string, contributionId: string, delegationId: string) {
  return `/projects/${projectId}/contributions/${contributionId}/delegated/${delegationId}`
}

const judgmentRequest = (delegationRevision: number, reviewer: object, changeset = 1, envelope: number | null = null) => ({
  expectedDelegationRevision: delegationRevision,
  expectedChangesetVersion: changeset,
  expectedEnvelopeVersion: envelope,
  reviewer,
})

test('explicit owner judgment sends frozen no-tools Messages input, meters owner, and hides summary from shared readers', async () => {
  delete process.env.DEPLOYMENT_PROFILE
  process.env[API_KEY_NAME] = 'local-delegated-judgment-key'
  const server = await endpoint({ decision: 'approve', summary: 'The frozen note is consistent.' })
  const usage: Array<[number, number, string | undefined]> = []
  const recordUsage = store.recordUsage
  store.recordUsage = (input, output, tenant) => {
    usage.push([input, output, tenant])
    return recordUsage.call(store, input, output, tenant)
  }
  try {
    const subject = await scenario('explicit delegated judgment', { endpoint: server.baseURL })
    const key = `delegated-judgment-${sequence}`
    const id = delegatedJudgmentId(OWNER, subject.projectId, subject.contributionId, subject.delegationId, key)
    const nonOwner = await callFresh('POST', path(subject.projectId, subject.contributionId, subject.delegationId), {
      judgment: judgmentRequest(0, subject.binding),
    }, { 'x-tenant-id': READER, 'idempotency-key': `non-owner-${key}` })
    assert.equal(nonOwner.status, 403, 'a shared reader cannot spend the Project owner’s budget')
    assert.equal(server.requests.length, 0)
    const response = await callFresh('POST', path(subject.projectId, subject.contributionId, subject.delegationId), {
      judgment: judgmentRequest(0, subject.binding),
    }, { 'x-tenant-id': OWNER, 'idempotency-key': key })
    assert.equal(response.status, 200)
    assert.equal(server.requests.length, 1)
    assert.equal(server.requests[0].headers['x-api-key'], 'local-delegated-judgment-key')
    assert.equal(server.requests[0].body.tools, undefined, 'delegated review is explicitly tool-free')
    const prompt = JSON.stringify(server.requests[0].body.messages)
    assert.match(prompt, /Approve only when the frozen change is internally consistent/)
    assert.match(prompt, /frozen text 1/)
    assert.doesNotMatch(prompt, /tenant-delegated-model-judgment-owner|providerId|connectionRevision/)
    assert.deepEqual(usage, [[71, 19, OWNER]], 'reported provider usage is attributed to the initiating owner')
    const run = response.json.judgments.at(-1)
    assert.equal(run.id, id)
    assert.equal(run.status, 'draft')
    assert.equal(run.decision, 'approve')
    assert.equal(run.summary, 'The frozen note is consistent.')
    assert.equal(run.delegationRevision, 0)

    const updatedPolicy = await callFresh('PATCH', `/projects/${subject.projectId}/delegations/${subject.delegationId}`, {
      expectedRevision: 0,
      policy: 'A later policy version cannot rebind the old exact attempt.',
      escalation: ['effectful'],
      mode: 'draft',
      expiresAt: null,
    }, { 'x-tenant-id': OWNER })
    assert.equal(updatedPolicy.status, 200)
    const replay = await callFresh('POST', path(subject.projectId, subject.contributionId, subject.delegationId), {
      judgment: judgmentRequest(0, subject.binding),
    }, { 'x-tenant-id': OWNER, 'idempotency-key': key })
    assert.equal(replay.status, 200, 'durable exact replay precedes later policy revisions')
    assert.deepEqual(replay.json.judgments, response.json.judgments)
    assert.equal(server.requests.length, 1, 'exact replay never repeats provider I/O')
    const changed = await callFresh('POST', path(subject.projectId, subject.contributionId, subject.delegationId), {
      judgment: judgmentRequest(1, subject.binding),
    }, { 'x-tenant-id': OWNER, 'idempotency-key': key })
    assert.equal(changed.status, 409, 'a key cannot be rebound to a different request')

    store.applyRelationOp({ kind: 'share-project', projectId: subject.projectId, projectName: 'shared judgment', shared: true }, OWNER)
    const shared = await callFresh('GET', `/projects/${subject.projectId}/contributions`, { }, { 'x-tenant-id': READER })
    assert.equal(shared.status, 200)
    const readerRun = shared.json.find((row: any) => row.id === subject.contributionId)?.judgments?.at(-1)
    assert.ok(readerRun, 'shared Project reader can see that an attempt exists')
    assert.equal(readerRun.status, 'draft')
    assert.equal(readerRun.decision, 'approve')
    assert.equal(Object.hasOwn(readerRun, 'summary'), false, 'the private policy-derived summary is owner-only')
    for (const field of ['tenantId', 'reviewerBinding', 'binding', 'contextHash']) assert.equal(Object.hasOwn(readerRun, field), false)
  } finally {
    store.recordUsage = recordUsage
    await server.close()
  }
})

test('mechanical effectful trigger escalates before model I/O; legacy empty request stays unavailable in release', async () => {
  delete process.env.DEPLOYMENT_PROFILE
  process.env[API_KEY_NAME] = 'local-delegated-judgment-key'
  const server = await endpoint({ decision: 'approve', summary: 'must not run' })
  try {
    const subject = await scenario('effectful must escalate', { endpoint: server.baseURL, actKind: 'approve-envelope' })
    await call('POST', `/projects/${subject.projectId}/contributions/${subject.contributionId}/envelope`, {
      lines: [{ type: 'connector.write', target: 'vendor', cardinality: 1, harness: 'draft-escrow', note: 'irreversible send' }],
    }, { 'x-tenant-id': CONTRIBUTOR })
    const result = await callFresh('POST', path(subject.projectId, subject.contributionId, subject.delegationId), {
      judgment: judgmentRequest(0, subject.binding, 1, 1),
    }, { 'x-tenant-id': OWNER, 'idempotency-key': `mechanical-${sequence}` })
    assert.equal(result.status, 200)
    assert.equal(server.requests.length, 0, 'the mechanical irreversible floor precedes model generation')
    assert.equal(result.json.judgments.at(-1).status, 'escalated')

    process.env.DEPLOYMENT_PROFILE = 'release'
    const legacy = await callFresh('POST', path(subject.projectId, subject.contributionId, subject.delegationId), undefined, {
      'x-tenant-id': OWNER,
    })
    assert.equal(legacy.status, 409)
    assert.equal(legacy.json.error.code, 'capability_unavailable')
    assert.equal(server.requests.length, 0)
  } finally {
    await server.close()
  }
})

test('a model decline is recorded without inflating the mechanical escalation ledger', async () => {
  delete process.env.DEPLOYMENT_PROFILE
  process.env[API_KEY_NAME] = 'local-delegated-judgment-key'
  const server = await endpoint({ decision: 'decline', summary: 'The written criteria are not met.' })
  try {
    const subject = await scenario('delegated decline', { endpoint: server.baseURL })
    const before = store.attentionLedger(subject.projectId, OWNER)
    const response = await callFresh('POST', path(subject.projectId, subject.contributionId, subject.delegationId), {
      judgment: judgmentRequest(0, subject.binding),
    }, { 'x-tenant-id': OWNER, 'idempotency-key': `decline-${sequence}` })
    assert.equal(response.status, 200)
    assert.equal(response.json.judgments.at(-1).status, 'declined')
    assert.equal(response.json.events.at(-1).kind, 'delegated-decline')
    const after = store.attentionLedger(subject.projectId, OWNER)
    assert.equal(after.escalations, before.escalations, 'a reviewer decision is not a mechanical escalation trigger')
  } finally {
    await server.close()
  }
})

test('decide mode applies only a current non-effectful land or read-only envelope approval', async () => {
  process.env.DEPLOYMENT_PROFILE = 'desktop'
  process.env[API_KEY_NAME] = 'local-delegated-judgment-key'
  const server = await endpoint({ decision: 'approve', summary: 'The frozen proposal satisfies the owner policy.' })
  try {
    const landing = await scenario('decide non-effectful land', { endpoint: server.baseURL, mode: 'decide' })
    const landingKey = `decide-land-${sequence}`
    const landBody = { judgment: judgmentRequest(0, landing.binding) }
    const landed = await callFresh('POST', path(landing.projectId, landing.contributionId, landing.delegationId), landBody, {
      'x-tenant-id': OWNER, 'idempotency-key': landingKey,
    })
    assert.equal(landed.status, 200)
    assert.equal(landed.json.judgments.at(-1).status, 'decided')
    assert.equal(landed.json.status, 'landed')
    assert.equal(landed.json.events.at(-1).kind, 'delegated-decision')
    const landReplay = await callFresh('POST', path(landing.projectId, landing.contributionId, landing.delegationId), landBody, {
      'x-tenant-id': OWNER, 'idempotency-key': landingKey,
    })
    assert.equal(landReplay.status, 200, 'receipt replay survives the now-landed state')
    assert.equal(landReplay.json.status, 'landed')
    assert.equal(server.requests.length, 1, 'replay cannot make a second model call or land twice')

    const approval = await scenario('decide read-only approval', {
      endpoint: server.baseURL, mode: 'decide', actKind: 'approve-envelope',
    })
    const proposal = await call('POST', `/projects/${approval.projectId}/contributions/${approval.contributionId}/envelope`, {
      lines: [{ type: 'connector.read', target: 'calendar:launch', cardinality: 1, harness: 'dry-run', note: 'read-only review' }],
    }, { 'x-tenant-id': CONTRIBUTOR })
    assert.equal(proposal.status, 200)
    const request = judgmentRequest(0, approval.binding, 1, 1)
    const approved = await callFresh('POST', path(approval.projectId, approval.contributionId, approval.delegationId), {
      judgment: request,
    }, { 'x-tenant-id': OWNER, 'idempotency-key': `decide-envelope-${sequence}` })
    assert.equal(approved.status, 200)
    assert.equal(approved.json.judgments.at(-1).status, 'decided')
    assert.equal(approved.json.envelope.status, 'approved')
    assert.equal(approved.json.envelope.approvedVersion, 1)
    assert.equal(approved.json.status, 'open', 'approval is not an envelope execution')
    assert.equal(server.requests.length, 2)
  } finally {
    await server.close()
  }
})

test('missing endpoint and exhausted owner budget refuse before Messages I/O', async () => {
  delete process.env.DEPLOYMENT_PROFILE
  process.env[API_KEY_NAME] = 'local-delegated-judgment-key'
  const noEndpoint = await scenario('unconfigured delegated reviewer')
  const unavailable = await callFresh('POST', path(noEndpoint.projectId, noEndpoint.contributionId, noEndpoint.delegationId), {
    judgment: judgmentRequest(0, noEndpoint.binding),
  }, { 'x-tenant-id': OWNER, 'idempotency-key': `unconfigured-${sequence}` })
  assert.equal(unavailable.status, 409)
  assert.equal(unavailable.json.error.code, 'capability_unavailable')

  const server = await endpoint({ decision: 'approve', summary: 'must not dispatch' })
  try {
    const limited = await scenario('budget-limited delegated reviewer', {
      endpoint: server.baseURL,
      providerPlan: { windows: [{ label: '5-hour limit', ceiling: 1 }] },
    })
    store.recordUsage(1, 0, OWNER)
    const response = await callFresh('POST', path(limited.projectId, limited.contributionId, limited.delegationId), {
      judgment: judgmentRequest(0, limited.binding),
    }, { 'x-tenant-id': OWNER, 'idempotency-key': `limit-${sequence}` })
    assert.equal(response.status, 429)
    assert.equal(response.json.error.code, 'limit_exceeded')
    assert.equal(server.requests.length, 0, 'budget preflight precedes all model traffic')
  } finally {
    await server.close()
  }
})

test('a private Project remains existence-hidden from a shared-workspace bystander', async () => {
  const projectId = `p-delegated-private-${++sequence}`
  store.applyRelationOp({ kind: 'create-project', projectId, projectName: 'Private judgment', projectDescription: '' }, OWNER)
  const opened = await call('POST', `/projects/${projectId}/contributions`, { title: 'Private contribution' }, { 'x-tenant-id': OWNER })
  assert.equal(opened.status, 200)
  const response = await callFresh('POST', path(projectId, opened.json.id, 'private-delegation'), {
    judgment: judgmentRequest(0, {
      agentId: 'private-agent', agentRevision: 0, providerId: 'private-provider', providerRevision: 0, connectionRevision: 0,
    }),
  }, { 'x-tenant-id': READER, 'idempotency-key': `private-${sequence}` })
  assert.equal(response.status, 404)
  assert.equal(response.json.error.code, 'not_found')
})

test('uncertain transport never auto-retries; an explicit new key is required for another paid attempt', async () => {
  delete process.env.DEPLOYMENT_PROFILE
  process.env[API_KEY_NAME] = 'local-delegated-judgment-key'
  const server = await endpoint({ decision: 'approve', summary: 'unused' }, { networkFailure: true })
  try {
    const subject = await scenario('uncertain delegated call', { endpoint: server.baseURL })
    const body = { judgment: judgmentRequest(0, subject.binding) }
    const first = await callFresh('POST', path(subject.projectId, subject.contributionId, subject.delegationId), body, {
      'x-tenant-id': OWNER, 'idempotency-key': `uncertain-${sequence}`,
    })
    assert.equal(first.status, 200)
    assert.equal(first.json.judgments.at(-1).status, 'uncertain')
    const retry = await callFresh('POST', path(subject.projectId, subject.contributionId, subject.delegationId), body, {
      'x-tenant-id': OWNER, 'idempotency-key': `uncertain-${sequence}`,
    })
    assert.equal(retry.status, 200)
    assert.deepEqual(retry.json.judgments, first.json.judgments)
    assert.equal(server.requests.length, 1, 'exact Retry reads durable uncertainty without another request')
    const explicit = await callFresh('POST', path(subject.projectId, subject.contributionId, subject.delegationId), body, {
      'x-tenant-id': OWNER, 'idempotency-key': `uncertain-explicit-rerun-${sequence}`,
    })
    assert.equal(explicit.status, 200)
    assert.equal(explicit.json.judgments.at(-1).status, 'uncertain')
    assert.equal(server.requests.length, 2, 'only the separately keyed explicit rerun starts fresh work')
  } finally {
    await server.close()
  }
})

test('malformed model output is a durable failed receipt after usage is captured', async () => {
  delete process.env.DEPLOYMENT_PROFILE
  process.env[API_KEY_NAME] = 'local-delegated-judgment-key'
  const server = await endpoint({ decision: 'approve', summary: 'unused' }, { responseText: '{"decision":"maybe","summary":"invalid"}' })
  const usage: Array<[number, number, string | undefined]> = []
  const recordUsage = store.recordUsage
  store.recordUsage = (input, output, tenant) => {
    usage.push([input, output, tenant])
    return recordUsage.call(store, input, output, tenant)
  }
  try {
    const subject = await scenario('invalid delegated output', { endpoint: server.baseURL })
    const headers = { 'x-tenant-id': OWNER, 'idempotency-key': `invalid-output-${sequence}` }
    const body = { judgment: judgmentRequest(0, subject.binding) }
    const first = await callFresh('POST', path(subject.projectId, subject.contributionId, subject.delegationId), body, headers)
    assert.equal(first.status, 200)
    assert.equal(first.json.judgments.at(-1).status, 'failed')
    assert.equal(first.json.judgments.at(-1).decision, undefined)
    assert.deepEqual(usage, [[71, 19, OWNER]], 'provider-reported cost is retained before result validation')
    const retry = await callFresh('POST', path(subject.projectId, subject.contributionId, subject.delegationId), body, headers)
    assert.equal(retry.status, 200)
    assert.deepEqual(retry.json.judgments, first.json.judgments)
    assert.equal(server.requests.length, 1)
  } finally {
    store.recordUsage = recordUsage
    await server.close()
  }
})

test('pending retries attach, fresh keys conflict, and every changed fence settles stale without authority', async () => {
  delete process.env.DEPLOYMENT_PROFILE
  process.env[API_KEY_NAME] = 'local-delegated-judgment-key'
  const cases = [
    { label: 'policy revision', mutate: async (s: any) => callFresh('PATCH', `/projects/${s.projectId}/delegations/${s.delegationId}`, {
      expectedRevision: 0, policy: 'A newer policy supersedes the frozen request.', escalation: ['effectful'], mode: 'draft', expiresAt: null,
    }, { 'x-tenant-id': OWNER }) },
    { label: 'grant expiry', expiresSoon: true, mutate: async () => undefined },
    { label: 'grant revocation', mutate: async (s: any) => callFresh('DELETE', `/projects/${s.projectId}/delegations/${s.delegationId}`, {
      expectedCreatedAt: s.delegation.createdAt, expectedRevision: 0,
    }, { 'x-tenant-id': OWNER, 'idempotency-key': `revoke-${sequence}` }) },
    { label: 'changeset version', mutate: async (s: any) => call('POST', `/projects/${s.projectId}/contributions/${s.contributionId}/changeset`, {
      entries: [{ kind: 'note', target: `changed-${sequence}`, after: 'different current source' }],
    }, { 'x-tenant-id': CONTRIBUTOR }) },
    { label: 'reviewer configuration', mutate: async (s: any) => store.updateAgentFromRequest(
      s.agentId, { instructions: 'Changed while the model call was in flight.' }, s.binding.agentRevision,
    ) },
    { label: 'provider revision', mutate: async (s: any) => store.updateProvider(
      s.providerId, { label: `Updated provider ${sequence}` }, s.binding.providerRevision,
    ) },
    { label: 'provider connection revision', mutate: async (s: any) => store.replaceProviderConnection(s.providerId, {
      baseURL: s.baseURL, apiKeyEnv: API_KEY_NAME, model: 'delegated-judgment-fixture', capabilities: { toolUse: true },
    }, undefined, s.binding.connectionRevision) },
    { label: 'envelope version', actKind: 'approve-envelope' as const, mutate: async (s: any) => call('POST',
      `/projects/${s.projectId}/contributions/${s.contributionId}/envelope`, {
        expectedVersion: 1,
        lines: [{ type: 'connector.read', target: 'calendar:changed', cardinality: 1, harness: 'dry-run', note: 'changed source' }],
      }, { 'x-tenant-id': CONTRIBUTOR }) },
  ]
  for (const item of cases) {
    const server = await endpoint({ decision: 'approve', summary: `completed after ${item.label} changed` }, { pause: true })
    try {
      const expiryAt = 'expiresSoon' in item && item.expiresSoon ? Date.now() + 60_000 : undefined
      const subject = await scenario(`stale ${item.label}`, {
        endpoint: server.baseURL,
        mode: 'decide',
        ...(item.actKind ? { actKind: item.actKind } : {}),
        ...(expiryAt === undefined ? {} : { expiresAt: expiryAt }),
      })
      subject.baseURL = server.baseURL
      if (item.actKind === 'approve-envelope') {
        const proposal = await call('POST', `/projects/${subject.projectId}/contributions/${subject.contributionId}/envelope`, {
          lines: [{ type: 'connector.read', target: 'calendar:initial', cardinality: 1, harness: 'dry-run', note: 'initial source' }],
        }, { 'x-tenant-id': CONTRIBUTOR })
        assert.equal(proposal.status, 200)
      }
      const key = `paused-${item.label}-${sequence}`
      const request = judgmentRequest(0, subject.binding, 1, item.actKind ? 1 : null)
      const body = { judgment: request }
      const firstPromise = callFresh('POST', path(subject.projectId, subject.contributionId, subject.delegationId), body, {
        'x-tenant-id': OWNER, 'idempotency-key': key,
      })
      await server.requested
      await server.paused
      const retry = await callFresh('POST', path(subject.projectId, subject.contributionId, subject.delegationId), body, {
        'x-tenant-id': OWNER, 'idempotency-key': key,
      })
      assert.equal(retry.status, 200, `${item.label}: exact Retry attaches to the pending receipt`)
      assert.equal(retry.json.judgments.at(-1).status, 'pending')
      const competing = await callFresh('POST', path(subject.projectId, subject.contributionId, subject.delegationId), body, {
        'x-tenant-id': OWNER, 'idempotency-key': `${key}-fresh`,
      })
      assert.equal(competing.status, 409, `${item.label}: another key cannot start concurrent provider work`)
      const originalNow = Date.now
      try {
        if (expiryAt !== undefined) Date.now = () => expiryAt + 1
        const changed = await item.mutate(subject)
        if (changed && typeof changed === 'object' && 'status' in changed) assert.equal(changed.status, 200, item.label)
        server.requests[0].release?.()
        const finished = await firstPromise
        assert.equal(finished.status, 200)
        assert.equal(finished.json.judgments.at(-1).status, 'stale', `${item.label} cannot authorize on changed truth`)
        assert.equal(finished.json.status, 'open', `${item.label} cannot land or approve after the fence changes`)
        if (item.actKind === 'approve-envelope') assert.equal(finished.json.envelope.status, 'proposed')
        assert.equal(server.requests.length, 1)
      } finally {
        Date.now = originalNow
        server.requests[0].release?.()
      }
    } finally {
      await server.close()
    }
  }
})
